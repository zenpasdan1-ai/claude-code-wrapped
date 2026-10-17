import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { periodRange } from "../js/period.js";
import { createAccumulator, ingestLine } from "../js/parse.js";
import { finalize } from "../js/stats.js";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const HOUR = 3_600_000;

describe("period picker", () => {
  test("all time has no window", () => {
    assert.equal(periodRange("all", NOW), null);
  });

  test("19h reaches back exactly 19 hours", () => {
    assert.deepEqual(periodRange("19h", NOW), { from: NOW - 19 * HOUR, to: Infinity });
  });

  test("19h keeps recent activity and drops older activity", () => {
    const spent = (range) => {
      const acc = createAccumulator(range);
      for (const hoursAgo of [1, 18, 20, 40, 200]) ingestLine(acc, line(hoursAgo));
      return finalize(acc).cost;
    };
    const all = spent(null);
    const last19 = spent(periodRange("19h", NOW));
    assert.ok(last19 > 0);
    assert.ok(last19 < all);
    assert.ok(Math.abs(last19 - (all * 2) / 5) < 1e-9);
  });
});

function line(hoursAgo) {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(NOW - hoursAgo * HOUR).toISOString(),
    sessionId: "s" + Math.floor(hoursAgo / 24),
    cwd: "/x/proj",
    message: {
      id: "m" + hoursAgo,
      model: "claude-opus-5-5",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 100, output_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 50000 },
    },
  });
}
