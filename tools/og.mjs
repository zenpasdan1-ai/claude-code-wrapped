#!/usr/bin/env node
// Builds og.png (1200x630) from img/landing-hero.png: a crop of the illustration with the title
// set in the site's own fonts. The image model draws no text; the words come from here.
// Needs Playwright with Chromium (`npm i -g playwright`); a dev tool, not part of the package.
//
//   node tools/og.mjs

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SOURCE = join(ROOT, "img", "landing-hero.png");
const OUT = join(ROOT, "og.png");
const WIDTH = 1200;
const HEIGHT = 630;
const TITLE = "Claude Code Wrapped";
const TAGLINE = "Where your agent burns money, and how to stop it.";
const NOTE = "Unofficial fan project. Not affiliated with Anthropic.";

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`og: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  const { chromium } = await import("playwright").catch(() => {
    throw new Error("Playwright is not installed: npm i -g playwright");
  });
  const hero = (await readFile(SOURCE)).toString("base64");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await page.setContent(ogHtml(`data:image/png;base64,${hero}`), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await writeFile(OUT, await page.screenshot({ type: "png" }));
    console.log(`wrote og.png (${WIDTH}x${HEIGHT})`);
  } finally {
    await browser.close();
  }
}

// The 1536x1024 illustration is scaled to 1200 wide and cropped to the middle 630 rows;
// a left-hand fade keeps the title on plain graphite.
export function ogHtml(heroUrl) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=JetBrains+Mono:wght@400;600&display=block">
<style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #101014; }
  .art { position: absolute; inset: 0; background: url("${heroUrl}") center / ${WIDTH}px auto no-repeat; }
  .fade { position: absolute; inset: 0; background: linear-gradient(90deg, #101014 0%, rgba(16, 16, 20, 0.92) 38%, rgba(16, 16, 20, 0.2) 70%, rgba(16, 16, 20, 0) 100%); }
  .copy { position: absolute; left: 88px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
  h1 { margin: 0; color: #f5f2ea; font: 800 92px/0.92 "Bricolage Grotesque", sans-serif; letter-spacing: -0.03em; }
  .tagline { margin: 28px 0 0; color: #b9b6c4; font: 400 26px/1.4 "JetBrains Mono", monospace; }
  .note { position: absolute; left: 88px; bottom: 44px; margin: 0; color: #8d8a99; font: 400 16px/1 "JetBrains Mono", monospace; }
</style></head>
<body>
  <div class="art"></div><div class="fade"></div>
  <div class="copy">
    <h1>${TITLE}</h1>
    <p class="tagline">${TAGLINE}</p>
  </div>
  <p class="note">${NOTE}</p>
</body></html>`;
}
