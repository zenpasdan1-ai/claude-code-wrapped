// Plain-text checkup for the terminal: `ccwrapped --report`.

import { date, fill, money, num, percent, t } from "../js/i18n.js";
import { delta, describeFinding, describeHealthy, describePlanItem } from "../js/checkup-text.js";
import { buildFixes } from "../js/fixes.js";

const WIDTH = 78;

export function formatReport(stats, { color = false } = {}) {
  const c = stats.checkup;
  const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const bold = paint("1");
  const dim = paint("2");
  const lime = paint("38;5;155");
  const red = paint("38;5;210");
  const yellow = paint("38;5;222");
  const out = [];
  const line = (text = "") => out.push(text);

  line(bold(`Claude Code ${t("checkup")} · ${date(stats.from)} – ${date(stats.to)}`));
  line(dim(t("checkupLead")));
  line();
  const row = (label, value, sub = "") => line(`${label.padEnd(24)}${bold(value)}${sub ? "  " + dim(sub) : ""}`);
  row(t("ckSpend"), money(c.total), t("ckBreakdown", {
    input: money(c.spend.input),
    output: money(c.spend.output),
    cacheWrite: money(c.spend.cacheWrite),
    cacheRead: money(c.spend.cacheRead),
  }));
  row("", "", t("ckPerDay", { money: money(c.perActiveDay), benchmark: money(c.benchmarkDay) }));
  row(t("ckSavings"), c.savings > 0 ? t("ckSavingsValue", { money: money(c.savings) }) : t("ckNoSavings"), c.savings > 0 ? [t("ckSavingsSub", { share: percent(c.savingsShare) }), c.savingsMonthly !== null ? t("ckSavingsMonth", { money: money(c.savingsMonthly) }) : ""].filter(Boolean).join(" · ") : "");
  if (c.firstTry !== null) row(t("ckFirstTry"), percent(c.firstTry), t("ckFirstTrySub"));
  row(t("ckLoops"), num(c.loops), t("ckLoopsSub", { hours: num(c.loopHours, 1) }));
  line();

  const w = c.week;
  line(bold(`${t("ckWeek")} `) + dim(`(${t("ckWeekVs")})`));
  if (w.prev) {
    line(`  ${t("ckWeekCost")} ${money(w.cur.cost)} ${dim(delta(w.cur.cost, w.prev.cost))} · ${t("ckWeekPrompts")} ${num(w.cur.prompts)} ${dim(delta(w.cur.prompts, w.prev.prompts))}` +
      (w.cur.firstTry !== null ? ` · ${t("ckWeekFirstTry")} ${percent(w.cur.firstTry)} ${dim(delta(w.cur.firstTry, w.prev.firstTry, true))}` : ""));
  } else {
    line(`  ${t("ckWeekCost")} ${money(w.cur.cost)} · ${t("ckWeekPrompts")} ${num(w.cur.prompts)}  ${dim(t("ckNoPrev"))}`);
  }
  line();

  if (c.findings.length) {
    line(bold(t("startHere")));
    if (!c.plan.length) wrap(t("startHereNone"), "  ").forEach((l) => line(l));
    c.plan.forEach((f, i) => {
      const p = describePlanItem(f);
      line(`  ${lime(String(i + 1) + ".")} ${bold(p.action)}  ${lime(p.gain)}  ${dim(p.effort)}`);
    });
    line();
  }

  const main = c.findings.filter((f) => f.level !== "low");
  const minor = c.findings.filter((f) => f.level === "low");
  line(bold(t("ckFindings")));
  if (!main.length) line(`  ${lime(t("ckNoFindings"))}`);
  main.forEach((f, i) => {
    const d = describeFinding(f);
    const tag = f.level === "high" ? red : yellow;
    line();
    line(`${i + 1}. ${bold(d.title)} ${tag(`[${t("ckLevel")[f.level]}]`)} ${dim(t("ckEffort")[f.effort])}`);
    for (const text of [d.line, d.save, d.extra].filter(Boolean)) wrap(text, "   ").forEach((l) => line(l));
    if (d.projects.length) line(`   ${dim(t("ckWhere") + ":")} ${d.projects.map(([name, v]) => `${name} ${v}`).join(" · ")}`);
    line(`   ${dim(t("ckDo") + ":")}`);
    for (const a of d.actions) wrap(a, "     ", "   – ").forEach((l) => line(l));
    for (const fix of buildFixes(f)) {
      const labels = t("fixLabel");
      const label = fix.project ? fill(labels.claudemdIn, { project: fix.project }) : fill(labels[fix.kind], { path: fix.path ?? "" });
      line(`   ${dim(label + ":")}`);
      for (const text of fix.text.split("\n")) line(`     ${lime(text)}`);
    }
  });
  if (minor.length) {
    line();
    line(bold(t("minorTitle")) + " " + dim(t("minorLead")));
    for (const f of minor) {
      const p = describePlanItem(f);
      line(`  – ${describeFinding(f).title}  ${dim(p.gain)}`);
    }
  }
  if (c.healthy.length) {
    line();
    line(bold(t("ckHealthy")));
    for (const h of c.healthy) wrap(describeHealthy(h), "    ", `  ${lime("✓")} `).forEach((l) => line(l));
  }
  line();
  wrap(t("ckNote"), "").forEach((l) => line(dim(l)));
  return out.join("\n");
}

function wrap(text, indent, first = indent) {
  const lines = [];
  let cur = first;
  let empty = true;
  for (const word of text.split(" ")) {
    if (!empty && visible(cur).length + 1 + word.length > WIDTH) {
      lines.push(cur);
      cur = indent + word;
    } else {
      cur += (empty ? "" : " ") + word;
    }
    empty = false;
  }
  lines.push(cur);
  return lines;
}

function visible(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
