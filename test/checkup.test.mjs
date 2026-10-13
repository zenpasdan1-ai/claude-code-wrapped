import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { commandKey, createAccumulator, ingestLine, isCorrection } from "../js/parse.js";
import { costOf, modelInfo } from "../js/pricing.js";
import { finalize } from "../js/stats.js";
import { demoAccumulator } from "../js/demo.js";
import { buildFixes, claudeMdAdditions } from "../js/fixes.js";
import { formatReport } from "../lib/terminal-report.mjs";

const T0 = Date.parse("2026-09-01T10:00:00Z");
const SEC = 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const OPUS = "claude-opus-5-5";

describe("reading what the person typed", () => {
  test("recognizes corrections in English and Russian", () => {
    for (const text of ["no, that's not what I meant", "Still broken", "ok, undo that", "it doesn't work", "I meant the other file", "Так это абсолютно не то что в референсе", "Все равно не похоже", "Это же вообще не настолько детально", "Я имел ввиду 5 скиллов", "нет, верни как было"]) {
      assert.ok(isCorrection(text), text);
    }
    for (const text of ["now add pagination", "nothing else to add", "notice the header", "Нормально, продолжай", "Сделай сервер", "stopwatch component please"]) {
      assert.ok(!isCorrection(text), text);
    }
  });

  test("skips meta lines and system notices when counting prompts", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "Base directory for this skill: /x", { isMeta: true }));
    ingestLine(acc, user(T0, "<task-notification> done </task-notification>"));
    ingestLine(acc, user(T0, "<command-name>/model</command-name>"));
    ingestLine(acc, user(T0, "build the landing page"));
    assert.equal(acc.prompts, 1);
  });

  test("judges each prompt by the next one, per length bucket", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "fix it"));
    ingestLine(acc, user(T0 + MIN, "no, that's wrong"));
    ingestLine(acc, user(T0 + 2 * MIN, words(30)));
    ingestLine(acc, user(T0 + 3 * MIN, "[Request interrupted by user]", { block: true }));
    ingestLine(acc, user(T0 + 4 * MIN, "thanks, next one"));
    assert.deepEqual(acc.judged, { prompts: 3, corrected: 2 });
    assert.deepEqual(acc.buckets[0], { prompts: 2, corrected: 1 }); // "fix it" corrected, "no, that's wrong" not
    assert.deepEqual(acc.buckets[1], { prompts: 1, corrected: 1 }); // stopped
  });

  test("keeps a session in the folder it started in", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "go", { cwd: "/code/app" }));
    ingestLine(acc, user(T0 + MIN, "and now this", { cwd: "/code/app/packages/ui" }));
    assert.deepEqual([...acc.projects.keys()], ["app"]);
  });
});

describe("tool calls", () => {
  test("names commands by tool and script, never by arguments", () => {
    assert.equal(commandKey("cd app && npm run build -- --watch"), "npm run build");
    assert.equal(commandKey("FOO=1 pnpm exec vitest run src/a.test.ts"), "pnpm exec vitest");
    assert.equal(commandKey("git push origin main"), "git push");
    assert.equal(commandKey("./node_modules/.bin/tsc -p ."), "tsc");
    assert.equal(commandKey("pytest -q tests/test_api.py"), "pytest");
    assert.equal(commandKey(undefined), "");
  });

  test("three failures in a row make a stuck loop that ends at the next success", () => {
    const acc = createAccumulator();
    let t = T0;
    for (let i = 0; i < 4; i++) {
      ingestLine(acc, assistant(t, `m${i}`, OPUS, [["Bash", { command: "npm test" }]]));
      ingestLine(acc, toolResult((t += 30 * SEC), `m${i}_t0`, true));
    }
    ingestLine(acc, assistant(t, "m9", OPUS, [["Bash", { command: "npm test" }]]));
    ingestLine(acc, toolResult((t += 30 * SEC), "m9_t0", false));
    assert.equal(acc.loops.count, 1);
    assert.equal(acc.loops.ms, 4 * 30 * SEC);
    assert.equal(acc.failingCommands.get("npm test"), 4);
    assert.deepEqual(acc.toolResults.get("Bash"), { results: 5, errors: 4 });
  });

  test("a rejected or interrupted tool call is not a failure", () => {
    const acc = createAccumulator();
    ingestLine(acc, assistant(T0, "m1", OPUS, [["Bash", { command: "rm -rf build" }]]));
    ingestLine(acc, toolResult(T0 + SEC, "m1_t0", true, "The user doesn't want to proceed with this tool use. The tool use was rejected"));
    assert.equal(acc.toolResults.get("Bash").errors, 0);
  });

  test("counts tool calls written on later lines of the same response", () => {
    const acc = createAccumulator();
    const usage = { output: 100 };
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [{ type: "thinking", thinking: "..." }], usage));
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [{ type: "tool_use", id: "a", name: "Read", input: {} }], usage));
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [{ type: "tool_use", id: "b", name: "Grep", input: {} }], usage));
    ingestLine(acc, user(T0 + MIN, "go on"));
    const s = finalize(acc);
    assert.equal(s.toolCalls, 2);
    assert.equal(acc.models.get("Opus 5.5").messages, 1);
    assert.equal(acc.fit.requests, 1); // the whole response only read, so it fits a cheaper model
  });
});

