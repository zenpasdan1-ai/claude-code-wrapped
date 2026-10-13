import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSiteServer } from "../lib/site-server.mjs";
import { candidateDirs, listTranscripts } from "../lib/transcripts.mjs";

const TOKEN = "a".repeat(32);
const CLI = fileURLToPath(new URL("../bin/ccwrapped.mjs", import.meta.url));
const LINE = '{"type":"user","timestamp":"2026-09-01T10:00:00Z","message":{"content":"hi"}}\n';

describe("finding transcripts", () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccwrapped-"));
    await mkdir(join(dir, "-Users-me-app", "sess", "subagents"), { recursive: true });
    await writeFile(join(dir, "-Users-me-app", "one.jsonl"), LINE);
    await writeFile(join(dir, "-Users-me-app", "sess", "subagents", "two.jsonl"), LINE);
    await writeFile(join(dir, "-Users-me-app", "notes.txt"), "not a transcript");
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test("CLAUDE_CONFIG_DIR comes first, then the home folders", () => {
    const dirs = candidateDirs({ CLAUDE_CONFIG_DIR: "/cfg/a, /cfg/b" }, "/home/me");
    assert.deepEqual(dirs, [
      resolve("/cfg/a/projects"),
      resolve("/cfg/b/projects"),
      resolve("/home/me/.claude/projects"),
      resolve("/home/me/.config/claude/projects"),
    ]);
  });

  test("lists .jsonl files recursively with project-relative paths", async () => {
    const files = await listTranscripts([dir, join(dir, "missing")]);
    assert.deepEqual(files.map((f) => f.path).sort(), ["-Users-me-app/one.jsonl", "-Users-me-app/sess/subagents/two.jsonl"]);
    assert.deepEqual(files.map((f) => f.id).sort(), [0, 1]);
  });
});

describe("terminal report", () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccwrapped-"));
    await mkdir(join(dir, "-Users-me-app"));
    await writeFile(join(dir, "-Users-me-app", "one.jsonl"), LINE);
  });
  after(() => rm(dir, { recursive: true, force: true }));

  test("prints the checkup without starting a server", async () => {
    const { code, stdout } = await cli([dir, "--report"]);
    assert.equal(code, 0);
    assert.match(stdout, /^Claude Code Checkup/);
  });

  test("prints it in Russian when asked", async () => {
    const { code, stdout } = await cli([dir, "--report", "--lang", "ru"]);
    assert.equal(code, 0);
    assert.match(stdout, /^Claude Code Чекап/);
  });

  test("rejects a bad --days value", async () => {
    const { code, stderr } = await cli([dir, "--report", "--days", "0"]);
    assert.equal(code, 2);
    assert.match(stderr, /--days/);
  });
});

describe("local server", () => {
  let dir;
  let server;
  let port;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccwrapped-"));
    await writeFile(join(dir, "one.jsonl"), LINE);
    const files = [{ id: 0, name: "one.jsonl", path: "-Users-me-app/one.jsonl", abs: join(dir, "one.jsonl") }];
    server = createSiteServer({ local: { token: TOKEN, files } });
    await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
    port = server.address().port;
  });
  after(async () => {
    await new Promise((ok) => server.close(ok));
    await rm(dir, { recursive: true, force: true });
  });

  test("serves the site but not its internals", async () => {
    assert.equal((await get(port, "/")).status, 200);
    assert.equal((await get(port, "/js/main.js")).status, 200);
    for (const path of ["/package.json", "/server.mjs", "/bin/ccwrapped.mjs", "/lib/site-server.mjs", "/test/cli.test.mjs", "/.git/config", "/../package.json"]) {
      assert.equal((await get(port, path)).status, 404, path);
    }
  });

  test("hands out transcripts only with the token", async () => {
    assert.equal((await get(port, "/__local/manifest.json")).status, 403);
    assert.equal((await get(port, "/__local/manifest.json?token=nope")).status, 403);
    const manifest = await get(port, `/__local/manifest.json?token=${TOKEN}`);
    assert.equal(manifest.status, 200);
    assert.deepEqual(JSON.parse(manifest.body), { files: [{ id: 0, name: "one.jsonl", path: "-Users-me-app/one.jsonl" }] });
    const file = await get(port, `/__local/file/0?token=${TOKEN}`);
    assert.equal(file.body, LINE);
    assert.equal((await get(port, `/__local/file/7?token=${TOKEN}`)).status, 404);
  });

  test("refuses other host names, so a rebinding page can't read them", async () => {
    const res = await get(port, `/__local/manifest.json?token=${TOKEN}`, "evil.example:80");
    assert.equal(res.status, 403);
  });

  test("only reads, never writes", async () => {
    assert.equal((await get(port, "/", undefined, "POST")).status, 405);
  });
});

function get(port, path, host, method = "GET") {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: host ? { host } : {} }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

function cli(args) {
  return new Promise((ok) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
      ok({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}
