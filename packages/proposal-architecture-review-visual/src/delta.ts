// Proposed Delta operation cards (Milestone 11.3.3.2B, §4/§60-§62).
//
// Builds one `DeltaOperationCard` per `ProposalOperation`, in the caller's
// exact original `operations` order (§73) -- operation index is load-
// bearing elsewhere in this milestone's upstream contracts
// (`ProposalValidationIssue.operation_index` / `OverlayBuildIssue.operation_index`)
// and this package preserves that same indexing rather than renumbering.
//
// Before-values are recovered ONLY from the confirmed Observed Baseline (or,
// for a relation endpoint this same proposal itself introduces, from that
// proposal's own `add_entity` operations) -- never from
// `@rvs/change-workbench`'s overlay-building or evaluator functions, and
// never fabricated when a lookup misses. Attribute comparisons are
// restricted to the fields `@rvs/change-workbench/src/attribute-support.ts`
// documents as recoverable (node: `label`/`evidence_refs`; edge: `detail`);
// an unsupported or unrecognized key is disclosed, not silently dropped or
// silently applied.
//
// This package's dependency boundary (§8 of this milestone's authorization)
// forbids depending on `@rvs/change-workbench` at all, so the classification
// below is a deliberate, intentionally narrow restatement of that upstream
// module's `classifyNodeAttributes()`/`classifyEdgeAttributes()` logic --
// not an import of it. If the upstream supported/known-field sets ever
// change, this restatement must be updated by hand to match; it is not
// re-derived automatically.

import type { ObservedBaselineGraph, ProposalOperations } from "@rvs/proposal-architecture-review";
import { buildDeltaOperationCardId } from "./ids.js";
import type { AttributeValueComparison, DeltaOperationCard, EntityBaselineLookup } from "./contracts.js";

const SUPPORTED_NODE_ATTRIBUTES = new Set(["label", "evidence_refs"]);
const KNOWN_NODE_FIELDS = new Set(["id", "node_type", "source_artifact", "source_entity_id", "label", "evidence_refs", "resolution_status", "schema_version", "repository_id", "confidence"]);

const SUPPORTED_EDGE_ATTRIBUTES = new Set(["detail"]);
const KNOWN_EDGE_FIELDS = new Set(["id", "edge_type", "from_node_id", "to_node_id", "direction", "evidence_refs", "resolution_status", "detail"]);

function classifyAttributeKey(key: string, supported: Set<string>, known: Set<string>): AttributeValueComparison["status"] {
  if (supported.has(key)) return "supported";
  if (known.has(key)) return "unsupported";
  return "unresolved";
}

function describeAttributeKey(key: string, status: AttributeValueComparison["status"], subject: "entity" | "relation"): string {
  switch (status) {
    case "supported":
      return `"${key}" is a supported ${subject} attribute.`;
    case "unsupported":
      return `"${key}" is a real ${subject} field but is not directly caller-assertable (it is identity or derived); this proposal's value for it is disclosed but was never applied.`;
    case "unresolved":
      return `"${key}" is not a recognized ${subject} field at all; this proposal's value for it is disclosed but was never applied.`;
  }
}

interface BaselineIndex {
  nodesById: Map<string, ObservedBaselineGraph["nodes"][number]>;
  edgesByTriple: Map<string, ObservedBaselineGraph["edges"][number]>;
}

function edgeTriple(fromId: string, edgeType: string, toId: string): string {
  return `${fromId}:${edgeType}:${toId}`;
}

function buildBaselineIndex(baseline: ObservedBaselineGraph): BaselineIndex {
  const nodesById = new Map(baseline.nodes.map((node) => [node.id, node]));
  const edgesByTriple = new Map(baseline.edges.map((edge) => [edgeTriple(edge.from_node_id, edge.edge_type, edge.to_node_id), edge]));
  return { nodesById, edgesByTriple };
}

/** Refs this proposal's own `add_entity` operations introduce, keyed by ref -- the only source `resolved_proposed` lookups may use (§5 of this milestone's boundary rules: never a guess at a `ProposedEntityRef` this proposal did not itself declare). */
function buildProposedIndex(operations: ProposalOperations): Map<string, { label: string; node_type: string }> {
  const index = new Map<string, { label: string; node_type: string }>();
  for (const operation of operations) {
    if (operation.kind === "add_entity") {
      index.set(operation.ref, { label: operation.label, node_type: operation.node_type });
    }
  }
  return index;
}

