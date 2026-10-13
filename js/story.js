import { drawHeat } from "./card.js";
import { compact, date, hourLabel, money, num, percent, t } from "./i18n.js";

const COUNT_MS = 900;

// Each slide: { id, bg, html, mount?(el) } built from finalized stats. bg names img/story/<bg>.webp.
export function buildSlides(s) {
  const [archName, archLine] = t("archetypes")[s.archetype];
  const topTool = s.tools[0]?.[0] ?? "—";
  const busiest = s.busiest ? date(Date.parse(s.busiest.day + "T12:00:00")) : "—";

  return [
    {
      id: "intro",
      bg: "intro",
      html: `
        <p class="kicker">${t("introKicker", { from: date(s.from), to: date(s.to) })}</p>
        <h2 class="display">${t("introBig")}</h2>
        <p class="line">${t("introLine", { sessions: num(s.sessions), files: num(s.files) })}</p>`,
    },
    {
      id: "time",
      bg: "time",
      html: `
        <p class="kicker">${t("timeKicker")}</p>
        <p class="big"><span data-count="${s.hours}" data-digits="0">0</span> <span class="unit">${t("timeUnit")}</span></p>
        <p class="line">${t("timeLine")}</p>
        <p class="sub">${t("timeSub", { h: num(s.longest.ms / 3_600_000, 1), date: date(s.longest.start), project: "<span class=\"project\">" + esc(s.longest.project) + "</span>" })}</p>`,
    },
    {
      id: "prompts",
      bg: "talk",
      html: `
        <p class="kicker">${t("promptsKicker")}</p>
        <p class="big"><span data-count="${s.prompts}">0</span> <span class="unit">${t("promptsUnit")}</span></p>
        <p class="line">${t("promptsLine", { words: num(s.promptWords) })}</p>
        <p class="sub">${t("promptsSub", { please: num(s.please), thanks: num(s.thanks), swears: num(s.swears), interrupts: num(s.interrupts) })}</p>`,
    },
    {
      id: "right",
      bg: "talk",
      html: `
        <p class="kicker">${t("rightKicker")}</p>
        <p class="big stamp">×<span data-count="${s.absolutelyRight}">0</span></p>
        <p class="line">${s.absolutelyRight ? t("rightLine") : t("rightZero")}</p>`,
    },
    {
      id: "cost",
      bg: "tokens",
      html: `
        <p class="kicker">${t("costKicker")}</p>
        <p class="big"><span data-count="${s.cost}" data-money="1">$0</span></p>
        <p class="line">${t("costLine")}</p>
        <p class="sub">${t("costSub", { tokens: compact(s.tokens), output: compact(s.outputTokens) })}</p>`,
    },
    {
      id: "models",
      bg: "tokens",
      html: `
        <p class="kicker">${t("modelsKicker")}</p>
        <p class="big">${esc(s.favorite?.label ?? "—")}</p>
        <p class="line">${t("modelsLine", { share: percent(s.favorite?.share ?? 0) })}</p>
        ${bars(s.models.slice(0, 5).map((m) => [m.label, m.share, percent(m.share)]))}`,
    },
    {
      id: "rhythm",
      bg: "hands",
      html: `
        <p class="kicker">${t("rhythmKicker")}</p>
        <canvas class="heat" role="img" aria-label="${t("rhythmLine", { hour: hourLabel(s.peakHour), night: percent(s.nightShare) })}"></canvas>
        <p class="heat-days" aria-hidden="true">${t("weekdays").map((d) => `<span>${d}</span>`).join("")}</p>
        <p class="line">${t("rhythmLine", { hour: hourLabel(s.peakHour), night: percent(s.nightShare) })}</p>`,
      mount(el) {
        const c = el.querySelector(".heat");
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = c.clientWidth;
        const h = c.clientHeight;
        c.width = w * dpr;
        c.height = h * dpr;
        const ctx = c.getContext("2d");
        ctx.scale(dpr, dpr);
        // Weekday labels on the left, hour ticks underneath.
        const left = 40;
        const bottom = 22;
        drawHeat(ctx, s.heat, left, 0, w - left, h - bottom);
        ctx.fillStyle = "#9a97a6";
        ctx.font = '12px "JetBrains Mono", monospace';
        ctx.textBaseline = "middle";
        const rowH = (h - bottom) / 7;
        t("weekdays").forEach((d, i) => ctx.fillText(d, 0, rowH * i + rowH / 2));
        ctx.textAlign = "center";
        const colW = (w - left) / 24;
        for (const hr of [0, 6, 12, 18]) ctx.fillText(hourLabel(hr), left + colW * hr + colW / 2, h - 8);
      },
    },
    {
      id: "streak",
      bg: "time",
      html: `
        <p class="kicker">${t("streakKicker")}</p>
        <p class="big"><span data-count="${s.streak}">0</span> <span class="unit">${t("streakUnit")}</span></p>
        <p class="line">${t("streakLine", { days: num(s.activeDays), busiest, prompts: num(s.busiest?.prompts ?? 0) })}</p>`,
    },
    {
      id: "tools",
      bg: "hands",
      html: `
        <p class="kicker">${t("toolsKicker")}</p>
        <p class="big"><span data-count="${s.toolCalls}">0</span> <span class="unit">${t("toolsUnit")}</span></p>
        <p class="line">${t("toolsLine", { per: num(s.toolsPerPrompt, 1), tool: esc(topTool) })}</p>
        ${bars(s.tools.slice(0, 6).map(([name, n]) => [name, n / (s.tools[0]?.[1] || 1), compact(n)]))}`,
    },
    s.languages.length && {
      id: "languages",
      bg: "code",
      html: `
        <p class="kicker">${t("langKicker")}</p>
        <p class="big">${esc(s.topLanguage)}</p>
        <p class="line">${t("langLine", { share: percent(languageShare(s)), files: num(s.editedFiles) })}</p>
        ${bars(s.languages.slice(0, 5).map(([name, n]) => [name, n / (s.languages[0]?.[1] || 1), compact(n)]))}`,
    },
    {
      id: "odds",
      bg: "code",
      html: `
        <p class="kicker">${t("oddsKicker")}</p>
        <dl class="odds">
          ${odd(`<span data-count="${s.longestPrompt}">0</span>`, t("oddsLongest"))}
          ${odd(`<span data-count="${s.interrupts}">0</span>`, t("oddsInterrupts"))}
          ${odd(`<span data-count="${s.subagents}">0</span>`, t("oddsSubagents"))}
          ${odd(s.priciestDay ? money(s.priciestDay.cost) : "—", t("oddsPriciest", { date: s.priciestDay ? date(Date.parse(s.priciestDay.day + "T12:00:00")) : "—" }))}
        </dl>`,
    },
    {
      id: "projects",
      bg: "code",
      html: `
        <p class="kicker">${t("projectsKicker")}</p>
        <p class="line">${t("projectsLine")}</p>
        ${bars(s.projects.slice(0, 5).map(([name, n], i) => [`<span class="project" data-alias="#${i + 1}">${esc(name)}</span>`, n / (s.projects[0]?.[1] || 1), compact(n)]), true)}
        <label class="toggle"><input type="checkbox" class="show-names" id="show-names"> ${t("showNames")}</label>`,
    },
    {
      id: "final",
      bg: "final",
      html: `
        <p class="kicker">${t("youAre")}</p>
        <h2 class="display">${archName}</h2>
        <p class="line">${archLine}</p>
        <img class="portrait" src="img/archetypes/${s.archetype}.webp" alt="" width="512" height="512">
        <div class="formats" role="group" aria-label="${t("formatPost")} / ${t("formatStory")}">
          <button class="btn btn-small fmt" type="button" data-format="post" aria-pressed="true">${t("formatPost")}</button>
          <button class="btn btn-small fmt" type="button" data-format="story" aria-pressed="false">${t("formatStory")}</button>
        </div>
        <img class="card" alt="${archName}: ${num(Math.round(s.hours))} ${t("cardHours")}, ${num(s.prompts)} ${t("cardPrompts")}">
        <div class="share-row">
          <button class="btn btn-hot share" type="button">${t("share")}</button>
          <a class="btn save" download="claude-code-wrapped.png" href="#">${t("saveImage")}</a>
          <button class="btn copy" type="button">${t("copyText")}</button>
        </div>
        <p class="sub">${t("saveHint")}</p>
        <p class="status" role="status"></p>`,
    },
  ].filter(Boolean);
}

// Count big numbers up from zero; reduced motion shows the final value at once.
export function countUp(el, animate) {
  for (const node of el.querySelectorAll("[data-count]")) {
    const target = Number(node.dataset.count);
    const digits = Number(node.dataset.digits ?? 0);
    const format = node.dataset.money ? (v) => money(v) : (v) => num(v, digits);
    if (!animate) {
      node.textContent = format(target);
      continue;
    }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / COUNT_MS);
      node.textContent = format(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

function languageShare(s) {
  const top = s.languages.find(([name]) => name === s.topLanguage);
  return top && s.languageEdits ? top[1] / s.languageEdits : 0;
}

function odd(value, label) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function bars(rows, raw = false) {
  return `<ul class="bars">${rows
    .map(
      ([label, k, value]) => `
      <li>
        <span class="bar-label">${raw ? label : esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="--k:${Math.max(0.02, k).toFixed(3)}"></span></span>
        <span class="bar-value">${value}</span>
      </li>`
    )
    .join("")}</ul>`;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
