// The attribute-support model. A `modify_attributes`/`modify_relation`
// operation's `attributes` bag is caller-supplied `Record<string, unknown>`
// -- every key must be classified before it is ever applied to an overlay
// node/edge, so an unsupported or unrecognized key is disclosed rather than
// silently written or silently dropped.

import type { AttributeSupportFinding, AttributeSupportStatus } from "./contracts.js";

/** KnowledgeNode fields a proposal is allowed to assert directly. Identity fields (id/node_type/source_artifact/source_entity_id/repository_id/schema_version) are never mutable via modify_attributes -- a source-key/type change is a distinct remove+add+relation-remap the caller must express explicitly. `resolution_status`/`confidence` are derived by upstream evidence machinery, not caller-assertable. */
const SUPPORTED_NODE_ATTRIBUTES = new Set(["label", "evidence_refs"]);
const KNOWN_NODE_FIELDS = new Set([
  "id",
  "node_type",
  "source_artifact",
  "source_entity_id",
  "label",
  "evidence_refs",
  "resolution_status",
  "schema_version",
  "repository_id",
  "confidence",
]);

/** KnowledgeEdge fields a proposal is allowed to assert directly on modify_relation. `resolution_status` is derived, never caller-assertable. Identity fields (id/from_node_id/to_node_id/edge_type/direction) require remove_relation + add_relation instead. */
const SUPPORTED_EDGE_ATTRIBUTES = new Set(["detail"]);
const KNOWN_EDGE_FIELDS = new Set(["id", "edge_type", "from_node_id", "to_node_id", "direction", "evidence_refs", "resolution_status", "detail"]);

function classify(key: string, supported: Set<string>, known: Set<string>): AttributeSupportStatus {
  if (supported.has(key)) return "supported";
  if (known.has(key)) return "unsupported";
  return "unresolved";
}

export function classifyNodeAttributes(attributes: Record<string, unknown>): AttributeSupportFinding[] {
  return Object.keys(attributes)
    .sort()
    .map((key) => {
      const status = classify(key, SUPPORTED_NODE_ATTRIBUTES, KNOWN_NODE_FIELDS);
      return { key, status, detail: describe(key, status, "entity") };
    });
}

export function classifyEdgeAttributes(attributes: Record<string, unknown>): AttributeSupportFinding[] {
  return Object.keys(attributes)
    .sort()
    .map((key) => {
      const status = classify(key, SUPPORTED_EDGE_ATTRIBUTES, KNOWN_EDGE_FIELDS);
      return { key, status, detail: describe(key, status, "relation") };
    });
}

function describe(key: string, status: AttributeSupportStatus, subject: "entity" | "relation"): string {
  switch (status) {
    case "supported":
      return `"${key}" is a supported ${subject} attribute and will be applied to the overlay.`;
    case "unsupported":
      return `"${key}" is a real ${subject} field but is not directly caller-assertable (it is identity or derived); this proposal's value for it is disclosed but not applied.`;
    case "unresolved":
      return `"${key}" is not a recognized ${subject} field at all; this proposal's value for it is disclosed but not applied.`;
  }
}

/** Applies only the supported subset of `attributes` to a shallow-copied node's label/evidence_refs, returning the new object. Never mutates the input. */
export function applySupportedNodeAttributes<T extends { label: string; evidence_refs: unknown[] }>(node: T, attributes: Record<string, unknown>): T {
  const next: T = { ...node };
  if (typeof attributes.label === "string") (next as { label: string }).label = attributes.label;
  if (Array.isArray(attributes.evidence_refs)) (next as { evidence_refs: unknown[] }).evidence_refs = attributes.evidence_refs;
  return next;
}

export function applySupportedEdgeAttributes<T extends { detail: string }>(edge: T, attributes: Record<string, unknown>): T {
  const next: T = { ...edge };
  if (typeof attributes.detail === "string") (next as { detail: string }).detail = attributes.detail;
  return next;
}
