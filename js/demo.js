// A believable sample: synthetic transcript lines fed through the real parser,
// so the demo shows exactly what a person's own folder would produce.

import { createAccumulator, ingestLine } from "./parse.js?v=19h";

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const PROJECTS = ["api-server", "landing", "dotfiles", "ml-notebook", "mobile-app"];
const EXTENSIONS = {
  "api-server": ["ts", "ts", "sql", "json"],
  landing: ["tsx", "tsx", "css", "md"],
  dotfiles: ["sh", "toml", "lua"],
  "ml-notebook": ["py", "py", "ipynb"],
  "mobile-app": ["swift", "swift", "json"],
};
const COMMANDS = {
  "api-server": ["npm test", "npm run build", "git status"],
  landing: ["pnpm lint", "pnpm build", "git diff"],
  dotfiles: ["stow -v zsh", "git status"],
  "ml-notebook": ["pytest -q", "python train.py", "git status"],
  "mobile-app": ["xcodebuild test", "swift build", "git status"],
};
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
  ["WebSearch", 0.02],
  ["Task", 0.02],
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
  "add a retry with exponential backoff to the upload client, keep the public api the same, and cover the timeout and the 503 case with tests",
  "ok so here is the plan: split the parser into a reader and a reducer, keep the public api the same, add tests for the empty file and the broken line cases, then run the whole suite and tell me what changed before you commit anything please",
];
const CORRECTIONS = ["no, that's not what I meant", "still broken", "that's wrong, revert it", "it doesn't work", "undo that please", "nope, keep the old api"];
const CONTEXT_START = 18_000;
const AUTO_COMPACT_AT = 420_000;

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
      const cwd = `/Users/demo/code/${project}`;
      const hour = r() < 0.35 ? 22 + Math.floor(r() * 5) : 9 + Math.floor(r() * 11);
      let t = base + (hour % 24) * 3_600_000 + Math.floor(r() * 3_600_000);
      let ctx = CONTEXT_START;
      let prevWords = 0;
      let corrected = false;
      let pausedBefore = false;
      const stuckAt = r() < 0.14 ? Math.floor(r() * 8) : -1; // this session hits a failure loop
      const turns = 4 + Math.floor(r() * 26);
      const at = (ms) => new Date(ms).toISOString();

      for (let k = 0; k < turns; k++) {
        // Short asks get pushed back on more often than well-specified ones.
        const pushBack = k > 0 && r() < (prevWords <= 10 ? 0.3 : prevWords <= 40 ? 0.17 : 0.07);
        const text = pushBack ? CORRECTIONS[Math.floor(r() * CORRECTIONS.length)] : PROMPTS[Math.floor(r() * PROMPTS.length)];
        prevWords = text.split(" ").length;
        corrected = pushBack;
        lines.push(JSON.stringify({ type: "user", sessionId, cwd, timestamp: at(t), message: { role: "user", content: text } }));
        t += 20_000 + r() * 120_000;
        if (r() < 0.012) {
          lines.push(JSON.stringify({ type: "user", sessionId, cwd, timestamp: at(t), message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } }));
        }

        const loop = k === stuckAt;
        const steps = loop ? 4 + Math.floor(r() * 3) : 1 + Math.floor(r() * 6);
        const model = pick(r, MODELS);
        for (let j = 0; j < steps; j++) {
          const content = [];
          if (j === 0 && r() < (corrected ? 0.5 : 0.03)) content.push({ type: "text", text: "You're absolutely right — I missed that." });
          const tool = loop ? "Bash" : pick(r, TOOLS);
          const exts = EXTENSIONS[project];
          let input = {};
          if (tool === "Edit" || tool === "Write") input = { file_path: `${cwd}/src/file${Math.floor(r() * 40)}.${exts[Math.floor(r() * exts.length)]}` };
          else if (tool === "Bash") input = { command: loop ? COMMANDS[project][0] : COMMANDS[project][Math.floor(r() * COMMANDS[project].length)] };
          else if (tool === "Read") input = { file_path: `${cwd}/src/file${Math.floor(r() * 40)}.${exts[0]}` };
          const toolId = `toolu_${msg}`;
          content.push({ type: "tool_use", id: toolId, name: tool, input });

          // Context grows each step; a long pause means the whole thing is cached again.
          const added = 1500 + Math.floor(r() * 6000) + (tool === "Read" ? 4000 : 0);
          const cold = pausedBefore;
          pausedBefore = false;
          const usage = {
            input_tokens: 3 + Math.floor(r() * 40),
            output_tokens: tool === "Read" || tool === "Grep" ? 80 + Math.floor(r() * 300) : 150 + Math.floor(r() * 1400),
            cache_creation_input_tokens: cold ? ctx + added : added,
            cache_read_input_tokens: cold ? 0 : ctx,
          };
          ctx += added;
          lines.push(JSON.stringify({
            type: "assistant",
            sessionId,
            cwd,
            requestId: `req_${msg}`,
            timestamp: at(t),
            message: { id: `msg_${msg++}`, role: "assistant", model, content, usage },
          }));
          t += 4_000 + r() * 30_000;

          const flaky = tool === "Bash" && !input.command.startsWith("git");
          const failRate = loop && j < steps - 1 ? 1 : flaky ? 0.1 : tool === "Bash" ? 0 : tool === "Edit" ? 0.05 : 0.01;
          const failed = r() < failRate;
          lines.push(JSON.stringify({
            type: "user",
            sessionId,
            cwd,
            timestamp: at(t),
            message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, is_error: failed, content: failed ? "Exit code 1\nError: tests failed" : "ok" }] },
          }));
          t += 2_000 + r() * 20_000;

          if (ctx > AUTO_COMPACT_AT) {
            lines.push(JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId, cwd, timestamp: at(t), compactMetadata: { trigger: "auto", preTokens: ctx } }));
            ctx = CONTEXT_START + 6000;
          }
        }
        if (r() < 0.04) {
          t += (8 + r() * 40) * MIN_MS; // stepped away; the cache expires
          pausedBefore = true;
        } else if (k > 3 && r() < 0.12) {
          t += (70 + r() * 150) * MIN_MS; // back after lunch, on to something else in the same session
          pausedBefore = true;
        }
      }
    }
  }
  return lines;
}

export function demoAccumulator(range = null) {
  const acc = createAccumulator(range);
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
