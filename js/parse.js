// Reads Claude Code transcripts (one JSON object per line) into a compact accumulator.
// Nothing leaves the machine: files are read locally and only counts are kept.

import { costParts, modelInfo } from "./pricing.js?v=3";

const YIELD_EVERY_LINES = 4000;

const PLEASE = /\b(please|pls|plz)\b|пожалуйста/gi;
const THANKS = /\b(thanks|thank you|thx|ty)\b|спасибо/gi;
const SWEAR = /\b(wtf|damn|fuck\w*|shit)\b|блин|черт|чёрт/gi;
const ABSOLUTELY_RIGHT = /you(?:'|’)?re absolutely right|you are absolutely right|вы абсолютно правы|ты абсолютно прав/gi;

// A prompt that pushes back on the previous answer. Heuristic, English and Russian.
const CORRECTION_EN = /^(?:no\b|nope\b|wrong\b|not (?:what|quite|right|that)\b|that'?s (?:not|wrong)\b|this is(?:n'?t| not)\b|it'?s (?:still )?(?:broken|wrong|not working)\b|still (?:not|broken|wrong|failing|doesn'?t|the same)\b|(?:it )?(?:doesn'?t|didn'?t|does not|did not) work\b|undo\b|revert\b|roll ?back\b|you (?:broke|missed|forgot|didn'?t)\b|why did you\b|i (?:said|meant|asked)\b|stop\b)/i;
const CORRECTION_RU = /^(?:нет|не так|не то|не работает|не правильно|неправильно|опять|снова|всё равно|все равно|так это|это (?:же )?(?:вообще |абсолютно |совсем )?не|откати|верни|зачем ты|ты (?:сломал|забыл|не)|я (?:же )?(?:имел в ?виду|просил|говорил)|стоп|подожди)(?=$|[\s,.!?:;])/i;
const FILLER = /^(?:(?:ok|okay|hmm+|well|so|ну|так|хм+|ок)[\s,.!]+)+/i;

export const PROMPT_BUCKETS = [10, 40, 120, Infinity]; // words: ≤10, 11–40, 41–120, more
// Claude Code's status line flags requests over 200k (exceeds_200k_tokens); we report the same line.
const HUGE_CONTEXT = 200_000;
// Coming back to a session after this long usually means a new task. The official advice for that is
// /clear (or a new session); what the old context costs from then on is what the advice saves.
const TASK_GAP = 60 * 60_000;
const MIN_CARRY = 50_000; // carried tokens below this aren't worth a finding
const FRESH_CONTEXT = 20_000; // a fresh session: system prompt, tools, CLAUDE.md
const COLD_REWRITE_MIN = 20_000; // cache tokens written after a pause before it counts as a re-cache
const TTL_5M = 5 * 60_000;
const TTL_1H = 60 * 60_000;
// A Read result smaller than this is a stub or a tiny file: re-reading it costs next to nothing.
const MIN_REREAD_TOKENS = 200;
const CHARS_PER_TOKEN = 4;
const LOOP_ERRORS = 3; // failed tool calls in a row that make a stuck loop
const FIT_MAX_OUTPUT = 2000;
const PREMIUM = new Set(["opus", "fable", "mythos"]);
const FIT_MODEL = "claude-sonnet-5-5";
const LIGHT_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebSearch", "WebFetch", "NotebookRead"]);
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);
const RUNNERS = new Set(["npm", "pnpm", "yarn", "npx", "bun", "bunx", "cargo", "go", "python", "python3", "uv", "poetry", "make", "docker", "git", "dotnet", "mvn", "gradle", "./gradlew", "bundle", "rails", "php", "composer", "swift", "xcodebuild", "flutter", "deno", "node"]);
const NOT_A_FAILURE = /user doesn'?t want to proceed|tool use was rejected|interrupted by user/i;
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
    seenMessages: new Set(), // message id + request id: usage is counted once per API response
    seenBlocks: new Set(), // tool_use ids and text fingerprints: each block is counted once
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
    // Checkup signals.
    spend: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    context: { requests: 0, huge: 0, max: 0, returns: 0, carriedTokens: 0, stale: 0, freshCost: 0 },
    cold: { events: 0, cost: 0, ttlAvoidable: 0, ttlExtra: 0 },
    fit: { requests: 0, cost: 0, altCost: 0 },
    reread: { reads: 0, count: 0, tokens: 0, cost: 0, files: new Map() }, // files: base name -> repeats
    compactions: { auto: 0, manual: 0, preTokens: 0 },
    toolResults: new Map(), // tool -> { results, errors }
    failingCommands: new Map(), // "npm test" -> failed runs
    loops: { count: 0, ms: 0 },
    judged: { prompts: 0, corrected: 0 },
    buckets: PROMPT_BUCKETS.map(() => ({ prompts: 0, corrected: 0 })),
    byDay: new Map(), // local date key -> { judged, corrected }
    projectDetail: new Map(), // name -> per-project checkup counters
    sessionState: new Map(),
    pendingTools: new Map(), // tool_use id -> { name, command, read, sessionId }
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
  if (row.type !== "user" && row.type !== "assistant" && row.type !== "system") return;
  // A session belongs to the folder it started in; the agent's later `cd`s don't move it.
  const session = acc.sessions.get(sessionId) ?? { project: projectName(row.cwd) || fallbackProject, first: t, last: t };
  const project = session.project;
  session.first = Math.min(session.first, t);
  session.last = Math.max(session.last, t);
  acc.sessions.set(sessionId, session);

  const msg = row.message || {};
  if (row.type === "user" && !row.isSidechain) ingestUser(acc, row, msg, t, sessionId, project);
  else if (row.type === "assistant") ingestAssistant(acc, row, msg, t, sessionId, project);
  else if (row.type === "system" && row.subtype === "compact_boundary") ingestCompaction(acc, row, project, sessionId);
}

