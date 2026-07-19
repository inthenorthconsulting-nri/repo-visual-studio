import type { NormalizedLabel } from "@rvs/architecture-intelligence";

// §11 naming rules: human-readable, no raw implementation verbs leading the
// name (a directory/function called "parseQueryGuard" should read as "Query
// and workload governance", not "Parse Query Guard"). normalizeLabel()
// already title-cases and strips paths/extensions; this only removes a
// leading implementation-verb word normalizeLabel would otherwise keep.
const IMPLEMENTATION_VERBS = new Set(["parse", "load", "write", "run", "exec", "execute", "build", "generate", "handle", "process", "do"]);

/**
 * Human-facing capability name, derived from (never replacing) the raw
 * source label — sourceLabel/basis are always retained on NormalizedLabel
 * for traceability back to what was actually found.
 */
export function humanizeCapabilityName(label: NormalizedLabel): NormalizedLabel {
  const words = label.displayLabel.split(" ");
  if (words.length <= 1) return label;
  const [first, ...rest] = words;
  if (!IMPLEMENTATION_VERBS.has(first.toLowerCase())) return label;
  const displayLabel = rest.join(" ") || label.displayLabel;
  return { ...label, displayLabel, basis: label.basis ? `${label.basis}, implementation-verb-stripped` : "implementation-verb-stripped" };
}
