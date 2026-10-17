// Turns the accumulator's checkup signals into findings: what costs money, where the agent
// gets stuck, and what tends to work. Pure data; the page and the terminal word it themselves.

import { PROMPT_BUCKETS, dayKey } from "./parse.js?v=3";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_JUDGED = 20; // prompts with a known outcome before correction rates mean anything
const MIN_BUCKET = 15;
const MIN_PROJECT_JUDGED = 10;
const MIN_TOOL_RESULTS = 10;
const MIN_DAYS_FOR_MONTHLY = 7; // shorter histories show totals instead of a monthly pace
const LEVELS = ["high", "medium", "low"];
// How much work each fix takes: paste a snippet, paste and fill in, or change a habit.
const EFFORT = { context: "habit", cold: "habit", fit: "paste", reread: "paste", loops: "fill", corrections: "paste", promptLength: "habit" };
const EFFORT_ORDER = { paste: 0, fill: 1, habit: 2 };
const PLAN_SIZE = 3;
const BENCHMARK_DAY = 13; // code.claude.com/docs/en/costs: average spend per developer per active day

export function buildCheckup(acc, stats) {
  const total = stats.cost;
  const findings = [];
  const healthy = [];
  const add = (finding, ok) => (finding ? findings.push(finding) : ok && healthy.push(ok));

  add(...contextCheck(acc, total));
  add(...coldCacheCheck(acc, total));
  add(...modelFitCheck(acc, total));
  add(...rereadCheck(acc, total));
  add(...loopsCheck(acc));
  add(...correctionsCheck(acc));
  const tip = promptLengthTip(acc);
  if (tip) findings.push(tip);

  const days = Math.max(1, (stats.to - stats.from) / DAY_MS);
  const perMonth = days >= MIN_DAYS_FOR_MONTHLY ? (v) => (v * 30) / days : () => null;
  for (const f of findings) prioritize(f, perMonth);
  findings.sort((a, b) =>
    LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.save - a.save || EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]);
  const savings = findings.reduce((s, f) => s + (f.save || 0), 0);
  const activeDays = stats.activeDays || 1;

  return {
    total,
    days,
    spend: { ...acc.spend },
    savings,
    savingsMonthly: perMonth(savings),
    savingsShare: total ? savings / total : 0,
    // Anthropic's published average for Claude Code: ~$13 per developer per active day, 90% under $30.
    perActiveDay: total / activeDays,
    benchmarkDay: BENCHMARK_DAY,
    plan: findings.filter((f) => f.level !== "low").slice(0, PLAN_SIZE),
    firstTry: acc.judged.prompts ? 1 - acc.judged.corrected / acc.judged.prompts : null,
    judged: acc.judged.prompts,
    loops: acc.loops.count,
    loopHours: acc.loops.ms / HOUR_MS,
    week: weekOverWeek(acc, stats.to),
    findings,
    healthy,
  };
}

// Old work carried into a new task after a long break: what /clear (or a new session) would have
// saved, after paying for the fresh start. Size alone isn't a problem: a hard task needs its context.
function contextCheck(acc, total) {
  const c = acc.context;
  if (!c.requests) return [null, null];
  const save = Math.max(0, c.stale - c.freshCost);
  const facts = {
    returns: c.returns,
    avgCarry: c.returns ? c.carriedTokens / c.returns : 0,
    hugeShare: c.huge / c.requests,
    max: c.max,
    autoCompactions: acc.compactions.auto,
  };
  if (save < Math.max(1, 0.05 * total)) return [null, { id: "context", value: facts.hugeShare }];
  return [{
    id: "context",
    save,
    share: total ? save / total : 0,
    facts,
    projects: topProjects(acc, (p) => p.stale - p.fresh, (p) => Math.max(0, p.stale - p.fresh)),
  }];
}

