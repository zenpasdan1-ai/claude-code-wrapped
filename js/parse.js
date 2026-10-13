// Reads Claude Code transcripts (one JSON object per line) into a compact accumulator.
// Nothing leaves the browser: files are read locally and only counts are kept.

import { costOf, modelInfo } from "./pricing.js";

const YIELD_EVERY_LINES = 4000;

const PLEASE = /\b(please|pls|plz)\b|пожалуйста/gi;
const THANKS = /\b(thanks|thank you|thx|ty)\b|спасибо/gi;
const SWEAR = /\b(wtf|damn|fuck\w*|shit)\b|блин|черт|чёрт/gi;
const ABSOLUTELY_RIGHT = /you(?:'|’)?re absolutely right|you are absolutely right|вы абсолютно правы|ты абсолютно прав/gi;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const LANGUAGES = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", ipynb: "Python",
  rs: "Rust", go: "Go", rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", h: "C", cpp: "C++", cc: "C++", hpp: "C++", cs: "C#", php: "PHP",
  dart: "Dart", ex: "Elixir", exs: "Elixir", lua: "Lua", zig: "Zig", scala: "Scala",
  vue: "Vue", svelte: "Svelte", html: "HTML", css: "CSS", scss: "CSS", sql: "SQL",
  sh: "Shell", bash: "Shell", zsh: "Shell", md: "Markdown", mdx: "Markdown",
  json: "Config", yaml: "Config", yml: "Config", toml: "Config",
};

// range: optional { from, to } in epoch ms; lines outside it are skipped.
export function createAccumulator(range = null) {
  return {
    range,
    files: 0,
    lines: 0,
    badLines: 0,
    seenMessages: new Set(),
    events: [], // [epochMs, sessionId, kind] — kind: 1 prompt, 2 assistant
    sessions: new Map(), // id -> { project, first, last }
    projects: new Map(), // name -> prompts
    models: new Map(), // label -> { family, input, output, cacheWrite, cacheRead, cost, messages }
    tools: new Map(),
    languages: new Map(), // language -> edits
    editedFiles: new Set(),
    costByDay: new Map(), // local date key -> API-equivalent cost
    prompts: 0,
    promptWords: 0,
    longestPrompt: 0, // words
    please: 0,
    thanks: 0,
    swears: 0,
    absolutelyRight: 0,
    interrupts: 0,
  };
}

