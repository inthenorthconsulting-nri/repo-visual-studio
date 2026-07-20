// Shared DecisionLink model + resolution-state machine, used once by all
// five *-links.ts modules below rather than duplicated five times.
//
// Links are extracted from structured syntax only -- a decision's
// frontmatter `links:` array of `{ type, domain, target }` entries -- never
// inferred from prose mentions in `context`/`decision_text`. A textual
// mention of an entity's name is never sufficient to create a link.

import type { DecisionLink, DecisionLinkTargetDomain, DecisionLinkType, EvidenceRef } from "./contracts.js";
import { buildLinkId } from "./ids.js";

const LINK_TYPES: readonly DecisionLinkType[] = [
  "governs",
  "introduces",
  "removes",
  "replaces",
  "constrains",
  "permits",
  "deprecates",
  "requires",
  "explains",
  "justifies",
  "depends_on",
  "implements",
  "validates",
  "excepts",
  "affects",
  "references",
];

const TARGET_DOMAINS: readonly DecisionLinkTargetDomain[] = ["architecture", "capability", "product", "portfolio", "governance", "decision"];

export interface DeclaredDecisionLink {
  link_type: DecisionLinkType;
  target_domain: DecisionLinkTargetDomain;
  target_key: string;
}

/** Reads `frontmatter.links`, a structured array of link declarations. Malformed entries are dropped, never guessed into a valid shape. */
export function extractDeclaredLinks(frontmatter: Record<string, unknown> | undefined): DeclaredDecisionLink[] {
  const raw = frontmatter?.["links"];
  if (!Array.isArray(raw)) return [];

  const declared: DeclaredDecisionLink[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const linkType = record["type"];
    const targetDomain = record["domain"];
    const targetKey = record["target"];
    if (
      typeof linkType === "string" &&
      isLinkType(linkType) &&
      typeof targetDomain === "string" &&
      isTargetDomain(targetDomain) &&
      typeof targetKey === "string" &&
      targetKey.trim().length > 0
    ) {
      declared.push({ link_type: linkType, target_domain: targetDomain, target_key: targetKey.trim() });
    }
  }
  return declared;
}

function isLinkType(value: string): value is DecisionLinkType {
  return (LINK_TYPES as readonly string[]).includes(value);
}

function isTargetDomain(value: string): value is DecisionLinkTargetDomain {
  return (TARGET_DOMAINS as readonly string[]).includes(value);
}

export type LinkResolutionOutcome =
  | { resolution: "resolved"; targetId: string }
  | { resolution: "partially_resolved"; targetId: string }
  | { resolution: "unresolved" }
  | { resolution: "ambiguous" }
  | { resolution: "incompatible"; targetId: string };

export function buildDecisionLink(
  decisionId: string,
  linkType: DecisionLinkType,
  targetDomain: DecisionLinkTargetDomain,
  targetKey: string,
  outcome: LinkResolutionOutcome,
  detail: string,
  evidenceRefs: EvidenceRef[],
): DecisionLink {
  return {
    id: buildLinkId(decisionId, linkType, targetKey),
    decision_id: decisionId,
    link_type: linkType,
    target_domain: targetDomain,
    target_id: "targetId" in outcome ? outcome.targetId : undefined,
    resolution: outcome.resolution,
    detail,
    evidence_refs: evidenceRefs,
  };
}

/**
 * The base resolution rule shared by the four upstream-artifact link
 * modules: no known-entity-id set to check against (upstream artifact
 * absent/incompatible) -> unresolved (never assumed resolved); an exact
 * membership match -> resolved; no match -> unresolved. Never fuzzy, never
 * name-similarity based.
 */
export function resolveAgainstEntityIds(targetKey: string, knownEntityIds: Set<string> | undefined): LinkResolutionOutcome {
  if (!knownEntityIds || !knownEntityIds.has(targetKey)) return { resolution: "unresolved" };
  return { resolution: "resolved", targetId: targetKey };
}

const MAX_ID_COLLECTION_DEPTH = 6;

/**
 * Structurally collects every string `id` field found anywhere inside an
 * already-parsed upstream artifact (architecture/capability/product/
 * portfolio snapshot JSON), bounded to a fixed recursion depth. This
 * package never imports the upstream packages' types, so it cannot address
 * a specific entity array by name (`components`, `capabilities`, ...) --
 * walking the JSON structurally is the only option that stays correct
 * across all four upstream shapes without importing them.
 */
export function collectKnownEntityIds(snapshot: unknown): Set<string> {
  const ids = new Set<string>();
  walk(snapshot, 0, ids);
  return ids;
}

function walk(value: unknown, depth: number, ids: Set<string>): void {
  if (depth > MAX_ID_COLLECTION_DEPTH || value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, ids);
    return;
  }

  const record = value as Record<string, unknown>;
  const id = record["id"];
  if (typeof id === "string" && id.trim().length > 0) ids.add(id);

  for (const child of Object.values(record)) walk(child, depth + 1, ids);
}
