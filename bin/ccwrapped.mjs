#!/usr/bin/env node
// Opens Claude Code Wrapped with this machine's transcripts, no folder picking needed.
// Transcripts are streamed to the page from 127.0.0.1 only; nothing is uploaded anywhere.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createSiteServer } from "../lib/site-server.mjs";
import { candidateDirs, listTranscripts } from "../lib/transcripts.mjs";

const DEFAULT_PORT = 4417;
const HELP = `Usage: ccwrapped [folder] [--port <n>] [--no-open]

Shows your Claude Code Wrapped in the browser, built from the transcripts in
~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects, or the folder you pass).
Everything stays on this computer. Press Ctrl+C to stop.`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const dirs = args.folder ? [resolve(args.folder)] : candidateDirs();
const files = await listTranscripts(dirs);
if (!files.length) {
  console.error(`No Claude Code transcripts found in:\n  ${dirs.join("\n  ")}\nPass the folder explicitly: ccwrapped /path/to/projects`);
  process.exit(1);
}

const token = randomBytes(16).toString("hex");
const server = createSiteServer({ local: { token, files } });
const port = await listen(server, args.port ?? DEFAULT_PORT, args.port === undefined);
const url = `http://127.0.0.1:${port}/#local=${token}`;

console.log(`Found ${files.length} transcript files.`);
console.log(`Your Claude Code Wrapped: ${url}`);
console.log("Runs only on this computer. Press Ctrl+C to stop.");
if (!args.noOpen) openBrowser(url);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--no-open") out.noOpen = true;
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) out.port = Number(a.slice(7));
    else if (!a.startsWith("-")) out.folder = a;
    else {
      console.error(`Unknown option: ${a}\n\n${HELP}`);
      process.exit(2);
    }
  }
  if (out.port !== undefined && !(Number.isInteger(out.port) && out.port >= 0 && out.port < 65536)) {
    console.error("--port needs a number between 0 and 65535");
    process.exit(2);
  }
  return out;
}

// The default port is a nicety; if it's taken, any free port will do.
function listen(srv, port, fallback) {
  return new Promise((ok, fail) => {
    srv.once("error", (error) => {
      if (fallback && error.code === "EADDRINUSE") listen(srv, 0, false).then(ok, fail);
      else fail(error);
    });
    srv.listen(port, "127.0.0.1", () => ok(srv.address().port));
  });
}

function openBrowser(target) {
  const [cmd, cmdArgs] =
    process.platform === "darwin" ? ["open", [target]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", target]]
    : ["xdg-open", [target]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // No browser launcher: the printed link is enough.
  }
}
