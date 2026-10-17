// The checkup page: totals, the last week, findings with fixes, and what's already fine.

import { delta, describeFinding, describeHealthy, describePlanItem, findingStat, splitStep } from "./checkup-text.js?v=19h";
import { buildFixes, claudeMdAdditions } from "./fixes.js?v=19h";
import { date, fill, money, moneyRound, num, percent, t } from "./i18n.js";

const SPEND_PARTS = [
  ["input", "var(--violet)"],
  ["output", "var(--ink)"],
  ["cacheWrite", "#ff9d8a"],
  ["cacheRead", "var(--lime)"],
];

export function renderReport(s) {
  const c = s.checkup;
  const main = c.findings.filter((f) => f.level !== "low");
  const minor = c.findings.filter((f) => f.level === "low");
  return `
    <header class="report-head">
      <p class="kicker">${t("checkupKicker")} · ${date(s.from)} – ${date(s.to)}</p>
      <h1 class="display">${t("checkup")}</h1>
      <p class="line">${t("checkupLead")}</p>
    </header>

    <div class="kpis">
      ${kpi(t("ckSpend"), money(c.total), spendBar(c))}
      ${kpi(t("ckSavings"), c.savings > 0 ? t("ckSavingsValue", { money: money(c.savings) }) : t("ckNoSavings"), c.savings > 0 ? `<p class="kpi-sub">${t("ckSavingsSub", { share: percent(c.savingsShare) })}${c.savingsMonthly !== null ? `<br>${t("ckSavingsMonth", { money: money(c.savingsMonthly) })}` : ""}</p>` : "", c.savings > 0 ? "is-hot" : "")}
      ${c.firstTry !== null ? kpi(t("ckFirstTry"), percent(c.firstTry), `<p class="kpi-sub">${t("ckFirstTrySub")}</p>`) : ""}
      ${kpi(t("ckLoops"), num(c.loops), `<p class="kpi-sub">${t("ckLoopsSub", { hours: num(c.loopHours, 1) })}</p>`)}
    </div>

    ${plan(c)}

    ${week(c.week)}

    <h2 class="section-title">${t("ckFindings")}</h2>
    ${main.length ? `<ol class="findings">${main.map(finding).join("")}</ol>` : `<p class="line">${t("ckNoFindings")}</p>`}
    ${minor.length ? `
      <details class="minor">
        <summary><span class="section-title">${t("minorTitle")}</span> <span class="muted">(${minor.length})</span></summary>
        <p class="sub">${t("minorLead")}</p>
        <ol class="findings">${minor.map(finding).join("")}</ol>
      </details>` : ""}

    ${allClaudeMd(c.findings)}

    ${c.healthy.length ? `
      <h2 class="section-title">${t("ckHealthy")}</h2>
      <ul class="healthy">${c.healthy.map((h) => `<li>${esc(describeHealthy(h))}</li>`).join("")}</ul>` : ""}

    <label class="toggle"><input type="checkbox" class="show-names" id="report-show-names"> ${t("showNames")}</label>
    <p class="sub note">${t("ckNote")}</p>
    <div class="report-cta">
      <button class="btn btn-hot play-story" type="button">${t("playStory")} →</button>
    </div>`;
}

function plan(c) {
  if (!c.findings.length) return "";
  const items = c.plan.map((f) => {
    const p = describePlanItem(f);
    return `<li><a href="#finding-${f.id}">${esc(p.action)}</a><span class="plan-gain">${esc(p.gain)}</span><span class="plan-effort">${esc(p.effort)}</span></li>`;
  });
  return `
    <section class="plan">
      <p class="kicker">${t("startHere")}</p>
      ${items.length ? `<ol>${items.join("")}</ol><p class="sub">${t("startHereLead")}</p>` : `<p class="line">${t("startHereNone")}</p>`}
    </section>`;
}

function kpi(label, value, extra = "", cls = "") {
  return `<div class="kpi ${cls}"><p class="kpi-label">${label}</p><p class="kpi-value">${value}</p>${extra}</div>`;
}

