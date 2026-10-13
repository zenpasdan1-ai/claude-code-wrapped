#!/usr/bin/env node
// Generates background illustrations for the Wrapped slides (js/story.js) through an
// OpenAI-compatible Images API. Zero dependencies; a dev tool, not part of the package or the site.
//
//   node tools/slide-art.mjs intro          one slide (try this first)
//   node tools/slide-art.mjs                every slide that has no image yet
//   node tools/slide-art.mjs --force cost   regenerate
//   node tools/slide-art.mjs --dry-run      print the prompts, call nothing
//
// Env: OPENAI_BASE_URL (default https://api.openai.com/v1), OPENAI_API_KEY (optional when a
// proxy injects Authorization), OPENAI_IMAGE_MODEL (default gpt-image-2).

import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULTS = {
  model: "gpt-image-2",
  quality: "low",
  size: "1024x1536",
  format: "png",
  out: join(ROOT, "img", "slides"),
};
// Each image is paid for: retry only transient failures, and not forever.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2000;

// Shared look: the site's graphite night with lime and violet. Text sits on top, so keep it quiet.
const STYLE = [
  "Abstract editorial background illustration for a dark, portrait-format story slide.",
  "Palette: near-black graphite #101014, deep violet glow #9b8cff, sparing lime accents #c8ff5a.",
  "Soft grain, gentle gradients, generous negative space; the middle third stays dark and calm for overlaid text.",
  "No text, no letters, no numbers, no logos, no people, no faces.",
].join(" ");

// One motif per slide id in js/story.js.
export const SLIDE_ART = {
  intro: "A doorway of light opening onto a night sky of faint terminal glyph-like stars, a year unfolding.",
  time: "Melting hourglass made of glowing sand streams, long exposure light trails curving around it.",
  prompts: "Hundreds of small floating speech bubbles drifting upward like lanterns, fading into darkness.",
  right: "A huge glowing rubber stamp hovering mid-air, ink splash rings radiating outward.",
  cost: "Coins dissolving into streams of tiny glowing tokens, flowing like a river of light.",
  models: "Three abstract crystalline orbs of different sizes orbiting each other, refracting violet light.",
  rhythm: "A grid of softly pulsing light tiles like a city at night seen from above, some brighter than others.",
  streak: "An unbroken chain of small flames stretching to the horizon along a dark path.",
  tools: "Floating abstract tools — wrench, magnifier, pen nib — made of wireframe light, orbiting slowly.",
  languages: "Overlapping translucent bracket and brace shapes stacked like glass panes, catching lime highlights.",
  odds: "Curious scattered objects in a dark cabinet of wonders: dice, a broken clock, a tiny robot, a paper plane.",
  projects: "Constellation of glowing folders connected by thin lines, like a star map.",
  final: "Confetti of lime and violet light bursting from a single point, celebratory but elegant.",
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at startup (Node >= 22.21).
  if (proxyFromEnv() && !process.env.NODE_USE_ENV_PROXY) {
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
    });
    process.exit(child.status ?? 1);
  }
  main(process.argv.slice(2)).catch((error) => {
    console.error(`slide-art: ${error.message}`);
    process.exit(1);
  });
}

async function main(argv) {
  const opts = parseArgs(argv);
  const ids = opts.ids.length ? opts.ids : Object.keys(SLIDE_ART);
  const unknown = ids.filter((id) => !SLIDE_ART[id]);
  if (unknown.length) throw new Error(`unknown slide id: ${unknown.join(", ")} (known: ${Object.keys(SLIDE_ART).join(", ")})`);

  const config = {
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL || DEFAULTS.model,
    quality: opts.quality,
    size: opts.size,
    format: opts.format,
  };
  for (const id of ids) {
    const file = join(opts.out, `${id}.${opts.format}`);
    if (!opts.force && (await exists(file))) {
      console.log(`skip  ${id} (exists: ${relative(ROOT, file)})`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`${id}: ${slidePrompt(id)}`);
      continue;
    }
    const started = Date.now();
    const bytes = await generateImage(slidePrompt(id), config);
    await mkdir(opts.out, { recursive: true });
    await writeFile(file, bytes);
    // Some gateways ignore size and output_format, so report what actually came back.
    const dims = pngSize(bytes);
    const shape = dims ? `${dims.width}x${dims.height} png` : "not png";
    console.log(`wrote ${relative(ROOT, file)} (${shape}, ${Math.round(bytes.length / 1024)} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
}

export function slidePrompt(id) {
  return `${STYLE} Motif: ${SLIDE_ART[id]}`;
}

// Returns the image bytes. gpt-image models answer with b64_json; URL answers are fetched.
export async function generateImage(prompt, { baseUrl, apiKey, model, quality, size, format, retryBaseMs = RETRY_BASE_MS }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = { model, prompt, n: 1, quality, size, ...(format === "png" ? {} : { output_format: format }) };
  const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const text = await postWithRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, retryBaseMs);
  const item = JSON.parse(text).data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`image download HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error(`no image in response: ${text.slice(0, 300)}`);
}

// Network errors, 429 and 5xx are retried with backoff; a 4xx (bad model, bad size, auth) fails at once.
async function postWithRetry(url, init, retryBaseMs) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    const res = await fetch(url, init).catch((error) => {
      failure = error;
      return null;
    });
    if (res) {
      const text = await res.text();
      if (res.ok) return text;
      failure = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      if (res.status !== 429 && res.status < 500) throw failure;
    }
    if (attempt >= MAX_ATTEMPTS) throw failure;
    const delay = retryBaseMs * 2 ** (attempt - 1);
    console.warn(`retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay / 1000}s: ${failure.message}`);
    await new Promise((done) => setTimeout(done, delay));
  }
}

export function parseArgs(argv) {
  const opts = { ...DEFAULTS, ids: [], force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (["--quality", "--size", "--format", "--out"].includes(arg)) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = arg === "--out" ? resolve(value) : value;
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.ids.push(arg);
  }
  return opts;
}

// Width and height from the IHDR chunk, or null when the bytes are not a PNG.
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function proxyFromEnv() {
  return process.env.HTTPS_PROXY || process.env.https_proxy;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
