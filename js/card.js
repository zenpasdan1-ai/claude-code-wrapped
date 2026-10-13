import { compact, date, money, num, t } from "./i18n.js";

const POST = { w: 1200, h: 675 };
const STORY = { w: 1080, h: 1920 };
const C = {
  bg: "#101014",
  panel: "#18181f",
  ink: "#f5f2ea",
  muted: "#8d8a99",
  lime: "#c8ff5a",
  violet: "#9b8cff",
  line: "#2a2933",
};
const DISPLAY = '"Bricolage Grotesque", "Arial Black", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// format "post" is a landscape card for an X/Twitter image; "story" is 9:16 for stories.
// portrait is an already loaded archetype image; without it the card is drawn text-only.
export function renderCard(stats, format = "post", portrait = null) {
  const size = format === "story" ? STORY : POST;
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, size.w, size.h);
  if (format === "story") drawStory(ctx, stats, portrait);
  else drawPost(ctx, stats, portrait);
  return canvas;
}

function drawPost(ctx, stats, portrait) {
  const W = POST.w;
  if (portrait) drawPostPortrait(ctx, portrait);
  ctx.fillStyle = C.lime;
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText("CLAUDE CODE WRAPPED", 64, 82);
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${MONO}`;
  ctx.fillText(`${date(stats.from)} – ${date(stats.to)}`, 64, 114);
  ctx.font = `400 16px ${MONO}`;
  ctx.textAlign = "right";
  ctx.fillText(t("unofficial"), W - 64, 82);
  ctx.textAlign = "left";

  const [name, line] = t("archetypes")[stats.archetype];
  ctx.fillStyle = C.muted;
  ctx.font = `500 24px ${MONO}`;
  ctx.fillText(t("youAre"), 64, 188);
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${fitFont(ctx, name, 1072, 92)}px ${DISPLAY}`;
  ctx.fillText(name, 60, 272);
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${MONO}`;
  wrap(ctx, line, 64, 316, 700, 30);

  tiles(stats).forEach(([value, label], i) => {
    const x = 64 + i * 200;
    ctx.fillStyle = C.ink;
    ctx.font = `800 ${fitFont(ctx, value, 180, 52)}px ${DISPLAY}`;
    ctx.fillText(value, x, 468);
    ctx.fillStyle = C.muted;
    ctx.font = `400 18px ${MONO}`;
    ctx.fillText(label, x, 498);
  });

  drawStamp(ctx, stats, 1010, 430, 1);
  drawHeat(ctx, stats.heat, 64, 548, 1072, 56);

  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(footnote(stats), 64, 640);
  ctx.textAlign = "right";
  ctx.fillText("#ClaudeCodeWrapped", W - 64, 640);
  ctx.textAlign = "left";
}

function drawStory(ctx, stats, portrait) {
  const W = STORY.w;
  const x = 96;
  const inner = W - 2 * x;
  ctx.fillStyle = C.lime;
  ctx.font = `600 34px ${MONO}`;
  ctx.fillText("CLAUDE CODE WRAPPED", x, 190);
  ctx.fillStyle = C.muted;
  ctx.font = `400 30px ${MONO}`;
  ctx.fillText(`${date(stats.from)} – ${date(stats.to)}`, x, 240);

  const [name, line] = t("archetypes")[stats.archetype];
  ctx.fillStyle = C.muted;
  ctx.font = `500 36px ${MONO}`;
  ctx.fillText(t("youAre"), x, 400);
  ctx.fillStyle = C.ink;
  const nameSize = 120;
  ctx.font = `800 ${nameSize}px ${DISPLAY}`;
  const nameBottom = wrap(ctx, name, x - 4, 510, inner, nameSize * 0.95);
  ctx.fillStyle = C.muted;
  ctx.font = `400 32px ${MONO}`;
  const lineBottom = wrap(ctx, line, x, nameBottom + 80, inner, 44);

  // With a portrait: portrait on the left above the tiles, stamp beside it. Without: stamp centered.
  if (portrait) {
    const top = Math.max(lineBottom + 48, 760);
    const size = Math.max(300, 1110 - top);
    drawFramedPortrait(ctx, portrait, x, top, size);
    drawStamp(ctx, stats, x + size + (inner - size) / 2, top + size / 2, 1.3);
  } else {
    drawStamp(ctx, stats, W / 2, 960, 1.6);
  }

  tiles(stats).forEach(([value, label], i) => {
    const tx = x + (i % 2) * (inner / 2);
    const ty = 1250 + Math.floor(i / 2) * 190;
    ctx.fillStyle = C.ink;
    ctx.font = `800 ${fitFont(ctx, value, inner / 2 - 24, 96)}px ${DISPLAY}`;
    ctx.fillText(value, tx, ty);
    ctx.fillStyle = C.muted;
    ctx.font = `400 30px ${MONO}`;
    ctx.fillText(label, tx, ty + 48);
  });

  drawHeat(ctx, stats.heat, x, 1580, inner, 150);

  ctx.fillStyle = C.muted;
  ctx.font = `400 26px ${MONO}`;
  ctx.fillText(footnote(stats), x, 1780);
  ctx.fillText("#ClaudeCodeWrapped", x, 1824);
  ctx.fillText(t("unofficial"), x, 1864);
}

// Right side of the landscape card. The image itself fades out toward the text and the heat
// strip, so the background glow shows through instead of a painted-over seam.
function drawPostPortrait(ctx, img) {
  const size = 560;
  const layer = document.createElement("canvas");
  layer.width = size;
  layer.height = size;
  const l = layer.getContext("2d");
  l.drawImage(img, 0, 0, size, size);
  l.globalCompositeOperation = "destination-in";
  const toText = l.createLinearGradient(0, 0, 300, 0);
  toText.addColorStop(0, "rgba(0, 0, 0, 0)");
  toText.addColorStop(1, "#000");
  l.fillStyle = toText;
  l.fillRect(0, 0, size, size);
  const toHeat = l.createLinearGradient(0, size - 200, 0, size);
  toHeat.addColorStop(0, "#000");
  toHeat.addColorStop(1, "rgba(0, 0, 0, 0)");
  l.fillStyle = toHeat;
  l.fillRect(0, 0, size, size);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(layer, POST.w - size, 0);
  ctx.restore();
}

function drawFramedPortrait(ctx, img, x, y, size) {
  ctx.save();
  roundRect(ctx, x, y, size, size, 32);
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, 32);
  ctx.stroke();
}

function drawBackground(ctx, w, h) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  const r = Math.max(w, h) * 0.55;
  const glow = ctx.createRadialGradient(w * 0.85, -60, 20, w * 0.85, -60, r);
  glow.addColorStop(0, "rgba(155, 140, 255, 0.35)");
  glow.addColorStop(1, "rgba(155, 140, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

// The stamp: a tilted badge with the meme count.
function drawStamp(ctx, stats, cx, cy, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.09);
  ctx.scale(scale, scale);
  ctx.strokeStyle = C.lime;
  ctx.lineWidth = 3;
  roundRect(ctx, -128, -70, 256, 140, 18);
  ctx.stroke();
  ctx.fillStyle = C.lime;
  ctx.textAlign = "center";
  const value = `×${num(stats.absolutelyRight)}`;
  ctx.font = `800 ${fitFont(ctx, value, 220, 64)}px ${DISPLAY}`;
  ctx.fillText(value, 0, 12);
  ctx.font = `500 18px ${MONO}`;
  ctx.fillText(t("cardRight"), 0, 48);
  ctx.restore();
}

function tiles(stats) {
  return [
    [num(Math.round(stats.hours)), t("cardHours")],
    [compact(stats.prompts), t("cardPrompts")],
    [num(stats.streak), t("cardStreak")],
    [money(stats.cost), t("cardValue")],
  ];
}

function footnote(stats) {
  const parts = [stats.favorite?.label];
  if (stats.topLanguage) parts.push(t("cardMostly", { language: stats.topLanguage }));
  parts.push(`${compact(stats.tokens)} tokens`);
  return parts.filter(Boolean).join(" · ");
}

// 7 rows × 24 columns of prompt counts, brightest cell = busiest hour.
export function drawHeat(ctx, heat, x, y, w, h) {
  const max = Math.max(1, ...heat.flat());
  const cw = w / 24;
  const ch = h / 7;
  heat.forEach((row, d) =>
    row.forEach((n, hr) => {
      const k = n / max;
      ctx.fillStyle = k === 0 ? C.panel : `rgba(200, 255, 90, ${0.15 + 0.85 * k})`;
      ctx.fillRect(x + hr * cw + 1, y + d * ch + 1, cw - 2, ch - 2);
    })
  );
}

function fitFont(ctx, text, maxWidth, size) {
  let s = size;
  ctx.font = `800 ${s}px ${DISPLAY}`;
  while (ctx.measureText(text).width > maxWidth && s > 20) {
    s -= 2;
    ctx.font = `800 ${s}px ${DISPLAY}`;
  }
  return s;
}

function wrap(ctx, text, x, y, maxWidth, lineHeight) {
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
