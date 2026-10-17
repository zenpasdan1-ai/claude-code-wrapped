const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// The picker's value -> a { from, to } window in epoch ms, or null for all time.
export function periodRange(value, now = Date.now()) {
  if (value === "year") return { from: new Date(new Date(now).getFullYear(), 0, 1).getTime(), to: Infinity };
  if (value === "90" || value === "30") return { from: now - Number(value) * DAY_MS, to: Infinity };
  if (value === "19h") return { from: now - 19 * HOUR_MS, to: Infinity };
  return null;
}
