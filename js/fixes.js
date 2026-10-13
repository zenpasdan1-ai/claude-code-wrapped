// Copy-paste fixes for checkup findings: CLAUDE.md sections, a subagent file, a /compact
// command and a task template. Kept short on purpose: CLAUDE.md is sent with every request.

import { t } from "./i18n.js";

const MAX_COMMANDS = 3;

// kind: "claudemd" (append to CLAUDE.md), "file" (save at path), "command" (run in Claude Code),
// "prompt" (paste when starting a task).
export function buildFixes(finding) {
  switch (finding.id) {
    case "context":
      return [
        { kind: "command", text: t("fix_compact_context") },
        { kind: "claudemd", key: "context", text: lines(t("fix_md_context")) },
        { kind: "claudemd", key: "compact", text: lines(t("fix_md_compact")) },
      ];
    case "cold": {
      const fixes = [{ kind: "command", text: t("fix_compact_break") }];
      if (finding.facts.ttlWorthIt) fixes.push({ kind: "settings", path: "~/.claude/settings.json", text: lines(t("fix_settings_ttl")) });
      return fixes;
    }
    case "fit":
      return [
        { kind: "file", path: ".claude/agents/explorer.md", text: lines(t("fix_agent_explorer")) },
        { kind: "claudemd", key: "fit", text: lines(t("fix_md_fit")) },
      ];
    case "loops": {
      const fixes = [{ kind: "claudemd", key: "failures", text: lines(t("fix_md_failures")) }];
      for (const [project, commands] of finding.facts.commandsByProject) {
        const list = commands.map(([cmd]) => `- \`${cmd}\`: …`);
        fixes.push({ kind: "claudemd", key: `commands:${project}`, project, text: lines([t("fix_md_commands_title"), t("fix_cmd_hint"), ...list]) });
      }
      return fixes;
    }
    case "corrections":
      return [{ kind: "claudemd", key: "corrections", text: lines(t("fix_md_corrections")) }];
    case "promptLength":
      return [{ kind: "prompt", text: lines(t("fix_prompt_template")) }];
    default:
      return [];
  }
}

// The CLAUDE.md sections that fit any project, once each, in finding order.
// Project-specific ones (each project's own commands) stay with their finding.
export function claudeMdAdditions(findings) {
  const seen = new Set();
  const parts = [];
  for (const f of findings) {
    for (const fix of buildFixes(f)) {
      if (fix.kind !== "claudemd" || fix.project || seen.has(fix.key)) continue;
      seen.add(fix.key);
      parts.push(fix.text);
    }
  }
  return parts.join("\n\n");
}

function lines(list) {
  return list.join("\n");
}
