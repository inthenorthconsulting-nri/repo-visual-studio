import type { EvidenceConfidence } from "./types.js";

const EXPRESSION_RE = /\$\{\{\s*(.+?)\s*\}\}/g;

export interface ExpressionScan {
  isDynamic: boolean;
  expressions: string[];
}

// GitHub Actions expressions (`${{ ... }}`) can only be statically resolved
// when every referenced context is fixed at parse time (e.g. `github.repository`
// often is, `inputs.*`/`matrix.*`/`needs.*.outputs.*` never are without running
// the workflow). We never fabricate a resolved value — a value containing any
// expression is preserved verbatim and marked with the most conservative
// confidence that applies.
export function scanExpressions(value: string): ExpressionScan {
  const expressions = [...value.matchAll(EXPRESSION_RE)].map((m) => m[1] ?? "");
  return { isDynamic: expressions.length > 0, expressions };
}

const STATICALLY_RESOLVABLE_PREFIXES = ["github.repository", "github.repository_owner", "github.workflow"];

export function classifyExpressionConfidence(expressions: string[]): EvidenceConfidence {
  if (expressions.length === 0) return "confirmed";
  const allResolvable = expressions.every((expr) =>
    STATICALLY_RESOLVABLE_PREFIXES.some((prefix) => expr.trim().startsWith(prefix)),
  );
  return allResolvable ? "partially-resolved" : "dynamic";
}

const EXPRESSION_TEST_RE = /\$\{\{\s*(.+?)\s*\}\}/;

export function containsExpression(value: unknown): value is string {
  return typeof value === "string" && EXPRESSION_TEST_RE.test(value);
}
