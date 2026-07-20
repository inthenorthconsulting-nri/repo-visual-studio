// Deterministic-indicator-only classification. Fixed order: configured path
// match -> recognized frontmatter -> recognized heading pattern -> filename
// convention -> explicit `type:` frontmatter field. A document matching none
// of these is `unsupported`, never guessed into being a decision.

import type { DecisionSourceIssueKind, DecisionSourceType } from "./contracts.js";

const DECISION_TYPES: readonly DecisionSourceType[] = ["adr", "rfc", "design_decision", "decision_log"];

const ADR_HEADING_PATTERN = /^#\s*ADR[-_]?\d+/im;
const DECISION_HEADING_PATTERN = /^##\s*Decision:/im;
const ADR_FILENAME_PATTERN = /\d{4}-.*\.md$/i;

export interface ClassificationInput {
  repo_relative_path: string;
  configured_type: DecisionSourceType | undefined;
  raw_content: string;
  frontmatter: Record<string, unknown> | undefined;
}

export interface ClassificationResult {
  source_type: DecisionSourceType;
  classification_basis: "configured_path" | "frontmatter" | "heading_pattern" | "filename_convention" | "explicit_type_field" | "none";
  issue_kind?: DecisionSourceIssueKind;
}

export function classifyDecisionSource(input: ClassificationInput): ClassificationResult {
  if (input.configured_type) {
    return { source_type: input.configured_type, classification_basis: "configured_path" };
  }

  const explicitType = input.frontmatter?.["type"];
  if (typeof explicitType === "string" && isDecisionType(explicitType)) {
    return { source_type: explicitType, classification_basis: "explicit_type_field" };
  }

  if (hasDecisionFrontmatterShape(input.frontmatter)) {
    return { source_type: inferTypeFromFrontmatterId(input.frontmatter), classification_basis: "frontmatter" };
  }

  if (ADR_HEADING_PATTERN.test(input.raw_content)) {
    return { source_type: "adr", classification_basis: "heading_pattern" };
  }
  if (DECISION_HEADING_PATTERN.test(input.raw_content)) {
    return { source_type: "design_decision", classification_basis: "heading_pattern" };
  }

  if (ADR_FILENAME_PATTERN.test(input.repo_relative_path)) {
    return { source_type: "adr", classification_basis: "filename_convention" };
  }

  return { source_type: "unsupported", classification_basis: "none", issue_kind: "unsupported_source_type" };
}

function isDecisionType(value: string): value is DecisionSourceType {
  return (DECISION_TYPES as readonly string[]).includes(value);
}

function hasDecisionFrontmatterShape(frontmatter: Record<string, unknown> | undefined): boolean {
  if (!frontmatter) return false;
  const hasId = typeof frontmatter["id"] === "string";
  const hasStatus = typeof frontmatter["status"] === "string";
  const hasAdrKey = "adr" in frontmatter;
  return (hasId && hasStatus) || hasAdrKey;
}

function inferTypeFromFrontmatterId(frontmatter: Record<string, unknown> | undefined): DecisionSourceType {
  const id = frontmatter?.["id"];
  if (typeof id === "string") {
    if (/^rfc/i.test(id)) return "rfc";
    if (/^adr/i.test(id)) return "adr";
  }
  return "design_decision";
}