describe("money", () => {
  test("prices 1-hour cache writes at twice the input price", () => {
    const info = modelInfo(OPUS);
    assert.equal(costOf(info, { input: 0, output: 0, cacheWrite: 1e6, cacheWrite1h: 1e6, cacheRead: 0 }), 8);
    assert.equal(costOf(info, { input: 0, output: 0, cacheWrite: 1e6, cacheWrite1h: 0, cacheRead: 0 }), 5);
  });

  test("a big context alone costs nothing extra: a hard task needs it", () => {
    const acc = createAccumulator();
    for (let i = 0; i < 10; i++) {
      ingestLine(acc, user(T0 + i * MIN, "keep going"));
      ingestLine(acc, assistantBlocks(T0 + i * MIN + SEC, `m${i}`, OPUS, [], { input: 0, cacheRead: 400_000 }));
    }
    assert.equal(acc.context.stale, 0);
    assert.equal(acc.context.huge, 10);
  });

  test("after an hour's break, the old context counts as carried until a compaction", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "build the parser"));
    ingestLine(acc, assistantBlocks(T0 + SEC, "m1", OPUS, [], { input: 0, cacheRead: 300_000 }));
    ingestLine(acc, user(T0 + 2 * HOUR, "now the landing page"));
    ingestLine(acc, assistantBlocks(T0 + 2 * HOUR + SEC, "m2", OPUS, [], { input: 0, cacheWrite: 310_000 })); // re-cache: cold, not counted here
    ingestLine(acc, assistantBlocks(T0 + 2 * HOUR + MIN, "m3", OPUS, [], { input: 0, cacheRead: 320_000 }));
    ingestLine(acc, compaction(T0 + 2 * HOUR + 2 * MIN));
    ingestLine(acc, assistantBlocks(T0 + 2 * HOUR + 3 * MIN, "m4", OPUS, [], { input: 0, cacheRead: 330_000 }));
    assert.equal(acc.context.returns, 1);
    assert.ok(Math.abs(acc.context.stale - (280_000 * 0.2) / 1e6) < 1e-9); // carry = 300k - a 20k fresh start
    assert.ok(Math.abs(acc.context.freshCost - (20_000 * 5) / 1e6) < 1e-9);
  });

  test("on the 5-minute cache, weighs the 1-hour TTL against its pricier writes", () => {
    const acc = createAccumulator();
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [], { input: 0, cacheWrite: 100_000 }));
    ingestLine(acc, assistantBlocks(T0 + 30 * MIN, "m2", OPUS, [], { input: 0, cacheWrite: 100_000 })); // would have survived 1h
    ingestLine(acc, assistantBlocks(T0 + 3 * HOUR, "m3", OPUS, [], { input: 0, cacheWrite: 100_000 })); // would not
    assert.equal(acc.cold.events, 2);
    assert.ok(Math.abs(acc.cold.ttlAvoidable - (100_000 * (5 - 0.2)) / 1e6) < 1e-9);
    assert.ok(Math.abs(acc.cold.ttlExtra - (300_000 * 4 * 0.75) / 1e6) < 1e-9);
  });

  test("uses the published cache-read prices and Haiku 5.5's long-prompt tier", () => {
    assert.equal(modelInfo("claude-sonnet-5-5").cacheRead, 0.1);
    const haiku = modelInfo("claude-haiku-5-5");
    assert.equal(costOf(haiku, { input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 }), 0.5); // over 100k: $0.50
    assert.equal(costOf(haiku, { input: 50_000, output: 0, cacheWrite: 0, cacheRead: 0 }), 0.005); // under: $0.10
  });

  test("a pause longer than the cache lifetime counts the re-cache as extra", () => {
    const acc = createAccumulator();
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [], { cacheWrite: 50_000 }));
    ingestLine(acc, assistantBlocks(T0 + 2 * MIN, "m2", OPUS, [], { cacheWrite: 60_000 })); // within 5 min
    ingestLine(acc, assistantBlocks(T0 + 30 * MIN, "m3", OPUS, [], { cacheWrite: 100_000 }));
    assert.equal(acc.cold.events, 1);
    assert.ok(Math.abs(acc.cold.cost - (100_000 * (5 - 0.2)) / 1e6) < 1e-9);
  });

  test("with the 1-hour cache, only pauses over an hour count", () => {
    const acc = createAccumulator();
    ingestLine(acc, assistantBlocks(T0, "m1", OPUS, [], { cacheWrite: 50_000, cacheWrite1h: 50_000 }));
    ingestLine(acc, assistantBlocks(T0 + 30 * MIN, "m2", OPUS, [], { cacheWrite: 80_000, cacheWrite1h: 80_000 }));
    assert.equal(acc.cold.events, 0);
  });
});

