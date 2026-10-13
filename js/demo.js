// A believable sample: synthetic transcript lines fed through the real parser,
// so the demo shows exactly what a person's own folder would produce.

import { createAccumulator, ingestLine } from "./parse.js";

const DAY_MS = 86_400_000;
const PROJECTS = ["api-server", "landing", "dotfiles", "ml-notebook", "mobile-app"];
const MODELS = [
  ["claude-opus-5-5", 0.55],
  ["claude-sonnet-5-5", 0.3],
  ["claude-fable-5-1", 0.1],
  ["claude-haiku-5-5", 0.05],
];
const TOOLS = [
  ["Bash", 0.3],
  ["Read", 0.24],
  ["Edit", 0.2],
  ["Grep", 0.1],
  ["Write", 0.07],
  ["Glob", 0.05],
  ["WebSearch", 0.04],
];
const PROMPTS = [
  "please fix the failing test in auth",
  "can you refactor this into smaller functions",
  "why is the build red again",
  "thanks! now add pagination",
  "please write tests for the parser",
  "wtf is this error",
  "ship it",
  "make the button feel snappier please",
];

export function demoLines(now = Date.now()) {
  const r = rng(2026);
  const lines = [];
  const start = now - 92 * DAY_MS;
  let msg = 0;
  for (let day = 0; day < 92; day++) {
    if (r() < 0.22) continue; // days off
    const base = start + day * DAY_MS;
    const sessions = 1 + Math.floor(r() * 3);
    for (let s = 0; s < sessions; s++) {
      const sessionId = `demo-${day}-${s}`;
      const project = PROJECTS[Math.floor(Math.pow(r(), 1.6) * PROJECTS.length)];
      const hour = r() < 0.35 ? 22 + Math.floor(r() * 5) : 9 + Math.floor(r() * 11);
      let t = base + (hour % 24) * 3_600_000 + Math.floor(r() * 3_600_000);
      const turns = 4 + Math.floor(r() * 26);
      for (let k = 0; k < turns; k++) {
        lines.push(JSON.stringify({
          type: "user",
          sessionId,
          cwd: `/Users/demo/code/${project}`,
          timestamp: new Date(t).toISOString(),
          message: { role: "user", content: PROMPTS[Math.floor(r() * PROMPTS.length)] },
        }));
        t += 20_000 + r() * 120_000;
        const steps = 1 + Math.floor(r() * 6);
        for (let j = 0; j < steps; j++) {
          const content = [];
          if (j === 0 && r() < 0.06) content.push({ type: "text", text: "You're absolutely right — I missed that." });
          content.push({ type: "tool_use", id: `toolu_${msg}`, name: pick(r, TOOLS), input: {} });
          lines.push(JSON.stringify({
            type: "assistant",
            sessionId,
            requestId: `req_${msg}`,
            timestamp: new Date(t).toISOString(),
            message: {
              id: `msg_${msg++}`,
              role: "assistant",
              model: pick(r, MODELS),
              content,
              usage: {
                input_tokens: 40 + Math.floor(r() * 400),
                output_tokens: 150 + Math.floor(r() * 1400),
                cache_creation_input_tokens: Math.floor(r() * 6000),
                cache_read_input_tokens: 20_000 + Math.floor(r() * 90_000),
              },
            },
          }));
          t += 8_000 + r() * 60_000;
        }
      }
    }
  }
  return lines;
}

export function demoAccumulator() {
  const acc = createAccumulator();
  acc.files = 214;
  for (const line of demoLines()) ingestLine(acc, line);
  return acc;
}

function pick(r, weighted) {
  let x = r();
  for (const [value, w] of weighted) {
    if ((x -= w) <= 0) return value;
  }
  return weighted[0][0];
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
