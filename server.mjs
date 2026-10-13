// Zero-dependency static server for Claude Code Wrapped.
// Usage: npm start   (PORT and HOST env vars override the defaults)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Server internals are not part of the site.
const PRIVATE = new Set(["server.mjs", "package.json"]);

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(req, res, 405, "text/plain; charset=utf-8", "405 method not allowed", { Allow: "GET, HEAD" });
    return;
  }
  try {
    const file = await resolveFile(req.url);
    if (!file) {
      send(req, res, 404, "text/plain; charset=utf-8", "404 not found");
      return;
    }
    const body = await readFile(file);
    const ext = extname(file);
    send(req, res, 200, TYPES[ext] ?? "application/octet-stream", body, {
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
  } catch (error) {
    console.error(error);
    send(req, res, 500, "text/plain; charset=utf-8", "500 internal error");
  }
});

async function resolveFile(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;

  let file = resolve(ROOT, "." + pathname);
  const rel = relative(ROOT, file);
  // Reject anything outside ROOT, dotfiles and dot-directories, and server files.
  if (rel.startsWith("..") || rel.split(sep).some((part) => part.startsWith("."))) return null;
  if (PRIVATE.has(rel)) return null;

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  return info?.isFile() ? file : null;
}

function send(req, res, status, type, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(req.method === "HEAD" ? undefined : body);
  console.log(`${status} ${req.method} ${req.url}`);
}

server.listen(PORT, HOST, () => {
  console.log(`wrapped: http://${HOST}:${PORT}/`);
});
