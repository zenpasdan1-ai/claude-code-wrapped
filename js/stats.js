// Turns the raw accumulator into the numbers the story shows.

import { buildCheckup } from "./checkup.js";
import { dayKey, settleAccumulator, subagentCalls } from "./parse.js";

const IDLE_GAP_MS = 30 * 60 * 1000; // a pause longer than this ends the active stretch
const DAY_MS = 86_400_000;
const NOT_A_LANGUAGE = new Set(["Config", "Markdown"]); // shown in the bars, never the headline

export function finalize(acc) {
  settleAccumulator(acc);
  const events = acc.events.slice().sort((a, b) => a[0] - b[0]);
  if (!events.length) return null;

  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // [weekday Mon=0][hour]
  const days = new Map(); // local date key -> prompts
  let night = 0;
  let early = 0;
  let weekend = 0;
  let prompts = 0;
  for (const [t, , kind] of events) {
    if (kind !== 1) continue;
    prompts++;
    const d = new Date(t);
    const wd = (d.getDay() + 6) % 7;
    const h = d.getHours();
    heat[wd][h]++;
    if (h >= 22 || h < 5) night++;
    if (h >= 5 && h < 10) early++;
    if (wd >= 5) weekend++;
    const key = dayKey(d);
    days.set(key, (days.get(key) ?? 0) + 1);
  }

  // Active time per session: sum gaps between consecutive events, ignoring long idles.
  const bySession = new Map();
  for (const [t, s] of events) {
    const list = bySession.get(s) ?? [];
    list.push(t);
    bySession.set(s, list);
  }
  let activeMs = 0;
  let longest = { ms: 0, start: 0, project: "" };
  for (const [s, times] of bySession) {
    let ms = 0;
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap <= IDLE_GAP_MS) ms += gap;
    }
    activeMs += ms;
    if (ms > longest.ms) longest = { ms, start: times[0], project: acc.sessions.get(s)?.project ?? "" };
  }

  const streaks = longestStreak([...days.keys()]);
  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1])[0];

  const models = [...acc.models.entries()]
    .map(([label, m]) => ({ label, ...m, tokens: m.input + m.output + m.cacheWrite + m.cacheRead }))
    .sort((a, b) => b.output - a.output);
  const totalOutput = models.reduce((s, m) => s + m.output, 0) || 1;
  models.forEach((m) => (m.share = m.output / totalOutput));
  const cost = models.reduce((s, m) => s + m.cost, 0);
  const tokens = models.reduce((s, m) => s + m.tokens, 0);
  const outputTokens = models.reduce((s, m) => s + m.output, 0);

  const tools = [...acc.tools.entries()].sort((a, b) => b[1] - a[1]);
  const toolCalls = tools.reduce((s, [, n]) => s + n, 0);
  const projects = [...acc.projects.entries()].sort((a, b) => b[1] - a[1]);
  const languages = [...acc.languages.entries()].sort((a, b) => b[1] - a[1]);
  const priciest = [...acc.costByDay.entries()].sort((a, b) => b[1] - a[1])[0];

  let peakHour = 0;
  const byHour = new Array(24).fill(0);
  heat.forEach((row) => row.forEach((n, h) => (byHour[h] += n)));
  byHour.forEach((n, h) => {
    if (n > byHour[peakHour]) peakHour = h;
  });

  const stats = {
    from: events[0][0],
    to: events[events.length - 1][0],
    files: acc.files,
    sessions: bySession.size,
    hours: activeMs / 3_600_000,
    longest,
    prompts,
    promptWords: acc.promptWords,
    please: acc.please,
    thanks: acc.thanks,
    swears: acc.swears,
    interrupts: acc.interrupts,
    absolutelyRight: acc.absolutelyRight,
    activeDays: days.size,
    streak: streaks.longest,
    streakEnd: streaks.end,
    busiest: busiest ? { day: busiest[0], prompts: busiest[1] } : null,
    heat,
    peakHour,
    nightShare: prompts ? night / prompts : 0,
    earlyShare: prompts ? early / prompts : 0,
    weekendShare: prompts ? weekend / prompts : 0,
    models,
    favorite: models[0] ?? null,
    cost,
    tokens,
    outputTokens,
    tools,
    toolCalls,
    toolsPerPrompt: prompts ? toolCalls / prompts : 0,
    projects,
    languages,
    topLanguage: (languages.find(([name]) => !NOT_A_LANGUAGE.has(name)) ?? languages[0] ?? [null])[0],
    languageEdits: languages.reduce((s, [, n]) => s + n, 0),
    editedFiles: acc.editedFiles.size,
    longestPrompt: acc.longestPrompt,
    subagents: subagentCalls(acc.tools),
    priciestDay: priciest && priciest[1] > 0 ? { day: priciest[0], cost: priciest[1] } : null,
  };
  stats.archetype = archetype(stats);
  stats.checkup = buildCheckup(acc, stats);
  return stats;
}

// Each archetype scores how far past its own threshold the person is; the best one wins.
const ARCHETYPES = [
  { id: "nightOwl", score: (s) => s.nightShare / 0.3 },
  { id: "earlyBird", score: (s) => s.earlyShare / 0.3 },
  { id: "opusMaximalist", score: (s) => familyShare(s, "opus") / 0.6 },
  { id: "fableFlyer", score: (s) => familyShare(s, "fable") / 0.4 },
  { id: "marathoner", score: (s) => s.longest.ms / (4 * 3_600_000) },
  { id: "politeCoder", score: (s) => (s.prompts ? (s.please + s.thanks) / s.prompts : 0) / 0.15 },
  { id: "toolWhisperer", score: (s) => s.toolsPerPrompt / 8 },
  { id: "weekendWarrior", score: (s) => s.weekendShare / 0.4 },
  { id: "streakMachine", score: (s) => s.streak / 21 },
];

export function archetype(s) {
  let best = { id: "steadyShipper", score: 1 };
  for (const a of ARCHETYPES) {
    const score = a.score(s);
    if (score > best.score) best = { id: a.id, score };
  }
  return best.id;
}

function familyShare(s, family) {
  return s.models.filter((m) => m.family === family).reduce((sum, m) => sum + m.share, 0);
}

function longestStreak(keys) {
  const sorted = keys.sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  let end = null;
  for (const key of sorted) {
    const t = Date.parse(key + "T12:00:00");
    run = prev !== null && Math.round((t - prev) / DAY_MS) === 1 ? run + 1 : 1;
    if (run > longest) {
      longest = run;
      end = key;
    }
    prev = t;
  }
  return { longest, end };
}
