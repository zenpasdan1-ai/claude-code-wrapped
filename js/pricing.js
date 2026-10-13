// API list prices in USD per million tokens, used only to show what the same usage
// would have cost on the pay-as-you-go API. Current models come from Anthropic's
// published table (cached 2026-10-06). Cache writes are priced at 1.25x input and
// cache reads at 0.1x input unless a model has its own published read price.
// Rows marked legacy are older published prices kept so old transcripts still count.

const PRICES = [
  // prefix, label, input, output, cacheRead (optional override)
  ["claude-fable-5-1", "Fable 5.1", 10, 50, 0.25],
  ["claude-mythos-5-1", "Mythos 5.1", 10, 50, 0.25],
  ["claude-fable-5", "Fable 5", 10, 50, 1],
  ["claude-mythos-5", "Mythos 5", 10, 50, 1],
  ["claude-opus-5-5", "Opus 5.5", 4, 20, 0.2],
  ["claude-opus-5", "Opus 5", 5, 25],
  ["claude-opus-4-8", "Opus 4.8", 5, 25],
  ["claude-opus-4-7", "Opus 4.7", 5, 25],
  ["claude-opus-4-6", "Opus 4.6", 5, 25],
  ["claude-opus-4-5", "Opus 4.5", 5, 25],
  ["claude-opus-4-1", "Opus 4.1", 15, 75], // legacy
  ["claude-opus-4", "Opus 4", 15, 75], // legacy
  ["claude-3-opus", "Opus 3", 15, 75], // legacy
  ["claude-sonnet-5-5", "Sonnet 5.5", 2, 10, 0.2],
  ["claude-sonnet-5", "Sonnet 5", 2, 10],
  ["claude-sonnet-4-6", "Sonnet 4.6", 3, 15],
  ["claude-sonnet-4-5", "Sonnet 4.5", 3, 15],
  ["claude-sonnet-4", "Sonnet 4", 3, 15], // legacy
  ["claude-3-7-sonnet", "Sonnet 3.7", 3, 15], // legacy
  ["claude-3-5-sonnet", "Sonnet 3.5", 3, 15], // legacy
  ["claude-haiku-5-5", "Haiku 5.5", 0.1, 0.5],
  ["claude-haiku-4-5", "Haiku 4.5", 1, 5],
  ["claude-3-5-haiku", "Haiku 3.5", 0.8, 4], // legacy
  ["claude-3-haiku", "Haiku 3", 0.25, 1.25], // legacy
];

// Longest prefix wins, so "claude-opus-4-1-20250805" is Opus 4.1, not Opus 4.
const SORTED = [...PRICES].sort((a, b) => b[0].length - a[0].length);

export function modelInfo(model) {
  const id = String(model || "").toLowerCase().replace(/^(anthropic\.|us\.anthropic\.)/, "");
  const row = SORTED.find(([prefix]) => id.startsWith(prefix));
  if (!row) return { label: prettyUnknown(id), family: familyOf(id), priced: false };
  const [, label, input, output, cacheRead] = row;
  return {
    label,
    family: familyOf(id),
    priced: true,
    input,
    output,
    cacheWrite: input * 1.25,
    cacheRead: cacheRead ?? input * 0.1,
  };
}

export function costOf(info, usage) {
  if (!info.priced) return 0;
  return (
    (usage.input * info.input +
      usage.output * info.output +
      usage.cacheWrite * info.cacheWrite +
      usage.cacheRead * info.cacheRead) /
    1e6
  );
}

function familyOf(id) {
  for (const f of ["fable", "mythos", "opus", "sonnet", "haiku"]) if (id.includes(f)) return f;
  return "other";
}

function prettyUnknown(id) {
  if (!id || id === "<synthetic>") return "Other";
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}
