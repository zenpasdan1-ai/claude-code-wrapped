#!/usr/bin/env node
// Generates the site's illustrations through an OpenAI-compatible Images API and makes the
// webp copies the site serves. Zero npm dependencies; webp needs ImageMagick (`convert`).
// A dev tool: not part of the package or the deployed site.
//
//   node tools/art.mjs story/time            one image
//   node tools/art.mjs story                 every story image that does not exist yet
//   node tools/art.mjs --dry-run archetypes  print the prompts, call nothing
//   node tools/art.mjs --force story/talk    redraw (only when asked to)
//   node tools/art.mjs --webp                rebuild every webp from the PNG sources, no API calls
//
// Every paid call is appended to img/story/credits.log. Spending is the larger of the log total
// and START_BALANCE minus the gateway's live balance; nothing is requested once it is over
// STOP_AT, or when the next call could push it past BUDGET.
//
// Env: OPENAI_BASE_URL (default https://api.openai.com/v1), OPENAI_API_KEY (optional when a
// proxy injects Authorization), OPENAI_IMAGE_MODEL (default gpt-image-2.5-sunburst), HTTPS_PROXY.

import { spawnSync } from "node:child_process";
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODEL = "gpt-image-2.5-sunburst";
const CREDITS_LOG = join(ROOT, "img", "story", "credits.log");
const BUDGET = 1_500_000;
const STOP_AT = 1_450_000;
// Gateway balance before any of this work started, as stated by the owner.
const START_BALANCE = 5_000_000;
// Each image is paid for: retry only transient failures, and not forever.
// The gateway answers 502 now and then without charging; give it time to recover.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 10_000;
const BALANCE_GAP_MS = 1100;
const WEBP_QUALITY = 70;
const WEBP_MIN_QUALITY = 40;

const STORY_STYLE = [
  "Dark minimal editorial illustration, vertical composition. Deep graphite background (#101014),",
  "accents of acid lime (#c8ff5a) and soft violet glow (#9b8cff). Subtle film grain, risograph texture.",
  "The upper two thirds stay dark and nearly empty (text goes there); the subject sits in the lower third.",
  "No text, no letters, no numbers, no logos, no brand marks, no human faces.",
].join(" ");

const PORTRAIT_STYLE = [
  "Dark minimal editorial illustration, square composition. Deep graphite background (#101014),",
  "accents of acid lime (#c8ff5a) and soft violet glow (#9b8cff). Subtle film grain, risograph texture.",
  "The subject sits in the center, surrounded by dark empty space.",
  "No text, no letters, no numbers, no logos, no brand marks, no human faces.",
].join(" ");

const LANDING_STYLE = [
  "Dark minimal editorial illustration, wide horizontal composition. Deep graphite background (#101014),",
  "accents of acid lime (#c8ff5a) and soft violet glow (#9b8cff). Subtle film grain, risograph texture.",
  "No text, no letters, no numbers, no logos, no brand marks, no human faces.",
].join(" ");

// Groups of images. `src` holds the PNG sources, `web` the webp copies the site loads.
export const ART = {
  story: {
    src: "img/story/src",
    web: "img/story",
    size: "1024x1536",
    quality: "low",
    style: STORY_STYLE,
    webSize: "720x1080",
    items: {
      intro: { slides: ["intro"], subject: "A glowing terminal cursor on a distant horizon at night, like a sunrise made of light" },
      time: { slides: ["time", "streak"], subject: "An hourglass whose sand is tiny glowing squares, a row of calendar tiles lighting up one by one" },
      talk: { slides: ["prompts", "right"], subject: "Floating speech bubbles in the dark, one stamped with a tilted rubber-stamp mark" },
      tokens: { slides: ["cost", "models"], subject: "A stream of small glowing coins and tokens flowing between two abstract machines" },
      hands: { slides: ["rhythm", "tools"], subject: "Abstract mechanical hands holding small tools above a glowing equalizer of bars" },
      code: { slides: ["languages", "odds", "projects"], subject: "A constellation made of code brackets and folder shapes, connected by thin lines" },
      final: { slides: ["final"], subject: "An empty spotlight on a small stage, confetti of lime and violet squares" },
    },
  },
  archetypes: {
    src: "img/archetypes",
    web: "img/archetypes",
    size: "1024x1024",
    quality: "low",
    style: PORTRAIT_STYLE,
    webSize: "512x512",
    items: {
      nightOwl: { subject: "An owl made of glowing code brackets on a dark windowsill, crescent moon" },
      earlyBird: { subject: "A small bird on a coffee cup at dawn, steam shaped like a cursor" },
      opusMaximalist: { subject: "A towering stack of glowing books becoming a skyscraper" },
      fableFlyer: { subject: "A paper plane made of a glowing page, leaving a lime trail" },
      marathoner: { subject: "A runner silhouette made of light crossing a finish line of code lines" },
      politeCoder: { subject: "A tiny robot bowing politely, holding a small flower" },
      toolWhisperer: { subject: "Floating tools (wrench, magnifier, terminal) orbiting an open hand" },
      weekendWarrior: { subject: "A laptop on a picnic blanket under stars, a small flag" },
      streakMachine: { subject: "A chain of glowing calendar squares forming a rising flame" },
      steadyShipper: { subject: "A small cargo ship sailing calmly on a sea of glowing grid lines" },
    },
  },
  landing: {
    src: "img",
    web: "img",
    size: "1536x1024",
    quality: "low",
    style: LANDING_STYLE,
    webSize: "1200x800",
    items: {
      "landing-hero": { subject: "A calm dashboard of glowing receipts and a share card floating above it" },
    },
  },
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at startup (Node >= 22.21).
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      stdio: "inherit",
      env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
    });
    process.exit(child.status ?? 1);
  }
  main(process.argv.slice(2)).catch((error) => {
    console.error(`art: ${error.message}`);
    process.exit(1);
  });
}