// Stream a File line by line so large transcript folders stay responsive.
export async function readFiles(files, acc, onProgress = () => {}) {
  const list = [...files].filter((f) => /\.jsonl$/i.test(f.name));
  let done = 0;
  let sinceYield = 0;
  for (const file of list) {
    acc.files++;
    const fallbackProject = projectFromPath(file.webkitRelativePath || file.name);
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
    let rest = "";
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      rest += value;
      const lines = rest.split("\n");
      rest = lines.pop();
      for (const line of lines) {
        ingestLine(acc, line, fallbackProject);
        if (++sinceYield >= YIELD_EVERY_LINES) {
          sinceYield = 0;
          onProgress({ files: done, total: list.length, lines: acc.lines });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    if (rest) ingestLine(acc, rest, fallbackProject);
    done++;
    onProgress({ files: done, total: list.length, lines: acc.lines });
  }
  return acc;
}

export function ingestLine(acc, line, fallbackProject = "unknown") {
  const text = line.trim();
  if (!text) return;
  acc.lines++;
  let row;
  try {
    row = JSON.parse(text);
  } catch {
    acc.badLines++;
    return;
  }
  if (!row || typeof row !== "object") return;
  const t = Date.parse(row.timestamp);
  if (!Number.isFinite(t)) return;
  if (acc.range && (t < acc.range.from || t > acc.range.to)) return;

  const sessionId = row.sessionId || fallbackProject;
  const project = projectName(row.cwd) || fallbackProject;
  const session = acc.sessions.get(sessionId) ?? { project, first: t, last: t };
  session.first = Math.min(session.first, t);
  session.last = Math.max(session.last, t);
  acc.sessions.set(sessionId, session);

  const msg = row.message || {};
  if (row.type === "user" && !row.isMeta && !row.isSidechain) ingestUser(acc, msg, t, sessionId, project);
  else if (row.type === "assistant") ingestAssistant(acc, row, msg, t, sessionId);
}

function ingestUser(acc, msg, t, sessionId, project) {
  const words = promptText(msg.content);
  if (words === null) return; // tool results are not things the person typed
  if (/^\[Request interrupted/.test(words)) {
    acc.interrupts++;
    return;
  }
  if (words.startsWith("<command-") || words.startsWith("<local-command")) return;
  acc.prompts++;
  const wordCount = words.split(/\s+/).filter(Boolean).length;
  acc.promptWords += wordCount;
  acc.longestPrompt = Math.max(acc.longestPrompt, wordCount);
  acc.please += count(words, PLEASE);
  acc.thanks += count(words, THANKS);
  acc.swears += count(words, SWEAR);
  acc.projects.set(project, (acc.projects.get(project) ?? 0) + 1);
  acc.events.push([t, sessionId, 1]);
}

function ingestAssistant(acc, row, msg, t, sessionId) {
  // Streaming writes the same message more than once; count usage once per message.
  const key = msg.id ? `${msg.id}:${row.requestId ?? ""}` : null;
  const fresh = !key || !acc.seenMessages.has(key);
  if (key) acc.seenMessages.add(key);
  acc.events.push([t, sessionId, 2]);

  for (const block of Array.isArray(msg.content) ? msg.content : []) {
    if (block?.type === "tool_use" && block.name && fresh) {
      acc.tools.set(block.name, (acc.tools.get(block.name) ?? 0) + 1);
      if (EDIT_TOOLS.has(block.name)) ingestEdit(acc, block.input);
    } else if (block?.type === "text" && typeof block.text === "string" && fresh) {
      acc.absolutelyRight += count(block.text, ABSOLUTELY_RIGHT);
    }
  }

  const u = msg.usage;
  if (!fresh || !u || !msg.model || msg.model === "<synthetic>") return;
  const info = modelInfo(msg.model);
  const usage = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
  const m = acc.models.get(info.label) ?? { family: info.family, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, messages: 0 };
  m.input += usage.input;
  m.output += usage.output;
  m.cacheWrite += usage.cacheWrite;
  m.cacheRead += usage.cacheRead;
  const cost = costOf(info, usage);
  m.cost += cost;
  m.messages++;
  acc.models.set(info.label, m);
  const day = dayKey(new Date(t));
  acc.costByDay.set(day, (acc.costByDay.get(day) ?? 0) + cost);
}

// Only the file extension matters; paths stay in memory and never reach the story.
function ingestEdit(acc, input) {
  const path = input?.file_path || input?.notebook_path;
  if (typeof path !== "string") return;
  acc.editedFiles.add(path);
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const language = ext && LANGUAGES[ext];
  if (language) acc.languages.set(language, (acc.languages.get(language) ?? 0) + 1);
}

export function subagentCalls(tools) {
  let n = 0;
  for (const [name, calls] of tools) if (SUBAGENT_TOOLS.has(name)) n += calls;
  return n;
}

// Returns the typed text of a user message, or null when it only carries tool results.
function promptText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
  return texts.length ? texts.join(" ").trim() : null;
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function count(text, re) {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

function projectName(cwd) {
  if (!cwd || typeof cwd !== "string") return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

// ~/.claude/projects/-Users-me-code-app/abc.jsonl -> "app"
function projectFromPath(path) {
  const parts = path.split("/");
  const dir = parts.length > 1 ? parts[parts.length - 2] : "";
  const segs = dir.split("-").filter(Boolean);
  return segs[segs.length - 1] || "unknown";
}