function lookupEntity(ref: string, baseline: BaselineIndex, proposed: Map<string, { label: string; node_type: string }>): EntityBaselineLookup {
  const baselineNode = baseline.nodesById.get(ref);
  if (baselineNode) {
    return { ref, source: "resolved_baseline", label: baselineNode.label, node_type: baselineNode.node_type };
  }
  const proposedNode = proposed.get(ref);
  if (proposedNode) {
    return { ref, source: "resolved_proposed", label: proposedNode.label, node_type: proposedNode.node_type };
  }
  return { ref, source: "unresolved" };
}

function nodeAttributeComparisons(attributes: Record<string, unknown>, before: ObservedBaselineGraph["nodes"][number] | undefined): AttributeValueComparison[] {
  return Object.keys(attributes)
    .sort()
    .map((key) => {
      const status = classifyAttributeKey(key, SUPPORTED_NODE_ATTRIBUTES, KNOWN_NODE_FIELDS);
      return {
        key,
        status,
        before: status === "supported" && before ? (before as unknown as Record<string, unknown>)[key] : undefined,
        after: attributes[key],
        detail: describeAttributeKey(key, status, "entity"),
      };
    });
}

function edgeAttributeComparisons(attributes: Record<string, unknown>, before: ObservedBaselineGraph["edges"][number] | undefined): AttributeValueComparison[] {
  return Object.keys(attributes)
    .sort()
    .map((key) => {
      const status = classifyAttributeKey(key, SUPPORTED_EDGE_ATTRIBUTES, KNOWN_EDGE_FIELDS);
      return {
        key,
        status,
        before: status === "supported" && before ? (before as unknown as Record<string, unknown>)[key] : undefined,
        after: attributes[key],
        detail: describeAttributeKey(key, status, "relation"),
      };
    });
}

export function buildDeltaOperationCards(proposalId: string, baseline: ObservedBaselineGraph, operations: ProposalOperations): DeltaOperationCard[] {
  const baselineIndex = buildBaselineIndex(baseline);
  const proposedIndex = buildProposedIndex(operations);

  return operations.map((operation, operationIndex): DeltaOperationCard => {
    const id = buildDeltaOperationCardId(proposalId, operationIndex, operation.kind);

    switch (operation.kind) {
      case "add_entity":
        return { kind: "add_entity", id, operation_index: operationIndex, ref: operation.ref, node_type: operation.node_type, label: operation.label };

      case "remove_entity":
        return {
          kind: "remove_entity",
          id,
          operation_index: operationIndex,
          subject: lookupEntity(operation.ref, baselineIndex, proposedIndex),
          detail: operation.detail,
        };

      case "modify_attributes": {
        const subject = lookupEntity(operation.ref, baselineIndex, proposedIndex);
        const before = baselineIndex.nodesById.get(operation.ref);
        return { kind: "modify_attributes", id, operation_index: operationIndex, subject, changes: nodeAttributeComparisons(operation.attributes, before) };
      }

      case "add_relation":
        return {
          kind: "add_relation",
          id,
          operation_index: operationIndex,
          from: lookupEntity(operation.from_ref, baselineIndex, proposedIndex),
          to: lookupEntity(operation.to_ref, baselineIndex, proposedIndex),
          edge_type: operation.edge_type,
          detail: operation.detail,
        };

      case "remove_relation":
        return {
          kind: "remove_relation",
          id,
          operation_index: operationIndex,
          from: lookupEntity(operation.from_ref, baselineIndex, proposedIndex),
          to: lookupEntity(operation.to_ref, baselineIndex, proposedIndex),
          edge_type: operation.edge_type,
          detail: operation.detail,
        };

      case "modify_relation": {
        const before = baselineIndex.edgesByTriple.get(edgeTriple(operation.from_ref, operation.edge_type, operation.to_ref));
        return {
          kind: "modify_relation",
          id,
          operation_index: operationIndex,
          from: lookupEntity(operation.from_ref, baselineIndex, proposedIndex),
          to: lookupEntity(operation.to_ref, baselineIndex, proposedIndex),
          edge_type: operation.edge_type,
          changes: edgeAttributeComparisons(operation.attributes, before),
        };
      }
    }
  });
}