async function main(argv) {
  const opts = parseArgs(argv);
  const targets = resolveTargets(opts.targets);
  if (opts.webp) {
    for (const { group, name } of targets) {
      if (await exists(srcPath(group, name))) console.log(await toWebp(group, name));
    }
    return;
  }

  const config = {
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_IMAGE_MODEL || MODEL,
  };
  for (const { group, name } of targets) {
    const art = ART[group];
    const file = srcPath(group, name);
    if (!opts.force && (await exists(file))) {
      console.log(`skip  ${group}/${name} (exists: ${relative(ROOT, file)})`);
      continue;
    }
    if (opts.dryRun) {
      console.log(`${group}/${name}: ${artPrompt(group, name)}`);
      continue;
    }
    const entries = parseLog(await readText(CREDITS_LOG));
    const balance = await readBalance(apiOf(config.baseUrl), authHeaders(config.apiKey));
    checkBudget(entries, { model: config.model, quality: art.quality, size: art.size }, balance === null ? null : START_BALANCE - balance);
    await new Promise((done) => setTimeout(done, BALANCE_GAP_MS));

    const started = Date.now();
    const { bytes, charged } = await generateImage(artPrompt(group, name), { ...config, quality: art.quality, size: art.size });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    const line = logLine({ model: config.model, quality: art.quality, size: art.size, name: `${group}/${name}`, charged });
    await mkdir(dirname(CREDITS_LOG), { recursive: true });
    await appendFile(CREDITS_LOG, line);
    const total = totalCharged([...entries, ...parseLog(line)]);
    const dims = pngSize(bytes);
    const shape = dims ? `${dims.width}x${dims.height}` : "not png";
    console.log(`wrote ${relative(ROOT, file)} (${shape}, ${Math.round(bytes.length / 1024)} KB, ${((Date.now() - started) / 1000).toFixed(1)}s, ${charged} credits, log total ${total})`);
    console.log(await toWebp(group, name));
  }
}

export function artPrompt(group, name) {
  return `${ART[group].items[name].subject}. ${ART[group].style}`;
}

// "story" means the whole group, "story/time" one image; nothing means every image.
export function resolveTargets(targets) {
  const all = (group) => Object.keys(ART[group].items).map((name) => ({ group, name }));
  if (!targets.length) return Object.keys(ART).flatMap(all);
  return targets.flatMap((target) => {
    const [group, name] = target.split("/");
    if (!ART[group]) throw new Error(`unknown group: ${group} (known: ${Object.keys(ART).join(", ")})`);
    if (!name) return all(group);
    if (!ART[group].items[name]) throw new Error(`unknown image: ${target} (known: ${Object.keys(ART[group].items).join(", ")})`);
    return [{ group, name }];
  });
}

// Throws before a request we cannot afford. spentByBalance (from the live balance) wins when it
// is higher than the log, so calls the log missed still count.
export function checkBudget(entries, { model, quality, size }, spentByBalance = null) {
  const total = Math.max(totalCharged(entries), spentByBalance ?? 0);
  if (total > STOP_AT) throw new Error(`spent ${total}, over the ${STOP_AT} stop line; nothing requested`);
  const same = entries.filter((e) => e.model === model && e.quality === quality && e.size === size);
  const expected = same.length ? same[same.length - 1].charged : 0;
  if (total + expected > BUDGET) throw new Error(`next call (~${expected}) would take spending from ${total} past the ${BUDGET} budget`);
}

