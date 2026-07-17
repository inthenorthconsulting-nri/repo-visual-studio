// Presentation-only label humanization for GitHub Actions vocabulary that is
// otherwise rendered verbatim (raw trigger event names, raw dynamic
// `${{ ... }}` expressions). This never changes a WorkflowNode's canonical
// `label`, id, or evidence — callers apply it only to the text they draw on
// screen. The dictionary below is GitHub Actions platform vocabulary (not
// specific to any one repository), so it is safe to hardcode deterministically
// without a new source adapter or model-assisted synthesis.

const TRIGGER_DISPLAY_NAMES: Record<string, string> = {
  workflow_dispatch: "Manual trigger",
  workflow_call: "Reusable invocation",
  workflow_run: "Upstream workflow trigger",
  schedule: "Scheduled trigger",
  pull_request: "Pull-request trigger",
  pull_request_target: "Pull-request trigger",
  pull_request_review: "Pull-request review trigger",
  push: "Repository update",
  repository_dispatch: "Repository event",
  release: "Release trigger",
  issues: "Issue event",
  issue_comment: "Issue comment event",
  create: "Branch or tag creation",
  delete: "Branch or tag deletion",
  fork: "Repository fork event",
  status: "Status update event",
  deployment: "Deployment event",
  deployment_status: "Deployment status event",
};

function snakeOrKebabToTitleCase(raw: string): string {
  const words = raw
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  return words.map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
}

/** Maps a raw GitHub Actions trigger event name (e.g. "workflow_dispatch") to a human-readable label. Unknown event names fall back to a generic title-cased rendering rather than being left in raw snake_case. */
export function humanizeTriggerName(eventName: string): string {
  return TRIGGER_DISPLAY_NAMES[eventName] ?? snakeOrKebabToTitleCase(eventName);
}

function humanizeIdentifierPath(expr: string): string {
  const lastSegment = expr.trim().split(".").pop() ?? expr;
  return snakeOrKebabToTitleCase(lastSegment);
}

// Parses the common GitHub Actions ternary-select shape:
//   <cond-lhs> == '<cond-value>' && '<then-value>' || '<else-value>'
// This is a syntactic pattern, not domain knowledge about any one
// repository's environment/approval names — it applies to any workflow using
// this idiom to pick a value conditionally.
const TERNARY_SELECT_RE = /^(.+?)\s*==\s*['"]([^'"]*)['"]\s*&&\s*['"][^'"]*['"]\s*\|\|\s*['"][^'"]*['"]$/;
const QUOTED_LITERAL_RE = /['"]([^'"]+)['"]/g;

/** Summarizes a single GitHub Actions `${{ ... }}` expression body into a short, readable phrase. The raw expression is never discarded by the caller — this is presentation text only. */
export function summarizeExpression(expr: string): string {
  const trimmed = expr.trim();
  const ternary = TERNARY_SELECT_RE.exec(trimmed);
  if (ternary) {
    const [, lhs, condValue] = ternary;
    return `Conditional value when ${humanizeIdentifierPath(lhs)} is "${condValue}"`;
  }

  const literals = [...trimmed.matchAll(QUOTED_LITERAL_RE)].map((m) => m[1]).filter((s) => s.length > 0);
  if (literals.length > 0) {
    return `Value depends on: ${[...new Set(literals)].join(", ")}`;
  }

  return `Value from ${humanizeIdentifierPath(trimmed)}`;
}

const EXPRESSION_SPLICE_RE = /\$\{\{\s*(.+?)\s*\}\}/g;

/**
 * Humanizes presentation text that may be: a raw trigger event name, text
 * containing one or more `${{ ... }}` expressions, or an ordinary label
 * (returned unchanged). Safe to apply broadly before rendering — it is a
 * no-op for text that matches neither pattern.
 */
export function humanizeDisplayLabel(raw: string): string {
  if (Object.prototype.hasOwnProperty.call(TRIGGER_DISPLAY_NAMES, raw)) {
    return humanizeTriggerName(raw);
  }
  if (EXPRESSION_SPLICE_RE.test(raw)) {
    EXPRESSION_SPLICE_RE.lastIndex = 0;
    return raw.replace(EXPRESSION_SPLICE_RE, (_match, expr: string) => summarizeExpression(expr));
  }
  return raw;
}
