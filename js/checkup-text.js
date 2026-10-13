// Words for checkup findings, shared by the page and the terminal report.

import { compact, money, num, percent, t } from "./i18n.js";

export function describeFinding(f) {
  const x = f.facts;
  const saved = { money: money(f.save), share: percent(f.share ?? 0) };
  switch (f.id) {
    case "context":
      return {
        title: t("f_context_title"),
        line: t("f_context_line", { returns: num(x.returns), carry: compact(x.avgCarry), huge: percent(x.hugeShare), compactions: num(x.autoCompactions) }),
        save: t("f_context_save", saved),
        actions: t("f_context_do"),
        projects: f.projects.map(([name, v]) => [name, money(v)]),
      };
    case "cold":
      return {
        title: t("f_cold_title"),
        line: t("f_cold_line", { events: num(x.events) }),
        save: t("f_cold_save", saved),
        extra: x.ttlWorthIt ? t("f_cold_ttl", { money: money(x.ttlNet) }) : "",
        actions: t("f_cold_do"),
        projects: f.projects.map(([name, v]) => [name, money(v)]),
      };
    case "fit":
      return {
        title: t("f_fit_title"),
        line: t("f_fit_line", { requests: num(x.requests), requestShare: percent(x.requestShare) }),
        save: t("f_fit_save", saved),
        actions: t("f_fit_do"),
        projects: f.projects.map(([name, v]) => [name, money(v)]),
      };
    case "loops":
      return {
        title: t("f_loops_title"),
        line: t("f_loops_line", { count: num(x.count), hours: num(x.hours, 1), errorRate: percent(x.errorRate) }),
        extra: x.commands.length ? t("f_loops_commands", { list: x.commands.map(([cmd, n]) => `${cmd} ×${num(n)}`).join(", ") }) : "",
        actions: t("f_loops_do"),
        projects: f.projects.map(([name, v]) => [name, `×${num(v)}`]),
      };
    case "corrections":
      return {
        title: t("f_corrections_title"),
        line: t("f_corrections_line", { rate: percent(x.rate), corrected: num(x.corrected), judged: num(x.judged) }),
        actions: t("f_corrections_do"),
        projects: f.projects.map(([name, v]) => [name, percent(v)]),
      };
    case "promptLength": {
      const label = (b) => t("ckBuckets")[b.i];
      return {
        title: t("f_promptLength_title"),
        line: t("f_promptLength_line", { best: label(x.best), bestRate: percent(x.best.rate), worst: label(x.worst), worstRate: percent(x.worst.rate) }),
        actions: t("f_promptLength_do", { best: label(x.best) }),
        projects: [],
      };
    }
    default:
      return { title: f.id, line: "", actions: [], projects: [] };
  }
}

// One line for the "Start here" list: what to do, what it's worth, how much work it is.
export function describePlanItem(f) {
  const x = f.facts;
  let gain = "";
  if (f.save > 0) gain = f.monthly !== null ? t("gainMonth", { money: money(f.monthly) }) : t("gainTotal", { money: money(f.save) });
  else if (f.id === "loops") gain = x.hoursMonthly !== null && x.hoursMonthly >= 0.1 ? t("gainHoursMonth", { hours: num(x.hoursMonthly, 1) }) : t("gainLoops", { count: num(x.count) });
  else if (f.id === "corrections") gain = t("gainCorrections", { rate: percent(x.rate) });
  else if (f.id === "promptLength") gain = t("gainPromptLength", { worst: percent(x.worst.rate), best: percent(x.best.rate) });
  const best = f.id === "promptLength" ? t("ckBuckets")[x.best.i] : "";
  return { action: t(`plan_${f.id}`, { best }), gain, effort: t("ckEffort")[f.effort] };
}

export function describeHealthy(h) {
  const value = h.id === "context" || h.id === "loops" || h.id === "corrections" ? percent(h.value) : num(h.value);
  return t(`h_${h.id}`, { value });
}

// Signed change between two numbers, as text: "+12%" or "−5 pts".
export function delta(cur, prev, points = false) {
  if (prev === null || prev === undefined || cur === null || cur === undefined) return "";
  if (points) {
    const d = Math.round((cur - prev) * 100);
    return `${d === 0 ? "±" : d > 0 ? "+" : "−"}${Math.abs(d)} ${t("ckPts")}`;
  }
  if (!prev) return "";
  const d = Math.round(((cur - prev) / prev) * 100);
  return d === 0 ? "±0%" : `${d > 0 ? "+" : "−"}${Math.abs(d)}%`;
}