// Returns the PNG bytes and the credits the gateway charged (usage.charged_tokens, else the balance drop).
export async function generateImage(prompt, { baseUrl, apiKey, model, quality, size, retryBaseMs = RETRY_BASE_MS }) {
  const api = apiOf(baseUrl);
  const headers = authHeaders(apiKey);
  const before = await readBalance(api, headers);
  const body = JSON.stringify({ model, prompt, n: 1, quality, size });
  const text = await postWithRetry(`${api}/images/generations`, { headers, body }, retryBaseMs);
  const json = JSON.parse(text);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no b64_json in response: ${text.slice(0, 300)}`);
  let charged = json.usage?.charged_tokens;
  if (charged === undefined && before !== null) {
    const after = await readBalance(api, headers);
    charged = after === null ? null : before - after;
  }
  return { bytes: Buffer.from(b64, "base64"), charged: charged ?? null };
}

// Network errors, 429 and 5xx are retried with backoff; a 4xx (bad model, bad size, auth) fails at once.
async function postWithRetry(url, { headers, body }, retryBaseMs) {
  for (let attempt = 1; ; attempt++) {
    let failure;
    try {
      const res = await fetch(url, { method: "POST", headers, body });
      const text = await res.text();
      if (res.ok) return text;
      failure = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      failure.permanent = res.status !== 429 && res.status < 500;
    } catch (error) {
      failure = error;
    }
    if (failure.permanent || attempt >= MAX_ATTEMPTS) throw failure;
    const delay = retryBaseMs * 2 ** (attempt - 1);
    console.warn(`retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay / 1000}s: ${failure.message}`);
    await new Promise((done) => setTimeout(done, delay));
  }
}

function apiOf(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function authHeaders(apiKey) {
  const headers = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "ccwrapped-art" };
  return apiKey ? { ...headers, Authorization: `Bearer ${apiKey}` } : headers;
}

// GET /balance is free on gateways that have it (at most once a second); null when there is none.
async function readBalance(api, headers) {
  try {
    const res = await fetch(`${api}/balance`, { headers });
    const value = res.ok ? (await res.json()).token_balance : undefined;
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

// Log lines: ISO time, model, quality, size, image, credits, note. '#' starts a comment.
export function parseLog(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [time, model, quality, size, name, charged, note = ""] = line.split("\t");
      return { time, model, quality, size, name, charged: Number(charged) || 0, note };
    });
}

export function totalCharged(entries) {
  return entries.reduce((sum, e) => sum + e.charged, 0);
}

function logLine({ model, quality, size, name, charged }) {
  const note = charged === null ? "charge unknown" : "";
  return `${new Date().toISOString()}\t${model}\t${quality}\t${size}\t${name}\t${charged ?? 0}\t${note}\n`;
}

// Resizes and steps the quality down until the file fits the group's byte budget.
async function toWebp(group, name) {
  const art = ART[group];
  const src = srcPath(group, name);
  const out = join(ROOT, art.web, `${name}.webp`);
  const maxBytes = (group === "landing" ? 250 : 150) * 1024;
  let quality = WEBP_QUALITY;
  for (;;) {
    const run = spawnSync("convert", [src, "-resize", `${art.webSize}^`, "-gravity", "center", "-extent", art.webSize, "-quality", String(quality), "-define", "webp:method=6", out]);
    if (run.error || run.status !== 0) throw new Error(`convert failed for ${relative(ROOT, src)}: ${run.error?.message || run.stderr}`);
    const { size } = await stat(out);
    if (size <= maxBytes || quality <= WEBP_MIN_QUALITY) return `webp  ${relative(ROOT, out)} (${art.webSize}, q${quality}, ${Math.round(size / 1024)} KB)`;
    quality -= 10;
  }
}

// Width and height from the IHDR chunk, or null when the bytes are not a PNG.
export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function parseArgs(argv) {
  const opts = { targets: [], force: false, dryRun: false, webp: false };
  for (const arg of argv) {
    if (arg === "--force") opts.force = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--webp") opts.webp = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else opts.targets.push(arg);
  }
  return opts;
}

function srcPath(group, name) {
  return join(ROOT, ART[group].src, `${name}.png`);
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