describe("checkup", () => {
  test("a small, healthy history has no findings", () => {
    const acc = createAccumulator();
    for (let i = 0; i < 30; i++) {
      ingestLine(acc, user(T0 + i * MIN, "please add the next endpoint with tests"));
      ingestLine(acc, assistantBlocks(T0 + i * MIN + SEC, `m${i}`, OPUS, [{ type: "tool_use", id: `e${i}`, name: "Edit", input: { file_path: "a.ts" } }], { cacheRead: 20_000, output: 400 }));
    }
    const c = finalize(acc).checkup;
    assert.deepEqual(c.findings, []);
    assert.deepEqual(c.healthy.map((h) => h.id).sort(), ["cold", "context", "corrections", "fit"]);
  });

  test("demo data surfaces every kind of finding, most important first", () => {
    const c = finalize(demoAccumulator()).checkup;
    const ids = c.findings.map((f) => f.id);
    for (const id of ["context", "cold", "fit", "loops", "corrections", "promptLength"]) assert.ok(ids.includes(id), id);
    const ranks = c.findings.map((f) => ["high", "medium", "low"].indexOf(f.level));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.ok(c.savings > 0 && c.savings < c.total);
    assert.ok(c.week.prev);
  });

  test("the terminal report lists findings with their fixes", () => {
    const text = formatReport(finalize(demoAccumulator()));
    assert.match(text, /^Claude Code Checkup/); // English unless asked otherwise
    assert.match(text, /^Start here$/m);
    assert.match(text, /\/compact/);
    assert.match(text, /CLAUDE\.md/);
    assert.doesNotMatch(text, /\x1b\[/); // no colors unless asked
  });
});

describe("priorities", () => {
  test("money findings rank by monthly value at this person's pace", () => {
    const c = finalize(demoAccumulator()).checkup;
    const cold = c.findings.find((f) => f.id === "cold");
    assert.equal(cold.level, "high");
    assert.ok(Math.abs(cold.monthly - (cold.save * 30) / c.days) < 1e-9);
    assert.ok(c.savingsMonthly > 0);
  });

  test("compares spend per active day with Anthropic's published average", () => {
    const s = finalize(demoAccumulator());
    assert.ok(Math.abs(s.checkup.perActiveDay - s.cost / s.activeDays) < 1e-9);
    assert.equal(s.checkup.benchmarkDay, 13);
  });

  test("the plan holds up to three findings and nothing minor", () => {
    const c = finalize(demoAccumulator()).checkup;
    assert.ok(c.plan.length > 0 && c.plan.length <= 3);
    assert.ok(c.plan.every((f) => f.level !== "low"));
  });

  test("a short history shows totals, not a monthly pace", () => {
    const c = finalize(carriedSession(200)).checkup;
    const context = c.findings.find((f) => f.id === "context");
    assert.equal(context.monthly, null);
    assert.equal(c.savingsMonthly, null);
    assert.equal(context.level, "high"); // ~$15 and most of the spend, judged on the total
  });

  test("a big share of a tiny spend is still minor", () => {
    const c = finalize(carriedSession(20)).checkup; // ~$1.40 in total
    assert.equal(c.findings.find((f) => f.id === "context").level, "low");
  });
});

describe("copy-paste fixes", () => {
  test("every finding comes with something to paste", () => {
    for (const f of finalize(demoAccumulator()).checkup.findings) assert.ok(buildFixes(f).length > 0, f.id);
  });

  test("each project gets only its own failing commands, repeated failures only", () => {
    const acc = createAccumulator();
    let t = T0;
    const fail = (session, cwd, command, n) => {
      for (let i = 0; i < n; i++) {
        const id = `${session}${i}`;
        ingestLine(acc, assistantIn(t, id, session, cwd, [["Bash", { command }]]));
        ingestLine(acc, resultIn((t += SEC), `${id}_t0`, session, cwd, true));
      }
    };
    fail("a", "/code/api", "npm test", 4);
    fail("c", "/code/api", "npm test", 3); // three stuck loops make a finding
    fail("b", "/code/app", "xcodebuild test", 3);
    fail("b", "/code/app", "swift build", 1);
    const loops = finalize(acc).checkup.findings.find((f) => f.id === "loops");
    const byProject = Object.fromEntries(buildFixes(loops).filter((x) => x.project).map((x) => [x.project, x.text]));
    assert.match(byProject.api, /`npm test`/);
    assert.doesNotMatch(byProject.api, /xcodebuild/);
    assert.match(byProject.app, /`xcodebuild test`/);
    assert.doesNotMatch(byProject.app, /swift build/); // failed once: noise, not a habit
  });

  test("the combined CLAUDE.md block has shared sections once and nothing project-specific", () => {
    const findings = finalize(demoAccumulator()).checkup.findings;
    const text = claudeMdAdditions([...findings, ...findings]);
    assert.equal(text.match(/^## /gm).length, new Set(text.match(/^## .*/gm)).size);
    assert.match(text, /^## (When something fails|Когда что-то падает)/m);
    assert.doesNotMatch(text, /^## (Commands|Команды)/m);
  });

  test("the cache TTL setting is valid JSON with the documented key, in personal settings", () => {
    const cold = { id: "cold", facts: { events: 9, ttlNet: 40, ttlWorthIt: true }, projects: [] };
    const setting = buildFixes(cold).find((x) => x.kind === "settings");
    assert.equal(setting.path, "~/.claude/settings.json");
    assert.deepEqual(JSON.parse(setting.text), { promptCacheTtl: "1h" });
    assert.equal(buildFixes({ ...cold, facts: { ...cold.facts, ttlWorthIt: false } }).some((x) => x.kind === "settings"), false);
  });

  test("the explorer subagent is read-only and runs on a cheaper model", () => {
    const fit = finalize(demoAccumulator()).checkup.findings.find((f) => f.id === "fit");
    const agent = buildFixes(fit).find((x) => x.kind === "file");
    assert.equal(agent.path, ".claude/agents/explorer.md");
    assert.match(agent.text, /^---\nname: explorer\n/);
    assert.match(agent.text, /^tools: Read, Grep, Glob$/m);
    assert.match(agent.text, /^model: sonnet$/m);
    assert.match(agent.text, /^description: .*Use proactively/m); // Claude delegates on its own
  });
});

function user(t, content, { isMeta = false, cwd = "/home/me/app", block = false, sessionId = "s1" } = {}) {
  const body = block ? [{ type: "text", text: content }] : content;
  return JSON.stringify({ type: "user", isMeta, sessionId, cwd, timestamp: new Date(t).toISOString(), message: { role: "user", content: body } });
}

function toolResult(t, id, isError, text = "Exit code 1") {
  return JSON.stringify({
    type: "user",
    sessionId: "s1",
    cwd: "/home/me/app",
    timestamp: new Date(t).toISOString(),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] },
  });
}

function assistant(t, id, model, tools) {
  const content = tools.map(([name, input], i) => ({ type: "tool_use", id: `${id}_t${i}`, name, input }));
  return assistantBlocks(t, id, model, content, { output: 300 });
}

function assistantBlocks(t, id, model, content, { input = 10, output = 200, cacheWrite = 0, cacheWrite1h = 0, cacheRead = 0 } = {}) {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    cwd: "/home/me/app",
    requestId: `req_${id}`,
    timestamp: new Date(t).toISOString(),
    message: {
      id,
      role: "assistant",
      model,
      content,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
        cache_creation: { ephemeral_1h_input_tokens: cacheWrite1h, ephemeral_5m_input_tokens: cacheWrite - cacheWrite1h },
      },
    },
  });
}

