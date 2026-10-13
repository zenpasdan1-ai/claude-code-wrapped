import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { SLIDE_ART, generateImage, parseArgs, pngSize } from "../tools/slide-art.mjs";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

test("every slide in js/story.js has a motif, and nothing else does", async () => {
  const story = await readFile(new URL("../js/story.js", import.meta.url), "utf8");
  const ids = [...story.matchAll(/^\s+id: "(\w+)"/gm)].map((m) => m[1]);
  assert.deepEqual(Object.keys(SLIDE_ART).sort(), ids.sort());
});

describe("arguments", () => {
  test("defaults to low quality, portrait png", () => {
    const opts = parseArgs([]);
    assert.equal(opts.quality, "low");
    assert.equal(opts.size, "1024x1536");
    assert.equal(opts.format, "png");
    assert.deepEqual(opts.ids, []);
  });

  test("reads slide ids and flags in any order", () => {
    const opts = parseArgs(["intro", "--force", "--quality", "medium", "cost", "--out", "x"]);
    assert.deepEqual(opts.ids, ["intro", "cost"]);
    assert.equal(opts.force, true);
    assert.equal(opts.quality, "medium");
    assert.equal(opts.out, resolve("x"));
  });

  test("rejects unknown options and missing values", () => {
    assert.throws(() => parseArgs(["--nope"]), /unknown option --nope/);
    assert.throws(() => parseArgs(["--size"]), /--size needs a value/);
  });
});

describe("png size", () => {
  test("reads width and height from the IHDR chunk", () => {
    const head = Buffer.alloc(24);
    PNG.copy(head);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "ascii");
    head.writeUInt32BE(1254, 16);
    head.writeUInt32BE(1880, 20);
    assert.deepEqual(pngSize(head), { width: 1254, height: 1880 });
  });

  test("returns null for short or non-png bytes", () => {
    assert.equal(pngSize(PNG), null);
    assert.equal(pngSize(Buffer.from("RIFF0000WEBPVP8 0000000000", "ascii")), null);
  });
});

describe("images api", () => {
  const seen = [];
  let replies = [];
  let server;
  let baseUrl;
  before(async () => {
    server = createServer((req, res) => {
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

  test("posts the prompt and decodes b64_json", async () => {
    seen.length = 0;
    replies = [[200, { data: [{ b64_json: PNG.toString("base64") }] }]];
    const bytes = await generateImage("a lime dot", config({ apiKey: "k" }));
    assert.deepEqual(bytes, PNG);
    assert.equal(seen[0].url, "/v1/images/generations");
    assert.equal(seen[0].auth, "Bearer k");
    assert.deepEqual(seen[0].body, { model: "m", prompt: "a lime dot", n: 1, quality: "low", size: "1024x1536", output_format: "webp" });
  });

  test("sends no Authorization when the proxy injects it, and no output_format for png", async () => {
    seen.length = 0;
    replies = [[200, { data: [{ b64_json: PNG.toString("base64") }] }]];
    await generateImage("p", config({ format: "png" }));
    assert.equal(seen[0].auth, undefined);
    assert.equal("output_format" in seen[0].body, false);
  });

  test("retries 5xx and 429, then succeeds", async () => {
    seen.length = 0;
    replies = [[502, { error: "upstream" }], [429, { error: "slow down" }], [200, { data: [{ b64_json: PNG.toString("base64") }] }]];
    assert.deepEqual(await generateImage("p", config()), PNG);
    assert.equal(seen.length, 3);
  });

  test("fails at once on a 4xx without retrying", async () => {
    seen.length = 0;
    replies = [[400, { error: { message: "Unknown image model" } }]];
    await assert.rejects(generateImage("p", config()), /HTTP 400: .*Unknown image model/);
    assert.equal(seen.length, 1);
  });

  test("gives up after three transient failures", async () => {
    seen.length = 0;
    replies = [[500, {}], [502, {}], [503, {}]];
    await assert.rejects(generateImage("p", config()), /HTTP 503/);
    assert.equal(seen.length, 3);
  });

  function config(extra = {}) {
    return { baseUrl, model: "m", quality: "low", size: "1024x1536", format: "webp", retryBaseMs: 1, ...extra };
  }
});
