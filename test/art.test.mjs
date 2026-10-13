import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { ART, checkBudget, generateImage, parseArgs, parseLog, pngSize, resolveTargets, totalCharged } from "../tools/art.mjs";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const SUNBURST = { model: "gpt-image-2.5-sunburst", quality: "low", size: "1024x1536" };

test("every slide in js/story.js belongs to exactly one story image", async () => {
  const story = await readFile(new URL("../js/story.js", import.meta.url), "utf8");
  const ids = [...story.matchAll(/^\s+id: "(\w+)"/gm)].map((m) => m[1]);
  const covered = Object.values(ART.story.items).flatMap((art) => art.slides);
  assert.deepEqual(covered.sort(), ids.sort());
});

test("every archetype in js/stats.js has a portrait", async () => {
  const stats = await readFile(new URL("../js/stats.js", import.meta.url), "utf8");
  const ids = [...stats.matchAll(/id: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(Object.keys(ART.archetypes.items).sort(), ids.sort());
});

describe("arguments and targets", () => {
  test("reads targets and flags in any order", () => {
    const opts = parseArgs(["story/time", "--force", "archetypes", "--dry-run"]);
    assert.deepEqual(opts.targets, ["story/time", "archetypes"]);
    assert.equal(opts.force, true);
    assert.equal(opts.dryRun, true);
    assert.equal(opts.webp, false);
  });

  test("rejects unknown options", () => {
    assert.throws(() => parseArgs(["--nope"]), /unknown option --nope/);
  });

  test("a group expands to its images, a path picks one", () => {
    assert.equal(resolveTargets(["story"]).length, 7);
    assert.deepEqual(resolveTargets(["archetypes/nightOwl"]), [{ group: "archetypes", name: "nightOwl" }]);
    assert.equal(resolveTargets([]).length, 18);
  });

  test("unknown groups and images fail before any request", () => {
    assert.throws(() => resolveTargets(["slides"]), /unknown group: slides/);
    assert.throws(() => resolveTargets(["story/nope"]), /unknown image: story\/nope/);
  });
});

describe("credits log and budget", () => {
  test("skips comments and blank lines, sums the credits column", () => {
    const log = "# header\n\n2026-10-13T18:24:45Z\tgpt-image-2.5-sunburst\tlow\t1024x1536\tstory/intro\t50000\tusage\n2026-10-13T18:30:00Z\tm\tlow\t1024x1024\tx\t1200\t\n";
    const entries = parseLog(log);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, "story/intro");
    assert.equal(totalCharged(entries), 51200);
  });

  test("stops once the log is over the stop line", () => {
    assert.throws(() => checkBudget([entry(1_450_001)], SUNBURST), /over the 1450000 stop line/);
    assert.doesNotThrow(() => checkBudget([entry(1_400_000)], SUNBURST));
  });

  test("counts the live balance when it shows more spending than the log", () => {
    assert.throws(() => checkBudget([entry(450_000)], SUNBURST, 1_460_000), /spent 1460000, over the 1450000 stop line/);
    assert.doesNotThrow(() => checkBudget([entry(450_000)], SUNBURST, 650_000));
    assert.doesNotThrow(() => checkBudget([entry(450_000)], SUNBURST, null));
  });

  test("refuses a call whose last known price would break the budget", () => {
    assert.throws(() => checkBudget([entry(1_370_000), entry(70_000, SUNBURST)], SUNBURST), /past the 1500000 budget/);
    assert.doesNotThrow(() => checkBudget([entry(1_370_000), entry(70_000, SUNBURST)], { ...SUNBURST, size: "1024x1024" }));
  });
});

describe("png size", () => {
  test("reads width and height from the IHDR chunk", () => {
    const head = Buffer.alloc(24);
    PNG.copy(head);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "ascii");
    head.writeUInt32BE(1024, 16);
    head.writeUInt32BE(1536, 20);
    assert.deepEqual(pngSize(head), { width: 1024, height: 1536 });
  });

  test("returns null for short or non-png bytes", () => {
    assert.equal(pngSize(PNG), null);
    assert.equal(pngSize(Buffer.from("RIFF0000WEBPVP8 0000000000", "ascii")), null);
  });
});

describe("images api", () => {
  const seen = [];
  let replies = [];
  let balance = null;
  let server;
  let baseUrl;
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/v1/balance") {
        const reply = balance === null ? [404, {}] : [200, { object: "balance", token_balance: balance.shift() }];
        return res.writeHead(reply[0], { "Content-Type": "application/json" }).end(JSON.stringify(reply[1]));
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
        const [status, payload] = replies.shift();
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
      });
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1/`;
  });
  after(() => server.close());

  test("posts the prompt, decodes b64_json and reads usage.charged_tokens", async () => {
    reset([[200, { data: [{ b64_json: PNG.toString("base64") }], usage: { charged_tokens: 50000 } }]]);
    const { bytes, charged } = await generateImage("a lime dot", config({ apiKey: "k" }));
    assert.deepEqual(bytes, PNG);
    assert.equal(charged, 50000);
    assert.equal(seen[0].url, "/v1/images/generations");
    assert.equal(seen[0].auth, "Bearer k");
    assert.deepEqual(seen[0].body, { model: "m", prompt: "a lime dot", n: 1, quality: "low", size: "1024x1536" });
  });

  test("falls back to the balance drop when usage is missing", async () => {
    reset([[200, { data: [{ b64_json: PNG.toString("base64") }] }]], [1_000_000, 960_000]);
    const { charged } = await generateImage("p", config());
    assert.equal(charged, 40_000);
    assert.equal(seen[0].auth, undefined);
  });

  test("reports an unknown charge as null", async () => {
    reset([[200, { data: [{ b64_json: PNG.toString("base64") }] }]]);
    assert.equal((await generateImage("p", config())).charged, null);
  });

  test("retries 5xx and 429, then succeeds", async () => {
    reset([[502, { error: "upstream" }], [429, { error: "slow down" }], [200, { data: [{ b64_json: PNG.toString("base64") }] }]]);
    assert.deepEqual((await generateImage("p", config())).bytes, PNG);
    assert.equal(seen.length, 3);
  });

  test("fails at once on a 4xx without retrying", async () => {
    reset([[400, { error: { message: "Unknown image model" } }]]);
    await assert.rejects(generateImage("p", config()), /HTTP 400: .*Unknown image model/);
    assert.equal(seen.length, 1);
  });

  test("gives up after four transient failures", async () => {
    reset([[500, {}], [502, {}], [503, {}], [504, {}]]);
    await assert.rejects(generateImage("p", config()), /HTTP 504/);
    assert.equal(seen.length, 4);
  });

  function reset(nextReplies, nextBalance = null) {
    seen.length = 0;
    replies = nextReplies;
    balance = nextBalance;
  }

  function config(extra = {}) {
    return { baseUrl, model: "m", quality: "low", size: "1024x1536", retryBaseMs: 1, ...extra };
  }
});

function entry(charged, { model = "x", quality = "low", size = "1024x1024" } = {}) {
  return { time: "", model, quality, size, name: "x", charged, note: "" };
}