// Re-caching after breaks. On the 5-minute cache, also weighs switching to the 1-hour TTL: it costs
// 0.75x input more on every cache write and saves the rewrites after breaks of 5 to 60 minutes.
function coldCacheCheck(acc, total) {
  const c = acc.cold;
  if (c.cost < Math.max(0.5, 0.03 * total)) return [null, acc.context.requests ? { id: "cold", value: c.events } : null];
  const ttlNet = c.ttlAvoidable - c.ttlExtra;
  return [{
    id: "cold",
    save: c.cost,
    share: total ? c.cost / total : 0,
    facts: { events: c.events, ttlNet, ttlWorthIt: ttlNet >= Math.max(0.5, 0.01 * total) },
    projects: topProjects(acc, (p) => p.cold, (p) => p.cold),
  }];
}

function modelFitCheck(acc, total) {
  const f = acc.fit;
  const save = f.cost - f.altCost;
  if (save < Math.max(0.5, 0.03 * total)) return [null, acc.context.requests ? { id: "fit", value: f.requests } : null];
  return [{
    id: "fit",
    save,
    share: total ? save / total : 0,
    facts: { requests: f.requests, requestShare: acc.context.requests ? f.requests / acc.context.requests : 0 },
    projects: topProjects(acc, (p) => p.fitSave, (p) => p.fitSave),
  }];
}

// Files read again while the earlier copy was still in the conversation.
function rereadCheck(acc, total) {
  const r = acc.reread;
  if (!r.reads) return [null, null];
  if (r.cost < Math.max(0.5, 0.03 * total)) return [null, { id: "reread", value: r.count }];
  return [{
    id: "reread",
    save: r.cost,
    share: total ? r.cost / total : 0,
    facts: {
      count: r.count,
      readShare: r.count / r.reads,
      avgTokens: r.count ? r.tokens / r.count : 0,
      files: [...r.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    },
    projects: topProjects(acc, (p) => p.rereadCost, (p) => p.rereadCost),
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
  const projects = topProjects(acc, (p) => p.loops, (p) => p.loops);
  // Each project's own failing commands, for its own CLAUDE.md.
  const commandsByProject = projects
    .map(([name]) => [name, [...acc.projectDetail.get(name).commands.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)])
    .filter(([, list]) => list.length);
  return [{
    id: "loops",
    save: 0,
    facts: { count: l.count, hours: l.ms / HOUR_MS, errorRate: errors / results, commands, commandsByProject, tools },
    projects,
  }];
}

function correctionsCheck(acc) {
  const j = acc.judged;
  if (j.prompts < MIN_JUDGED) return [null, null];
  const rate = j.corrected / j.prompts;
  if (rate < 0.15) return [null, { id: "corrections", value: rate }];
  return [{
    id: "corrections",
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
    save: 0,
    facts: { best, worst, ratio: best.rate ? worst.rate / best.rate : null },
    projects: [],
  };
}

// Ranks a finding by what fixing it is worth to this person: money at their pace, hours stuck,
// or how often answers miss. Anything small at their usage is "low" and gets collapsed.
function prioritize(f, perMonth) {
  f.effort = EFFORT[f.id];
  f.monthly = f.save ? perMonth(f.save) : null;
  const x = f.facts;
  switch (f.id) {
    case "context":
    case "cold":
    case "fit":
    case "reread": {
      const amount = f.monthly ?? f.save;
      f.level = f.share >= 0.15 && amount >= 10 ? "high" : f.share >= 0.05 && amount >= 3 ? "medium" : "low";
      break;
    }
    case "loops": {
      x.hoursMonthly = perMonth(x.hours);
      x.countMonthly = perMonth(x.count);
      const hours = x.hoursMonthly ?? x.hours;
      const count = x.countMonthly ?? x.count;
      f.level = hours >= 2 || count >= 15 ? "high" : hours >= 0.5 || count >= 5 ? "medium" : "low";
      break;
    }
    case "corrections":
      f.level = x.rate >= 0.3 ? "high" : "medium";
      break;
    case "promptLength":
      f.level = x.worst.rate - x.best.rate >= 0.15 && (x.ratio ?? Infinity) >= 2 ? "medium" : "low";
      break;
    default:
      f.level = "low";
  }
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