function words(n) {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

function assistantIn(t, id, sessionId, cwd, tools) {
  const row = JSON.parse(assistant(t, id, OPUS, tools));
  return JSON.stringify({ ...row, sessionId, cwd });
}

function resultIn(t, toolId, sessionId, cwd, isError) {
  const row = JSON.parse(toolResult(t, toolId, isError));
  return JSON.stringify({ ...row, sessionId, cwd });
}

// One task, a two-hour break, then `requests` more requests carrying 400k tokens of the first task.
function carriedSession(requests) {
  const acc = createAccumulator();
  ingestLine(acc, user(T0, "first task"));
  ingestLine(acc, assistantBlocks(T0 + SEC, "m0", OPUS, [], { input: 0, cacheRead: 400_000 }));
  ingestLine(acc, user(T0 + 2 * HOUR, "something else"));
  for (let i = 1; i <= requests; i++) ingestLine(acc, assistantBlocks(T0 + 2 * HOUR + i * SEC, `m${i}`, OPUS, [], { input: 0, cacheRead: 400_000 }));
  return acc;
}

function compaction(t) {
  return JSON.stringify({ type: "system", subtype: "compact_boundary", sessionId: "s1", cwd: "/home/me/app", timestamp: new Date(t).toISOString(), compactMetadata: { trigger: "auto", preTokens: 320_000 } });
}
