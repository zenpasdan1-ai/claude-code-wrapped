// Words for checkup findings, shared by the page and the terminal report.

import { compact, money, moneyRound, num, percent, t } from "./i18n.js?v=2";

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
    case "reread":
      return {
        title: t("f_reread_title"),
        line: t("f_reread_line", { count: num(x.count), readShare: percent(x.readShare), tokens: compact(x.avgTokens) }),
        save: t("f_reread_save", saved),
        extra: x.files.length ? t("f_reread_files", { list: x.files.map(([name, n]) => `${name} ×${num(n)}`).join(", ") }) : "",
        actions: t("f_reread_do"),
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

// The one number a finding card leads with: money per month (or in the period), else its own metric.
export function findingStat(f) {
  const x = f.facts;
  if (f.save > 0) {
    const value = f.monthly !== null ? f.monthly : f.save;
    const when = f.monthly !== null ? t("statMonth") : t("statPeriod");
    return { value: `≈${moneyRound(value)}`, label: `${when} · ${t("statShare", { share: percent(f.share ?? 0) })}` };
  }
  if (f.id === "loops") return { value: `×${num(x.count)}`, label: t("statLoops") };
  if (f.id === "corrections") return { value: percent(x.rate), label: t("statCorrections") };
  if (f.id === "promptLength") return { value: t("ckBuckets")[x.best.i], label: t("statWords") };
  return null;
}

// "Do X. Because Y" → a short bold headline and the rest as a quieter detail.
export function splitStep(text) {
  const m = text.match(/^(.{8,110}?[.:?!])\s+(.+)$/s);
  if (!m) return { head: text, detail: "" };
  const detail = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  return { head: m[1].replace(/:$/, ""), detail };
}

// One line for the "Start here" list: what to do, what it's worth, how much work it is.
export function describePlanItem(f) {
  const x = f.facts;
  let gain = "";
  if (f.save > 0) gain = f.monthly !== null ? t("gainMonth", { money: moneyRound(f.monthly) }) : t("gainTotal", { money: moneyRound(f.save) });
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
