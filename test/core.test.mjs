import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createAccumulator, ingestLine } from "../js/parse.js";
import { archetype, finalize } from "../js/stats.js";
import { costOf, modelInfo } from "../js/pricing.js";
import { demoAccumulator, demoLines } from "../js/demo.js";

const T0 = Date.parse("2026-09-01T10:00:00Z");
const MIN = 60_000;
const DAY = 86_400_000;

describe("pricing", () => {
  test("matches the longest model prefix, including dated ids", () => {
    assert.equal(modelInfo("claude-opus-4-1-20250805").label, "Opus 4.1");
    assert.equal(modelInfo("claude-opus-4-20250514").label, "Opus 4");
    assert.equal(modelInfo("claude-fable-5-1").label, "Fable 5.1");
    assert.equal(modelInfo("claude-fable-5").label, "Fable 5");
  });

  test("prices a million of each token type", () => {
    const info = modelInfo("claude-opus-5-5");
    const cost = costOf(info, { input: 1e6, output: 1e6, cacheWrite: 1e6, cacheRead: 1e6 });
    assert.equal(cost, 4 + 20 + 5 + 0.2);
  });

  test("unknown models count tokens but cost nothing", () => {
    const info = modelInfo("some-future-model");
    assert.equal(info.priced, false);
    assert.equal(costOf(info, { input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 0 }), 0);
  });
});

describe("parsing", () => {
  test("ignores blank and malformed lines", () => {
    const acc = createAccumulator();
    ingestLine(acc, "");
    ingestLine(acc, "{not json");
    assert.equal(acc.badLines, 1);
    assert.equal(acc.prompts, 0);
  });

  test("counts typed prompts but not tool results, commands or interrupts", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "please fix it, thanks"));
    ingestLine(acc, user(T0 + MIN, [{ type: "tool_result", content: "ok" }]));
    ingestLine(acc, user(T0 + 2 * MIN, "<command-name>/clear</command-name>"));
    ingestLine(acc, user(T0 + 3 * MIN, "[Request interrupted by user]"));
    assert.equal(acc.prompts, 1);
    assert.equal(acc.please, 1);
    assert.equal(acc.thanks, 1);
    assert.equal(acc.interrupts, 1);
  });

  test("deduplicates streamed copies of the same assistant message", () => {
    const acc = createAccumulator();
    const line = assistant(T0, "msg_1", "req_1", "claude-sonnet-5-5", 1000, ["Bash"], "You're absolutely right.");
    ingestLine(acc, line);
    ingestLine(acc, line);
    const m = acc.models.get("Sonnet 5.5");
    assert.equal(m.messages, 1);
    assert.equal(m.output, 1000);
    assert.equal(acc.tools.get("Bash"), 1);
    assert.equal(acc.absolutelyRight, 1);
  });

  test("skips lines outside the chosen period", () => {
    const acc = createAccumulator({ from: T0, to: T0 + DAY });
    ingestLine(acc, user(T0 - MIN, "too early"));
    ingestLine(acc, user(T0 + MIN, "inside"));
    ingestLine(acc, user(T0 + 2 * DAY, "too late"));
    assert.equal(acc.prompts, 1);
    assert.equal(acc.lines, 3);
  });

  test("maps edited files to languages and keeps the longest prompt", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "one two three four"));
    ingestLine(acc, assistant(T0, "m1", "r1", "claude-opus-5-5", 10, [["Edit", { file_path: "/app/a.ts" }], ["Write", { file_path: "/app/b.TSX" }]]));
    ingestLine(acc, assistant(T0, "m2", "r2", "claude-opus-5-5", 10, [["Edit", { file_path: "/app/a.ts" }], ["Edit", { file_path: "/app/c.py" }], ["Edit", { file_path: "/app/Makefile" }]]));
    ingestLine(acc, assistant(T0, "m3", "r3", "claude-opus-5-5", 10, [["Task", { prompt: "look around" }], ["Agent", {}]]));
    const s = finalize(acc);
    assert.deepEqual(s.languages, [["TypeScript", 3], ["Python", 1]]);
    assert.equal(s.topLanguage, "TypeScript");
    assert.equal(s.editedFiles, 4);
    assert.equal(s.longestPrompt, 4);
    assert.equal(s.subagents, 2);
  });

  test("headline language skips config and markdown", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "go"));
    const edits = [["Edit", { file_path: "a.json" }], ["Edit", { file_path: "b.yaml" }], ["Edit", { file_path: "c.go" }]];
    ingestLine(acc, assistant(T0, "m1", "r1", "claude-opus-5-5", 10, edits));
    assert.equal(finalize(acc).topLanguage, "Go");
  });
});