function ingestUser(acc, row, msg, t, sessionId, project) {
  const state = sessionState(acc, sessionId);
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) if (block?.type === "tool_result") ingestToolResult(acc, block, t, state, project);
  }
  if (row.isMeta) return; // skill bodies, hook feedback and other text the person didn't type
  const words = promptText(msg.content);
  if (words === null) return; // tool results are not things the person typed
  if (/^\[Request interrupted/.test(words)) {
    acc.interrupts++;
    state.interrupted = true;
    return;
  }
  if (words.startsWith("<")) return; // slash commands, local command output, system notices

  acc.prompts++;
  const wordList = words.split(/\s+/).filter(Boolean);
  acc.promptWords += wordList.length;
  acc.longestPrompt = Math.max(acc.longestPrompt, wordList.length);
  acc.please += count(words, PLEASE);
  acc.thanks += count(words, THANKS);
  acc.swears += count(words, SWEAR);
  acc.projects.set(project, (acc.projects.get(project) ?? 0) + 1);
  acc.events.push([t, sessionId, 1]);
  noteReturn(acc, state, t, project);

  // The previous prompt in this session is judged by what came next: a correction or a stop.
  if (state.prevBucket >= 0) {
    const corrected = state.interrupted || isCorrection(words);
    const bucket = acc.buckets[state.prevBucket];
    bucket.prompts++;
    acc.judged.prompts++;
    const pd = projectDetail(acc, state.prevProject);
    pd.judged++;
    const day = dayStats(acc, dayKey(new Date(t)));
    day.judged++;
    if (corrected) {
      bucket.corrected++;
      acc.judged.corrected++;
      pd.corrected++;
      day.corrected++;
    }
  }
  state.prevBucket = promptBucket(wordList.length);
  state.prevProject = project;
  state.interrupted = false;
}

function ingestToolResult(acc, block, t, state, project) {
  const pending = acc.pendingTools.get(block.tool_use_id);
  acc.pendingTools.delete(block.tool_use_id);
  const name = pending?.name ?? "unknown";
  const stats = acc.toolResults.get(name) ?? { results: 0, errors: 0 };
  stats.results++;
  acc.toolResults.set(name, stats);
  const pd = projectDetail(acc, project);
  pd.results++;

  const failed = block.is_error === true && !NOT_A_FAILURE.test(resultText(block.content));
  if (!failed && pending?.read) ingestRead(acc, pending.read, block.content, state, pd);
  if (!failed) {
    if (state.errRun >= LOOP_ERRORS) {
      const ms = Math.max(0, t - state.loopStart);
      acc.loops.ms += ms;
      pd.loopMs += ms;
    }
    state.errRun = 0;
    return;
  }
  stats.errors++;
  pd.errors++;
  if (pending?.command) {
    acc.failingCommands.set(pending.command, (acc.failingCommands.get(pending.command) ?? 0) + 1);
    pd.commands.set(pending.command, (pd.commands.get(pending.command) ?? 0) + 1);
  }
  state.errRun++;
  if (state.errRun === 1) state.loopStart = t;
  if (state.errRun === LOOP_ERRORS) {
    acc.loops.count++;
    pd.loops++;
  }
}

