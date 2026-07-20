// Raw parsed sections/frontmatter/table -> ArchitectureDecision fields.
// Field precedence is always frontmatter > heading sections > leading table
// > fallback -- frontmatter is the most explicit, structured signal a
// document author can provide.

import type { DecisionScope, DecisionStatus } from "./contracts.js";
import type { RawParsedDecision } from "./markdown-parser.js";
import { mapDecisionStatus } from "./status.js";

const VALID_SCOPES: readonly DecisionScope[] = ["component", "capability", "product", "portfolio", "cross_cutting", "unresolved"];

export interface NormalizedDecisionFields {
  title: string;
  decision_status: DecisionStatus;
  scope: DecisionScope;
  context?: string;
  decision_text?: string;
  authors: string[];
  date?: string;
  supersedes: string[];
  superseded_by: string[];
}

export function normalizeDecisionFields(
  parsed: RawParsedDecision,
  frontmatter: Record<string, unknown> | undefined,
  fallbackTitle: string,
  statusMapping: Record<string, string[]> | undefined,
): NormalizedDecisionFields {
  const title = firstNonEmptyString(stringField(frontmatter, "title"), parsed.title, fallbackTitle) ?? fallbackTitle;

  const rawStatus = firstNonEmptyString(
    stringField(frontmatter, "status"),
    parsed.sections["status"],
    parsed.table?.["status"],
  );
  const decision_status = mapDecisionStatus(rawStatus, statusMapping);

  const rawScope = stringField(frontmatter, "scope");
  const scope = isDecisionScope(rawScope) ? rawScope : "unresolved";

  const context = firstNonEmptyString(stringField(frontmatter, "context"), parsed.sections["context"]);
  const decision_text = firstNonEmptyString(stringField(frontmatter, "decision"), parsed.sections["decision"]);

  const authors = normalizeStringArray(frontmatter?.["authors"] ?? frontmatter?.["author"]);
  const date = firstNonEmptyString(stringField(frontmatter, "date"), parsed.table?.["date"]);
  const supersedes = normalizeStringArray(frontmatter?.["supersedes"]);
  const superseded_by = normalizeStringArray(frontmatter?.["superseded_by"] ?? frontmatter?.["superseded-by"]);

  return { title, decision_status, scope, context, decision_text, authors, date, supersedes, superseded_by };
}

function isDecisionScope(value: string | undefined): value is DecisionScope {
  return value !== undefined && (VALID_SCOPES as readonly string[]).includes(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}
