import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createAccumulator, ingestLine } from "../js/parse.js";
import { finalize } from "../js/stats.js";
import { costOf, modelInfo } from "../js/pricing.js";
import { demoAccumulator } from "../js/demo.js";

const T0 = Date.parse("2026-09-01T10:00:00Z");
const MIN = 60_000;

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

function user(t, content, sessionId = "s1") {
  return JSON.stringify({ type: "user", sessionId, cwd: "/home/me/app", timestamp: new Date(t).toISOString(), message: { role: "user", content } });
}

function assistant(t, id, requestId, model, output, tools = [], text = "") {
  const content = tools.map((name, i) => ({ type: "tool_use", id: `t${i}`, name, input: {} }));
  if (text) content.unshift({ type: "text", text });
  return JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    requestId,
    timestamp: new Date(t).toISOString(),
    message: { id, role: "assistant", model, content, usage: { input_tokens: 10, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
}