function ingestAssistant(acc, row, msg, t, sessionId, project) {
  const key = msg.id ? `${msg.id}:${row.requestId ?? ""}` : null;
  const fresh = !key || !acc.seenMessages.has(key);
  if (key) acc.seenMessages.add(key);
  acc.events.push([t, sessionId, 2]);

  // Claude Code writes each block of a response as its own line, all with the same message id,
  // so blocks are de-duplicated on their own and usage once per response.
  const state = sessionState(acc, sessionId);
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  if (state.response && state.response.key === key) {
    for (const block of blocks) if (block?.type === "tool_use" && block.name) state.response.tools.push(block.name);
  }
  for (const block of blocks) {
    if (block?.type === "tool_use" && block.name) {
      const blockKey = block.id ? `tool:${block.id}` : null;
      if (blockKey && acc.seenBlocks.has(blockKey)) continue;
      if (blockKey) acc.seenBlocks.add(blockKey);
      else if (!fresh) continue;
      acc.tools.set(block.name, (acc.tools.get(block.name) ?? 0) + 1);
      if (EDIT_TOOLS.has(block.name)) ingestEdit(acc, block.input, state);
      else if (block.name === "Bash") forgetMentioned(state, block.input?.command);
      if (block.id) acc.pendingTools.set(block.id, { name: block.name, command: block.name === "Bash" ? commandKey(block.input?.command) : "", read: block.name === "Read" ? readKey(block.input) : null });
    } else if (block?.type === "text" && typeof block.text === "string") {
      const blockKey = `text:${key}:${block.text.length}:${block.text.slice(0, 80)}`;
      if (acc.seenBlocks.has(blockKey)) continue;
      acc.seenBlocks.add(blockKey);
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
    cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
  const parts = costParts(info, usage);
  const m = acc.models.get(info.label) ?? { family: info.family, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, messages: 0 };
  m.input += usage.input;
  m.output += usage.output;
  m.cacheWrite += usage.cacheWrite;
  m.cacheRead += usage.cacheRead;
  m.cost += parts.total;
  m.messages++;
  acc.models.set(info.label, m);
  const day = dayKey(new Date(t));
  acc.costByDay.set(day, (acc.costByDay.get(day) ?? 0) + parts.total);
  for (const k of ["input", "output", "cacheWrite", "cacheRead"]) acc.spend[k] += parts[k];

  const pd = projectDetail(acc, project);
  pd.cost += parts.total;
  ingestContext(acc, info, usage, state, pd);
  ingestCache(acc, info, usage, parts, t, state, pd);
  if (!row.isSidechain) ingestRereadCarry(acc, info, usage, state, pd);

  // The rest of this response arrives on later lines; judge the previous one now.
  settleResponse(acc, state);
  const tools = blocks.filter((b) => b?.type === "tool_use" && b.name).map((b) => b.name);
  state.response = { key, info, usage, parts, tools, project };
}

// Call once all lines are read: settles responses still waiting for their last blocks.
export function settleAccumulator(acc) {
  for (const state of acc.sessionState.values()) settleResponse(acc, state);
}

function settleResponse(acc, state) {
  const r = state.response;
  state.response = null;
  if (r) ingestFit(acc, r.info, r.usage, r.parts, r.tools, projectDetail(acc, r.project));
}

// A prompt after a long break in a big session starts what is probably a new task. From here on,
// the earlier context rides along on every request; a fresh session would have cost one small write.
function noteReturn(acc, state, t, project) {
  const carry = state.lastCtx - FRESH_CONTEXT;
  if (state.lastPrompt && t - state.lastPrompt >= TASK_GAP && carry >= MIN_CARRY) {
    state.carry = carry;
    acc.context.returns++;
    acc.context.carriedTokens += carry;
    if (state.lastInfo?.priced) {
      const fresh = (FRESH_CONTEXT * state.lastInfo.cacheWrite) / 1e6;
      acc.context.freshCost += fresh;
      projectDetail(acc, project).fresh += fresh;
    }
  }
  state.lastPrompt = t;
}

// Prices the old context still carried after a return, as the cache reads it costs. Re-caching after
// the break itself belongs to the cold-cache finding, so only reads count here.
function ingestContext(acc, info, usage, state, pd) {
  const ctx = usage.input + usage.cacheRead + usage.cacheWrite;
  acc.context.requests++;
  if (ctx > HUGE_CONTEXT) acc.context.huge++;
  acc.context.max = Math.max(acc.context.max, ctx);
  state.lastCtx = ctx;
  state.lastInfo = info;
  if (!state.carry || !info.priced) return;
  const stale = Math.min(state.carry, usage.cacheRead, ctx - FRESH_CONTEXT);
  if (stale <= 0) return;
  const cost = (stale * info.cacheRead) / 1e6;
  acc.context.stale += cost;
  pd.stale += cost;
}

// After a pause longer than the cache lifetime, the whole context is written to the cache again.
function ingestCache(acc, info, usage, parts, t, state, pd) {
  if (usage.cacheWrite1h > 0) state.uses1h = true;
  const ttl = state.uses1h ? TTL_1H : TTL_5M;
  const gap = state.lastRequest ? t - state.lastRequest : 0;
  state.lastRequest = Math.max(state.lastRequest, t);
  if (!info.priced) return;
  // On the 5-minute cache: what a 1-hour TTL would cost more on every write, and what it would save.
  if (!state.uses1h) acc.cold.ttlExtra += (usage.cacheWrite * info.input * 0.75) / 1e6;
  if (gap <= ttl || usage.cacheWrite < COLD_REWRITE_MIN) return;
  const extra = Math.max(0, parts.cacheWrite - (usage.cacheWrite * info.cacheRead) / 1e6);
  acc.cold.events++;
  acc.cold.cost += extra;
  pd.cold += extra;
  if (!state.uses1h && gap <= TTL_1H) acc.cold.ttlAvoidable += extra;
}

// A file read again in the same session while the earlier copy is still in the conversation: same
// file, same lines, no edit, no shell command naming it and no compaction in between. Changes made
// in the person's own editor can't be seen, so a few of these may be legitimate.
function ingestRead(acc, read, content, state, pd) {
  acc.reread.reads++;
  const tokens = Math.ceil(resultLength(content) / CHARS_PER_TOKEN);
  const seen = state.reads.has(read.key);
  state.reads.add(read.key);
  if (!seen || tokens < MIN_REREAD_TOKENS) return;
  acc.reread.count++;
  acc.reread.tokens += tokens;
  pd.rereads++;
  const name = read.path.split(/[\\/]/).pop();
  acc.reread.files.set(name, (acc.reread.files.get(name) ?? 0) + 1);
  state.rereadNew += tokens;
}

// A shell command that names a read file may have changed it (sed -i, a script, a generator):
// reading it again afterwards is fair.
function forgetMentioned(state, command) {
  if (typeof command !== "string" || !state.reads.size) return;
  for (const key of state.reads) {
    const name = key.slice(0, key.indexOf("\n")).split(/[\\/]/).pop();
    if (name && command.includes(name)) state.reads.delete(key);
  }
}

// The duplicate copy is written to the cache once, then read back on every later request until
// a compaction drops it.
function ingestRereadCarry(acc, info, usage, state, pd) {
  if (!info.priced || (!state.rereadNew && !state.rereadCarry)) return;
  const read = Math.min(state.rereadCarry, usage.cacheRead);
  const cost = (state.rereadNew * info.cacheWrite + read * info.cacheRead) / 1e6;
  state.rereadCarry += state.rereadNew;
  state.rereadNew = 0;
  acc.reread.cost += cost;
  pd.rereadCost += cost;
}

// A premium model answering with read-only tool calls and a short reply: work a cheaper model does well.
function ingestFit(acc, info, usage, parts, tools, pd) {
  if (!PREMIUM.has(info.family) || usage.output > FIT_MAX_OUTPUT) return;
  if (!tools.length || !tools.every((name) => LIGHT_TOOLS.has(name))) return;
  const alt = costParts(modelInfo(FIT_MODEL), usage).total;
  if (alt >= parts.total) return;
  acc.fit.requests++;
  acc.fit.cost += parts.total;
  acc.fit.altCost += alt;
  pd.fitSave += parts.total - alt;
}

function ingestCompaction(acc, row, project, sessionId) {
  const state = sessionState(acc, sessionId);
  state.carry = 0; // what grows after a compaction is new work
  state.reads.clear(); // file contents are gone from the context, so reading them again is fine
  state.rereadNew = 0;
  state.rereadCarry = 0;
  const meta = row.compactMetadata || {};
  if (meta.trigger === "manual") acc.compactions.manual++;
  else acc.compactions.auto++;
  acc.compactions.preTokens += meta.preTokens || 0;
  projectDetail(acc, project).compactions++;
}

// Only the file extension matters; paths stay in memory and never reach the story.
function ingestEdit(acc, input, state) {
  const path = input?.file_path || input?.notebook_path;
  if (typeof path !== "string") return;
  acc.editedFiles.add(path);
  for (const key of state.reads) if (key.startsWith(path + "\n")) state.reads.delete(key); // changed: reading it again is right
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const language = ext && LANGUAGES[ext];
  if (language) acc.languages.set(language, (acc.languages.get(language) ?? 0) + 1);
}

export function isCorrection(text) {
  const s = String(text).trim().replace(FILLER, "");
  return CORRECTION_EN.test(s) || CORRECTION_RU.test(s);
}

export function promptBucket(words) {
  return PROMPT_BUCKETS.findIndex((max) => words <= max);
}

// "cd app && FOO=1 npm run test -- --watch" -> "npm run"; only the tool, never arguments or paths.
export function commandKey(command) {
  if (typeof command !== "string") return "";
  const segments = command.split("\n")[0].split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  const main = segments.find((s) => !/^(cd|export|source|set|\.)\s/.test(s)) ?? "";
  const words = main.split(/\s+/).filter((w) => !/^\w+=/.test(w));
  const first = (words[0] || "").split("/").pop();
  if (!first) return "";
  const plain = (w) => (w && !w.startsWith("-") && !w.includes("/") ? w : "");
  const second = plain(words[1]);
  if (!RUNNERS.has(first) || !second) return first.slice(0, 40);
  // "npm run build", "pnpm exec vitest": the script name is the useful part.
  const third = /^(run|exec|x|run-script)$/.test(second) ? plain(words[2]) : "";
  return [first, second, third].filter(Boolean).join(" ").slice(0, 40);
}

export function subagentCalls(tools) {
  let n = 0;
  for (const [name, calls] of tools) if (SUBAGENT_TOOLS.has(name)) n += calls;
  return n;
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sessionState(acc, id) {
  let s = acc.sessionState.get(id);
  if (!s) {
    s = {
      lastRequest: 0, uses1h: false, errRun: 0, loopStart: 0, prevBucket: -1, prevProject: "", interrupted: false, response: null,
      lastPrompt: 0, lastCtx: 0, lastInfo: null, carry: 0,
      reads: new Set(), rereadNew: 0, rereadCarry: 0, // "path\noffset\nlimit" of reads still in context
    };
    acc.sessionState.set(id, s);
  }
  return s;
}

function projectDetail(acc, name) {
  let p = acc.projectDetail.get(name);
  if (!p) {
    p = { cost: 0, stale: 0, fresh: 0, cold: 0, fitSave: 0, rereads: 0, rereadCost: 0, results: 0, errors: 0, loops: 0, loopMs: 0, judged: 0, corrected: 0, compactions: 0, commands: new Map() };
    acc.projectDetail.set(name, p);
  }
  return p;
}

function dayStats(acc, key) {
  let d = acc.byDay.get(key);
  if (!d) {
    d = { judged: 0, corrected: 0 };
    acc.byDay.set(key, d);
  }
  return d;
}

// Returns the typed text of a user message, or null when it only carries tool results.
function promptText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return null;
  const texts = content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
  return texts.length ? texts.join(" ").trim() : null;
}

// "Read this file, these lines": a repeat only counts when it asks for the same part again.
function readKey(input) {
  const path = input?.file_path;
  if (typeof path !== "string" || !path) return null;
  return { path, key: `${path}\n${input.offset ?? ""}\n${input.limit ?? ""}` };
}

function resultLength(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, b) => n + (typeof b?.text === "string" ? b.text.length : 0), 0);
}

function resultText(content) {
  if (typeof content === "string") return content.slice(0, 300);
  if (Array.isArray(content)) return content.map((b) => (typeof b?.text === "string" ? b.text : "")).join(" ").slice(0, 300);
  return "";
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
export function projectFromPath(path) {
  const parts = path.split("/");
  const dir = parts.length > 1 ? parts[parts.length - 2] : "";
  const segs = dir.split("-").filter(Boolean);
  return segs[segs.length - 1] || "unknown";
}