describe("stats", () => {
  test("active time skips idle gaps over 30 minutes", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "a"));
    ingestLine(acc, user(T0 + 20 * MIN, "b"));
    ingestLine(acc, user(T0 + 120 * MIN, "c")); // 100 min idle, not counted
    const s = finalize(acc);
    assert.equal(Math.round(s.hours * 60), 20);
    assert.equal(s.sessions, 1);
  });

  test("finds the longest run of consecutive active days", () => {
    const acc = createAccumulator();
    for (const day of [0, 1, 2, 5, 6]) ingestLine(acc, user(T0 + day * 86_400_000, "go"));
    assert.equal(finalize(acc).streak, 3);
  });

  test("finds the most expensive day", () => {
    const acc = createAccumulator();
    ingestLine(acc, user(T0, "go"));
    ingestLine(acc, assistant(T0, "m1", "r1", "claude-opus-5-5", 1_000_000));
    ingestLine(acc, assistant(T0 + 3 * DAY, "m2", "r2", "claude-opus-5-5", 2_000_000));
    const s = finalize(acc);
    assert.equal(s.priciestDay.day, localDay(T0 + 3 * DAY));
    assert.ok(Math.abs(s.priciestDay.cost - 40) < 0.01);
  });

  test("returns null when there is nothing to show", () => {
    assert.equal(finalize(createAccumulator()), null);
  });

  test("demo data produces a complete story", () => {
    const s = finalize(demoAccumulator());
    assert.ok(s.prompts > 500);
    assert.ok(s.cost > 0);
    assert.ok(s.models.length >= 3);
    assert.ok(typeof s.archetype === "string");
  });
});

describe("archetypes", () => {
  test("nobody stands out: the steady shipper", () => {
    assert.equal(archetype(profile()), "steadyShipper");
  });

  test("mostly after 10 pm: the night owl", () => {
    assert.equal(archetype(profile({ nightShare: 0.6 })), "nightOwl");
  });

  test("the strongest signal wins", () => {
    const s = profile({ nightShare: 0.33, please: 200, thanks: 100 }); // night 1.1× its bar, polite 2×
    assert.equal(archetype(s), "politeCoder");
  });

  test("model families count by share of output", () => {
    const s = profile({ models: [{ family: "fable", share: 0.7 }, { family: "sonnet", share: 0.3 }] });
    assert.equal(archetype(s), "fableFlyer");
  });
});

describe("demo", () => {
  test("is the same every time for the same day", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    assert.deepEqual(demoLines(now), demoLines(now));
  });

  test("respects the chosen period", () => {
    const from = Date.now() - 30 * DAY;
    const s = finalize(demoAccumulator({ from, to: Infinity }));
    assert.ok(s.from >= from);
    assert.ok(s.prompts < finalize(demoAccumulator()).prompts);
  });
});

function user(t, content, sessionId = "s1") {
  return JSON.stringify({ type: "user", sessionId, cwd: "/home/me/app", timestamp: new Date(t).toISOString(), message: { role: "user", content } });
}

// tools: names, or [name, input] pairs when the input matters.
function assistant(t, id, requestId, model, output, tools = [], text = "") {
  const content = tools.map((tool, i) => {
    const [name, input] = Array.isArray(tool) ? tool : [tool, {}];
    return { type: "tool_use", id: `${id}_t${i}`, name, input };
  });
  if (text) content.unshift({ type: "text", text });
  return JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    requestId,
    timestamp: new Date(t).toISOString(),
    message: { id, role: "assistant", model, content, usage: { input_tokens: 10, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}

function profile(overrides = {}) {
  return {
    nightShare: 0.1,
    earlyShare: 0.1,
    weekendShare: 0.2,
    models: [{ family: "sonnet", share: 1 }],
    longest: { ms: 3_600_000 },
    prompts: 1000,
    please: 10,
    thanks: 10,
    toolsPerPrompt: 2,
    streak: 5,
    ...overrides,
  };
}

function localDay(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