function spendBar(c) {
  const total = SPEND_PARTS.reduce((sum, [k]) => sum + c.spend[k], 0) || 1;
  const segs = SPEND_PARTS.map(([k, color]) => `<span style="flex-grow:${(c.spend[k] / total).toFixed(4)};background:${color}"></span>`).join("");
  const legend = SPEND_PARTS.map(([k, color]) => `<span><i style="background:${color}"></i>${t(`ckPart_${k}`)} ${money(c.spend[k])}</span>`).join("");
  const perDay = `<p class="kpi-sub">${t("ckPerDay", { money: moneyRound(c.perActiveDay), benchmark: moneyRound(c.benchmarkDay) })}</p>`;
  return `<p class="spend-bar" aria-hidden="true">${segs}</p><p class="kpi-sub legend">${legend}</p>${perDay}`;
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

const VISIBLE_STEPS = 3;

// A card leads with what to do and what it's worth; the why, the where and the snippets fold away.
function finding(f) {
  const d = describeFinding(f);
  const stat = findingStat(f);
  const steps = d.actions.map(splitStep);
  const list = buildFixes(f);
  const extraSteps = steps.slice(VISIBLE_STEPS);
  const where = d.projects.length
    ? `<p class="where"><span class="muted">${t("ckWhere")}:</span> ${d.projects.map(([name, v], i) => `<span class="project" data-alias="#${i + 1}">${esc(name)}</span> ${esc(v)}`).join(" · ")}</p>`
    : "";
  const hasMore = list.length || extraSteps.length || where || d.extra || (f.save > 0 && d.save);
  const summary = [
    extraSteps.length ? (extraSteps.length === 1 ? t("moreStep") : t("moreSteps", { n: extraSteps.length })) : "",
    list.length ? (list.length === 1 ? t("moreFix") : t("moreFixes", { n: list.length })) : "",
  ].filter(Boolean).join(" · ") || t("moreDetails");
  return `
    <li class="finding is-${f.level}" id="finding-${f.id}">
      <div class="finding-top">
        <img class="finding-art" src="img/checkup/${f.id}.webp" alt="" width="320" height="320" loading="lazy" onerror="this.remove()">
        <div class="finding-title">
          <h3>${esc(d.title)}</h3>
          <p class="pills"><span class="pill pill-level">${t("ckLevel")[f.level]}</span><span class="pill">${t("ckEffort")[f.effort]}</span></p>
        </div>
        ${stat ? `<p class="finding-stat"><strong>${esc(stat.value)}</strong><span>${esc(stat.label)}</span></p>` : ""}
      </div>
      <p class="finding-line">${esc(d.line)}</p>
      <ol class="steps" aria-label="${t("stepsTitle")}">${steps.slice(0, VISIBLE_STEPS).map(step).join("")}</ol>
      ${hasMore ? `
      <details class="more">
        <summary><span>${summary}</span></summary>
        ${extraSteps.length ? `<ol class="steps" start="${VISIBLE_STEPS + 1}">${extraSteps.map(step).join("")}</ol>` : ""}
        ${f.save > 0 && d.save ? `<p class="more-note">${esc(d.save)}</p>` : ""}
        ${d.extra ? `<p class="more-note">${esc(d.extra)}</p>` : ""}
        ${where}
        ${list.map(fixBlock).join("")}
      </details>` : ""}
    </li>`;
}

function step({ head, detail }) {
  return `<li><strong>${code(esc(head))}</strong>${detail ? `<span>${code(esc(detail))}</span>` : ""}</li>`;
}

function fixBlock(fix) {
  const labels = t("fixLabel");
  const label = fix.project
    ? fill(esc(labels.claudemdIn), { project: `<span class="project">${esc(fix.project)}</span>` })
    : esc(fill(labels[fix.kind], { path: fix.path ?? "" }));
  return `
    <div class="fix">
      <div class="fix-head">
        <span class="fix-label">${label}</span>
        <span class="fix-status status" role="status"></span>
        <button class="btn btn-small copy-fix" type="button">${t("fixCopy")}</button>
      </div>
      <pre><code>${esc(fix.text)}</code></pre>
    </div>`;
}

function allClaudeMd(findings) {
  const text = claudeMdAdditions(findings);
  if (!text) return "";
  return `
    <section class="all-md">
      <h2 class="section-title">${t("allMdTitle")}</h2>
      <p class="sub">${t("allMdLead")}</p>
      ${fixBlock({ kind: "claudemd", text })}
      <p class="sub">${t("allMdNote")}</p>
    </section>`;
}

// Slash commands and file names read better as code.
function code(text) {
  return text.replace(/(^|\s)(\/[a-z]+|CLAUDE\.md)(?=[\s,.)]|$)/g, "$1<code>$2</code>");
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
