// Finds Claude Code transcript files on this machine.

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

// Where Claude Code keeps transcripts: CLAUDE_CONFIG_DIR wins, then the usual homes.
export function candidateDirs(env = process.env, home = homedir()) {
  const dirs = [];
  for (const base of (env.CLAUDE_CONFIG_DIR || "").split(",").map((d) => d.trim()).filter(Boolean)) {
    dirs.push(join(base, "projects"));
  }
  dirs.push(join(home, ".claude", "projects"), join(home, ".config", "claude", "projects"));
  return [...new Set(dirs.map((d) => resolve(d)))];
}

// Every .jsonl under the given folders, numbered for the local routes.
export async function listTranscripts(dirs) {
  const files = [];
  for (const dir of dirs) {
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) continue;
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) continue;
      const abs = join(entry.parentPath ?? entry.path, entry.name);
      files.push({
        id: files.length,
        name: entry.name,
        // The parser reads the project from the folder name, so keep "<project-dir>/<file>".
        path: relative(dir, abs).split(sep).join("/") || basename(abs),
        abs,
      });
    }
  }
  return files;
}
