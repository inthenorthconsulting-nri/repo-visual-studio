import type { ArchitectureNodeStatus } from "@rvs/architecture-graph";

// @cdktf/hcl2json (the primary HCL parser — see hcl-bridge.ts) preserves any
// non-literal HCL expression verbatim as source text containing `${...}`
// interpolation markers, exactly as GitHub Actions' `${{ }}` expressions are
// preserved verbatim by @rvs/workflow-graph's own expression handling. This
// module classifies that preserved text; it never evaluates it.
export type TerraformExpressionConfidence = "confirmed" | "partially-resolved" | "dynamic" | "unsupported";

// Contexts that vary per resource instance / module call and can never be
// statically resolved to one fixed target, even though the syntax is valid
// and fully deterministic to parse.
const ITERATION_DEPENDENT_PREFIXES = ["count.", "each.", "self."];

// Statically fixed at parse time regardless of `terraform apply` context.
const STATICALLY_RESOLVABLE_PREFIXES = ["path.root", "path.module", "path.cwd", "terraform.workspace"];

export function isDynamicValue(value: unknown): value is string {
  return typeof value === "string" && value.includes("${");
}

// Extracts every `${ ... }` interpolation body from a raw HCL-source-text
// value. Only handles one level of brace nesting inside the interpolation
// (sufficient for the reference-address extraction this feeds — see
// extractReferenceAddresses) — deeply nested for-expressions or object
// constructors are preserved as raw text but their internal addresses may
// not all be extracted. This is a documented limitation (spec section 4/25
// point 6), not a silent failure: unextracted expressions still make the
// owning node/edge "dynamic", they just may not produce every possible
// reference edge.
export function extractInterpolations(value: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("${", i);
    if (start === -1) break;
    let depth = 1;
    let j = start + 2;
    while (j < value.length && depth > 0) {
      if (value[j] === "{") depth++;
      else if (value[j] === "}") depth--;
      j++;
    }
    results.push(value.slice(start + 2, depth === 0 ? j - 1 : j));
    i = j;
  }
  return results;
}

const ADDRESS_RE = /\b([a-zA-Z_][a-zA-Z0-9_-]*(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)+)\b/g;

// Conservative static-address extraction: pulls dotted identifier chains
// (e.g. "aws_vpc.main.id", "module.network.vpc_id", "var.region") out of an
// expression body, excluding anything immediately followed by "(" (a
// function call, not an address) or preceded by "." (an attribute chain
// continuation already captured by the longer match). Never evaluates the
// expression; a chain is either found verbatim in the source or it isn't
// reported at all.
export function extractReferenceAddresses(expressionBody: string): string[] {
  const found = new Set<string>();
  for (const match of expressionBody.matchAll(ADDRESS_RE)) {
    const full = match[1];
    const afterIndex = (match.index ?? 0) + full.length;
    if (expressionBody[afterIndex] === "(") continue; // function call, e.g. jsonencode(...)
    const beforeIndex = (match.index ?? 0) - 1;
    if (beforeIndex >= 0 && expressionBody[beforeIndex] === ".") continue; // mid-chain fragment
    found.add(full);
  }
  return [...found];
}

export function classifyExpressionConfidence(value: unknown): TerraformExpressionConfidence {
  if (!isDynamicValue(value)) return "confirmed";
  const interpolations = extractInterpolations(value);
  if (interpolations.length === 0) return "unsupported";
  let worst: TerraformExpressionConfidence = "confirmed";
  for (const body of interpolations) {
    const trimmed = body.trim();
    if (ITERATION_DEPENDENT_PREFIXES.some((p) => trimmed.startsWith(p))) {
      worst = "dynamic";
    } else if (STATICALLY_RESOLVABLE_PREFIXES.some((p) => trimmed.startsWith(p))) {
      if (worst === "confirmed") worst = "partially-resolved";
    } else {
      // A reference to var./local./module./data./a resource address is
      // statically extractable (handled separately by
      // extractReferenceAddresses) but the *value itself* still can't be
      // resolved without evaluating Terraform — conservatively "dynamic".
      worst = "dynamic";
    }
  }
  return worst;
}

export function expressionConfidenceToNodeStatus(confidence: TerraformExpressionConfidence): ArchitectureNodeStatus {
  switch (confidence) {
    case "confirmed":
      return "confirmed";
    case "partially-resolved":
      return "partial";
    case "dynamic":
      return "dynamic";
    case "unsupported":
      return "unresolved";
  }
}
