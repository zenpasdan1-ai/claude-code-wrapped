// The checkup page: totals, the last week, findings with fixes, and what's already fine.

import { delta, describeFinding, describeHealthy } from "./checkup-text.js";
import { date, money, num, percent, t } from "./i18n.js";

const SPEND_PARTS = [
  ["input", "var(--violet)"],
  ["output", "var(--ink)"],
  ["cacheWrite", "#ff9d8a"],
  ["cacheRead", "var(--lime)"],
];

export function renderReport(s) {
  const c = s.checkup;
  return `
    <header class="report-head">
      <p class="kicker">${t("checkupKicker")} · ${date(s.from)} – ${date(s.to)}</p>
      <h2 class="display">${t("checkup")}</h2>
      <p class="line">${t("checkupLead")}</p>
    </header>

    <div class="kpis">
      ${kpi(t("ckSpend"), money(c.total), spendBar(c))}
      ${kpi(t("ckSavings"), c.savings > 0 ? t("ckSavingsValue", { money: money(c.savings) }) : t("ckNoSavings"), c.savings > 0 ? `<p class="kpi-sub">${t("ckSavingsSub", { share: percent(c.savingsShare) })}</p>` : "", c.savings > 0 ? "is-hot" : "")}
      ${c.firstTry !== null ? kpi(t("ckFirstTry"), percent(c.firstTry), `<p class="kpi-sub">${t("ckFirstTrySub")}</p>`) : ""}
      ${kpi(t("ckLoops"), num(c.loops), `<p class="kpi-sub">${t("ckLoopsSub", { hours: num(c.loopHours, 1) })}</p>`)}
    </div>

    ${week(c.week)}

    <h3 class="section-title">${t("ckFindings")}</h3>
    ${c.findings.length ? `<ol class="findings">${c.findings.map(finding).join("")}</ol>` : `<p class="line">${t("ckNoFindings")}</p>`}

    ${c.healthy.length ? `
      <h3 class="section-title">${t("ckHealthy")}</h3>
      <ul class="healthy">${c.healthy.map((h) => `<li>${esc(describeHealthy(h))}</li>`).join("")}</ul>` : ""}

    <label class="toggle"><input type="checkbox" class="show-names" id="report-show-names"> ${t("showNames")}</label>
    <p class="sub note">${t("ckNote")}</p>
    <div class="report-cta">
      <button class="btn btn-hot play-story" type="button">${t("playStory")} →</button>
    </div>`;
}

function kpi(label, value, extra = "", cls = "") {
  return `<div class="kpi ${cls}"><p class="kpi-label">${label}</p><p class="kpi-value">${value}</p>${extra}</div>`;
}

function spendBar(c) {
  const total = SPEND_PARTS.reduce((sum, [k]) => sum + c.spend[k], 0) || 1;
  const segs = SPEND_PARTS.map(([k, color]) => `<span style="flex-grow:${(c.spend[k] / total).toFixed(4)};background:${color}"></span>`).join("");
  const legend = SPEND_PARTS.map(([k, color]) => `<span><i style="background:${color}"></i>${t(`ckPart_${k}`)} ${money(c.spend[k])}</span>`).join("");
  return `<p class="spend-bar" aria-hidden="true">${segs}</p><p class="kpi-sub legend">${legend}</p>`;
}

function week(w) {
  const cell = (label, value, change) => `<div><dt>${label}</dt><dd>${value} <span class="delta">${change}</span></dd></div>`;
  return `
    <section class="week" aria-label="${t("ckWeek")}">
      <p class="kicker">${t("ckWeek")} <span class="muted">${w.prev ? t("ckWeekVs") : ""}</span></p>
      <dl>
        ${cell(t("ckWeekCost"), money(w.cur.cost), w.prev ? delta(w.cur.cost, w.prev.cost) : "")}
        ${cell(t("ckWeekPrompts"), num(w.cur.prompts), w.prev ? delta(w.cur.prompts, w.prev.prompts) : "")}
        ${w.cur.firstTry !== null ? cell(t("ckWeekFirstTry"), percent(w.cur.firstTry), w.prev ? delta(w.cur.firstTry, w.prev.firstTry, true) : "") : ""}
      </dl>
      ${w.prev ? "" : `<p class="sub">${t("ckNoPrev")}</p>`}
    </section>`;
}

function finding(f) {
  const d = describeFinding(f);
  return `
    <li class="finding is-${f.level}">
      <div class="finding-head">
        <h4>${esc(d.title)}</h4>
        <span class="badge">${t("ckLevel")[f.level]}</span>
      </div>
      ${f.save > 0 ? `<p class="finding-save">${esc(d.save)}</p>` : ""}
      <p>${esc(d.line)}</p>
      ${d.extra ? `<p class="sub">${esc(d.extra)}</p>` : ""}
      ${d.projects.length ? `<p class="where"><span class="muted">${t("ckWhere")}:</span> ${d.projects.map(([name, v], i) => `<span class="project" data-alias="#${i + 1}">${esc(name)}</span> ${esc(v)}`).join(" · ")}</p>` : ""}
      <div class="todo">
        <p class="todo-title">${t("ckDo")}</p>
        <ul>${d.actions.map((a) => `<li>${code(esc(a))}</li>`).join("")}</ul>
      </div>
    </li>`;
}

// Slash commands and file names read better as code.
function code(text) {
  return text.replace(/(^|\s)(\/[a-z]+|CLAUDE\.md)(?=[\s,.)]|$)/g, "$1<code>$2</code>");
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
