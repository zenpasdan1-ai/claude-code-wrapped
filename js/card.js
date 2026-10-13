import { compact, date, money, num, t } from "./i18n.js";

const W = 1200;
const H = 675;
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

// Landscape card sized for an X/Twitter image post.
export function renderCard(stats) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, -60, 20, W * 0.85, -60, 620);
  glow.addColorStop(0, "rgba(155, 140, 255, 0.35)");
  glow.addColorStop(1, "rgba(155, 140, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = C.lime;
  ctx.font = `600 22px ${MONO}`;
  ctx.fillText("CLAUDE CODE WRAPPED", 64, 82);
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${MONO}`;
  ctx.fillText(`${date(stats.from)} – ${date(stats.to)}`, 64, 114);

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

  const tiles = [
    [num(Math.round(stats.hours)), t("cardHours")],
    [compact(stats.prompts), t("cardPrompts")],
    [num(stats.streak), t("cardStreak")],
    [money(stats.cost), t("cardValue")],
  ];
  tiles.forEach(([value, label], i) => {
    const x = 64 + i * 200;
    ctx.fillStyle = C.ink;
    ctx.font = `800 ${fitFont(ctx, value, 180, 52)}px ${DISPLAY}`;
    ctx.fillText(value, x, 468);
    ctx.fillStyle = C.muted;
    ctx.font = `400 18px ${MONO}`;
    ctx.fillText(label, x, 498);
  });

  // The stamp: a tilted badge with the meme count.
  ctx.save();
  ctx.translate(1010, 430);
  ctx.rotate(-0.09);
  ctx.strokeStyle = C.lime;
  ctx.lineWidth = 3;
  roundRect(ctx, -128, -70, 256, 140, 18);
  ctx.stroke();
  ctx.fillStyle = C.lime;
  ctx.textAlign = "center";
  ctx.font = `800 64px ${DISPLAY}`;
  ctx.fillText(`×${num(stats.absolutelyRight)}`, 0, 12);
  ctx.font = `500 18px ${MONO}`;
  ctx.fillText(t("cardRight"), 0, 48);
  ctx.restore();

  drawHeat(ctx, stats.heat, 64, 548, 1072, 56);

  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText(`${stats.favorite?.label ?? ""} · ${compact(stats.tokens)} tokens`, 64, 640);
  ctx.textAlign = "right";
  ctx.fillText(`#ClaudeCodeWrapped · ${t("unofficial")}`, W - 64, 640);
  return canvas;
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
