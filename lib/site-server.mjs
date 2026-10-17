// Zero-dependency static server for the site, plus the token-guarded local
// transcript routes the CLI uses. Nothing here talks to the network beyond the socket it listens on.

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SITE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Server internals and tooling are not part of the site.
const PRIVATE_FILES = new Set(["server.mjs", "package.json", "package-lock.json"]);
const PRIVATE_DIRS = new Set(["bin", "lib", "test", "tools", "node_modules"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// local: { token, files: [{ id, name, path, abs }] } turns on the transcript routes.
export function createSiteServer({ root = SITE_ROOT, local = null, log = () => {} } = {}) {
  return createServer(async (req, res) => {
    const done = (status) => log(`${status} ${req.method} ${req.url.split("?")[0]}`);
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(req, res, 405, "text/plain; charset=utf-8", "405 method not allowed", { Allow: "GET, HEAD" });
      return done(405);
    }
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      send(req, res, 400, "text/plain; charset=utf-8", "400 bad request");
      return done(400);
    }
    try {
      if (local && url.pathname.startsWith("/__local/")) return done(await serveLocal(req, res, url, local));
      const file = await resolveFile(root, url.pathname);
      if (!file) {
        send(req, res, 404, "text/plain; charset=utf-8", "404 not found");
        return done(404);
      }
      const body = await readFile(file);
      const ext = extname(file);
      send(req, res, 200, TYPES[ext] ?? "application/octet-stream", body, {
        "Cache-Control": "no-cache",
      });
      done(200);
    } catch (error) {
      log(String(error?.stack || error));
      if (!res.headersSent) send(req, res, 500, "text/plain; charset=utf-8", "500 internal error");
      else res.destroy();
      done(500);
    }
  });
}

async function serveLocal(req, res, url, local) {
  // Only this machine, only with the token: blocks other sites and DNS rebinding.
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host) || !sameToken(url.searchParams.get("token"), local.token)) {
    send(req, res, 403, "text/plain; charset=utf-8", "403 forbidden");
    return 403;
  }
  const noStore = { "Cache-Control": "no-store" };
  if (url.pathname === "/__local/manifest.json") {
    const files = local.files.map(({ id, name, path }) => ({ id, name, path }));
    send(req, res, 200, "application/json; charset=utf-8", JSON.stringify({ files }), noStore);
    return 200;
  }
  const match = url.pathname.match(/^\/__local\/file\/(\d+)$/);
  const entry = match && local.files[Number(match[1])];
  if (!entry) {
    send(req, res, 404, "text/plain; charset=utf-8", "404 not found");
    return 404;
  }
  const info = await stat(entry.abs);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Content-Length": info.size,
    "X-Content-Type-Options": "nosniff",
    ...noStore,
  });
  if (req.method === "HEAD") {
    res.end();
    return 200;
  }
  await new Promise((ok, fail) => createReadStream(entry.abs).on("error", fail).pipe(res).on("finish", ok));
  return 200;
}

export async function resolveFile(root, rawPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;

  let file = resolve(root, "." + pathname);
  const rel = relative(root, file);
  // Reject anything outside root, dotfiles and dot-directories, and server internals.
  const parts = rel.split(sep);
  if (rel.startsWith("..") || parts.some((part) => part.startsWith("."))) return null;
  if (PRIVATE_FILES.has(rel) || PRIVATE_DIRS.has(parts[0])) return null;

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  return info?.isFile() ? file : null;
}

function sameToken(given, expected) {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function send(req, res, status, type, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : body);
}
