import { summarizeExpression } from "@rvs/workflow-graph";
import type { NormalizedLabel } from "./types.js";

const LOWERCASE_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via"]);

const SHORT_LABEL_MAX_CHARS = 28;
const DISPLAY_LABEL_MAX_WORDS = 8;

// Deployment-tier vocabulary is platform-generic (not specific to any one
// repository), so reordering "admin-prod" -> "Production Admin" is safe to
// hardcode deterministically. Matched against a single word segment only.
const ENVIRONMENT_TIERS: { pattern: RegExp; label: string }[] = [
  { pattern: /^prod(uction)?$/i, label: "Production" },
  { pattern: /^stag(e|ing)$/i, label: "Staging" },
  { pattern: /^dev(elopment)?$/i, label: "Development" },
  { pattern: /^qa$/i, label: "QA" },
  { pattern: /^uat$/i, label: "UAT" },
  { pattern: /^test(ing)?$/i, label: "Test" },
  { pattern: /^sandbox$/i, label: "Sandbox" },
];

function stripPathAndExtension(raw: string): string {
  const lastSegment = raw.split("/").pop() ?? raw;
  return lastSegment.replace(/\.(ya?ml|tf|json|md|ts|js)$/i, "");
}

function splitWords(raw: string): string[] {
  const withoutPath = stripPathAndExtension(raw);
  const spaced = withoutPath
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/[_\-.]+/g, " ") // kebab/snake/dotted -> spaces
    .replace(/\s+/g, " ")
    .trim();
  return spaced.length > 0 ? spaced.split(" ") : [withoutPath];
}

function titleCase(words: string[]): string {
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_WORDS.has(lower)) return lower;
      if (/^[A-Z0-9]+$/.test(word) && word.length <= 5) return word; // preserve acronyms (CLI, PDT, IAM)
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Normalizes any raw identifier (file path, workflow name, resource address,
 * dynamic expression) into a source/display/short label triple. Canonical
 * IDs are never derived from this — only human-facing text.
 */
export function normalizeLabel(raw: string): NormalizedLabel {
  const sourceLabel = raw;
  const words = splitWords(raw);
  const displayWords = words.slice(0, DISPLAY_LABEL_MAX_WORDS);
  const displayLabel = titleCase(displayWords) || raw;
  const shortWords = words.slice(0, 3);
  let shortLabel = titleCase(shortWords) || displayLabel;
  if (shortLabel.length > SHORT_LABEL_MAX_CHARS) {
    shortLabel = `${shortLabel.slice(0, SHORT_LABEL_MAX_CHARS - 1).trimEnd()}…`;
  }
  return { sourceLabel, displayLabel, shortLabel };
}

/** For dynamic expressions (e.g. Terraform `for_each`/GHA `${{ matrix.x }}`): keep the raw expression in evidence/metadata, produce a human-readable summary as the label via the shared GitHub-Actions-expression summarizer. */
export function summarizeDynamicExpression(raw: string): NormalizedLabel {
  const inner = raw.trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
  const summary = summarizeExpression(inner);
  const displayLabel = `Dynamic value (${summary})`;
  return { sourceLabel: raw, displayLabel, shortLabel: "Dynamic value", basis: "dynamic-expression" };
}

/**
 * Like normalizeLabel, but for deployment-environment names specifically:
 * detects a leading/trailing tier keyword (prod/dev/staging/qa/uat/test/
 * sandbox) and reorders the label so the tier reads first (e.g.
 * "admin-prod" -> "Production Admin"), which scans better on a boundary
 * diagram than the raw ordering. Falls back to normalizeLabel when no tier
 * keyword is present.
 */
export function normalizeEnvironmentLabel(raw: string): NormalizedLabel {
  const words = splitWords(raw);
  if (words.length >= 2) {
    const tierAtEnd = ENVIRONMENT_TIERS.find((t) => t.pattern.test(words[words.length - 1]));
    const tierAtStart = !tierAtEnd ? ENVIRONMENT_TIERS.find((t) => t.pattern.test(words[0])) : undefined;
    const tier = tierAtEnd ?? tierAtStart;
    if (tier) {
      const rest = tierAtEnd ? words.slice(0, -1) : words.slice(1);
      const displayLabel = rest.length > 0 ? `${tier.label} ${titleCase(rest)}` : tier.label;
      const shortLabel = displayLabel.length > SHORT_LABEL_MAX_CHARS ? `${displayLabel.slice(0, SHORT_LABEL_MAX_CHARS - 1).trimEnd()}…` : displayLabel;
      return { sourceLabel: raw, displayLabel, shortLabel, basis: "environment-heuristic" };
    }
  }
  return normalizeLabel(raw);
}
