// Turns the accumulator's checkup signals into findings: what costs money, where the agent
// gets stuck, and what tends to work. Pure data; the page and the terminal word it themselves.

import { PROMPT_BUCKETS, dayKey } from "./parse.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_JUDGED = 20; // prompts with a known outcome before correction rates mean anything
const MIN_BUCKET = 15;
const MIN_PROJECT_JUDGED = 10;
const MIN_TOOL_RESULTS = 10;

export function buildCheckup(acc, stats) {
  const total = stats.cost;
  const findings = [];
  const healthy = [];
  const add = (finding, ok) => (finding ? findings.push(finding) : ok && healthy.push(ok));

  add(...contextCheck(acc, total));
  add(...coldCacheCheck(acc, total));
  add(...modelFitCheck(acc, total));
  add(...loopsCheck(acc));
  add(...correctionsCheck(acc));
  const tip = promptLengthTip(acc);
  if (tip) findings.push(tip);

  const order = { bad: 0, warn: 1, tip: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level] || b.save - a.save);
  const savings = findings.reduce((s, f) => s + (f.save || 0), 0);

  return {
    total,
    spend: { ...acc.spend },
    savings,
    savingsShare: total ? savings / total : 0,
    firstTry: acc.judged.prompts ? 1 - acc.judged.corrected / acc.judged.prompts : null,
    judged: acc.judged.prompts,
    loops: acc.loops.count,
    loopHours: acc.loops.ms / HOUR_MS,
    week: weekOverWeek(acc, stats.to),
    findings,
    healthy,
  };
}

function contextCheck(acc, total) {
  const c = acc.context;
  if (!c.requests) return [null, null];
  const share = total ? c.tax / total : 0;
  const facts = {
    longShare: c.long / c.requests,
    huge: c.huge,
    max: c.max,
    autoCompactions: acc.compactions.auto,
    avgCompactAt: acc.compactions.auto + acc.compactions.manual ? acc.compactions.preTokens / (acc.compactions.auto + acc.compactions.manual) : 0,
  };
  if (c.tax < Math.max(1, 0.05 * total)) return [null, { id: "context", value: facts.longShare }];
  return [{
    id: "context",
    level: share >= 0.2 ? "bad" : "warn",
    save: c.tax,
    share,
    facts,
    projects: topProjects(acc, (p) => p.tax, (p) => p.tax),
  }];
}

function coldCacheCheck(acc, total) {
  const c = acc.cold;
  if (c.cost < Math.max(0.5, 0.03 * total)) return [null, acc.context.requests ? { id: "cold", value: c.events } : null];
  return [{
    id: "cold",
    level: total && c.cost / total >= 0.1 ? "bad" : "warn",
    save: c.cost,
    share: total ? c.cost / total : 0,
    facts: { events: c.events },
    projects: topProjects(acc, (p) => p.cold, (p) => p.cold),
  }];
}

function modelFitCheck(acc, total) {
  const f = acc.fit;
  const save = f.cost - f.altCost;
  if (save < Math.max(0.5, 0.03 * total)) return [null, acc.context.requests ? { id: "fit", value: f.requests } : null];
  return [{
    id: "fit",
    level: "warn",
    save,
    share: total ? save / total : 0,
    facts: { requests: f.requests, requestShare: acc.context.requests ? f.requests / acc.context.requests : 0 },
    projects: topProjects(acc, (p) => p.fitSave, (p) => p.fitSave),
  }];
}

function loopsCheck(acc) {
  let results = 0;
  let errors = 0;
  for (const s of acc.toolResults.values()) {
    results += s.results;
    errors += s.errors;
  }
  if (!results) return [null, null];
  const l = acc.loops;
  if (l.count < 3 && l.ms < 30 * 60_000) return [null, { id: "loops", value: errors / results }];
  const commands = [...acc.failingCommands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const tools = [...acc.toolResults.entries()]
    .filter(([name, s]) => s.results >= MIN_TOOL_RESULTS && name !== "unknown")
    .map(([name, s]) => [name, s.errors / s.results])
    .filter(([, rate]) => rate > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return [{
    id: "loops",
    level: l.count >= 10 ? "bad" : "warn",
    save: 0,
    facts: { count: l.count, hours: l.ms / HOUR_MS, errorRate: errors / results, commands, tools },
    projects: topProjects(acc, (p) => p.loops, (p) => p.loops),
  }];
}

function correctionsCheck(acc) {
  const j = acc.judged;
  if (j.prompts < MIN_JUDGED) return [null, null];
  const rate = j.corrected / j.prompts;
  if (rate < 0.15) return [null, { id: "corrections", value: rate }];
  return [{
    id: "corrections",
    level: rate >= 0.3 ? "bad" : "warn",
    save: 0,
    facts: { rate, corrected: j.corrected, judged: j.prompts },
    projects: topProjects(acc, (p) => (p.judged >= MIN_PROJECT_JUDGED ? p.corrected / p.judged : 0), (p) => p.corrected / p.judged),
  }];
}

// Which prompt length needs fixing least often, when the difference is big enough to trust.
function promptLengthTip(acc) {
  const rows = acc.buckets
    .map((b, i) => ({ i, max: PROMPT_BUCKETS[i], min: i ? PROMPT_BUCKETS[i - 1] + 1 : 1, prompts: b.prompts, rate: b.prompts ? b.corrected / b.prompts : 0 }))
    .filter((b) => b.prompts >= MIN_BUCKET);
  if (rows.length < 2) return null;
  const best = rows.reduce((a, b) => (b.rate < a.rate ? b : a));
  const worst = rows.reduce((a, b) => (b.rate > a.rate ? b : a));
  if (worst.rate - best.rate < 0.08 || best.rate * 1.5 > worst.rate) return null;
  return {
    id: "promptLength",
    level: "tip",
    save: 0,
    facts: { best, worst, ratio: best.rate ? worst.rate / best.rate : null },
    projects: [],
  };
}

// The last 7 days against the 7 before them, ending at the newest activity.
function weekOverWeek(acc, to) {
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  const cut = end.getTime() - 7 * DAY_MS;
  const start = cut - 7 * DAY_MS;
  const week = () => ({ cost: 0, prompts: 0, judged: 0, corrected: 0 });
  const cur = week();
  const prev = week();
  const pick = (t) => (t > cut ? cur : t > start ? prev : null);
  for (const [day, cost] of acc.costByDay) {
    const w = pick(Date.parse(day + "T12:00:00"));
    if (w) w.cost += cost;
  }
  for (const [t, , kind] of acc.events) {
    if (kind !== 1) continue;
    const w = pick(t);
    if (w) w.prompts++;
  }
  for (const [day, d] of acc.byDay) {
    const w = pick(Date.parse(day + "T12:00:00"));
    if (!w) continue;
    w.judged += d.judged;
    w.corrected += d.corrected;
  }
  const done = (w) => ({ cost: w.cost, prompts: w.prompts, firstTry: w.judged ? 1 - w.corrected / w.judged : null });
  return {
    from: dayKey(new Date(cut + 1)),
    to: dayKey(end),
    cur: done(cur),
    prev: prev.prompts || prev.cost ? done(prev) : null,
  };
}

function topProjects(acc, rank, value) {
  return [...acc.projectDetail.entries()]
    .map(([name, p]) => [name, rank(p), p])
    .filter(([, r]) => r > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, , p]) => [name, value(p)]);
}
