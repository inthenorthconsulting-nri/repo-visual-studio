// Proposal completeness validation (§ valid_sufficient/valid_partial/
// unresolved/invalid) and security/conflict validation, combined: both
// passes classify the same `ProposedChangeSet`, and a security/conflict
// finding is always blocking (folds into `invalid`), never merely
// downgrading to `valid_partial`.
//
// Every grouping below sorts operations by a canonical string key BEFORE
// comparing them, so conflict/duplicate detection is provably independent
// of the input array's order -- the same set of operations in any shuffled
// order produces byte-identical validation results (exercised by the
// determinism/shuffle-invariance tests in __tests__/determinism.test.ts).

import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { ProposalOperation, ProposalValidationIssue, ProposalValidationResult, ProposedChangeSet } from "./contracts.js";
import { classifyEdgeAttributes, classifyNodeAttributes } from "./attribute-support.js";
import { canonicalize, digestOf } from "./ids.js";
import { isWellFormedRefString } from "./refs.js";

export interface ValidationContext {
  confirmedNodes?: readonly KnowledgeNode[];
  confirmedEdges?: readonly KnowledgeEdge[];
}

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function validateProposedChangeSet(changeSet: ProposedChangeSet, context: ValidationContext = {}): ProposalValidationResult {
  const issues: ProposalValidationIssue[] = [];

  changeSet.operations.forEach((operation, index) => {
    issues.push(...validateOperationShape(operation, index, changeSet, context));
  });

  issues.push(...detectConflicts(changeSet.operations));

  const hasBlocking = issues.some((issue) => issue.blocking);
  const hasUnresolved = issues.some((issue) => !issue.blocking && issue.code.startsWith("unresolved_"));
  const hasNonBlocking = issues.length > 0 && !hasBlocking;

  const status: ProposalValidationResult["status"] = hasBlocking ? "invalid" : hasUnresolved ? "unresolved" : hasNonBlocking ? "valid_partial" : "valid_sufficient";

  return { status, issues: sortIssues(issues) };
}

function sortIssues(issues: ProposalValidationIssue[]): ProposalValidationIssue[] {
  return [...issues].sort((a, b) => a.operation_index - b.operation_index || a.code.localeCompare(b.code) || a.detail.localeCompare(b.detail));
}

function validateOperationShape(operation: ProposalOperation, index: number, changeSet: ProposedChangeSet, context: ValidationContext): ProposalValidationIssue[] {
  const issues: ProposalValidationIssue[] = [];

  const refsToCheck: string[] = [];
  switch (operation.kind) {
    case "add_entity":
      refsToCheck.push(operation.ref);
      if (operation.repository_id !== changeSet.repository_id) {
        issues.push({
          code: "repository_id_mismatch",
          operation_index: index,
          detail: `add_entity's repository_id "${operation.repository_id}" does not match the proposal's repository_id "${changeSet.repository_id}".`,
          blocking: true,
        });
      }
      if (!operation.node_type || !operation.source_artifact || !operation.proposed_source_entity_id || !operation.label) {
        issues.push({ code: "invalid_add_entity_shape", operation_index: index, detail: "add_entity is missing a required field (node_type/source_artifact/proposed_source_entity_id/label).", blocking: true });
      }
      issues.push(...attributeIssues(operation.attributes ?? {}, index, "node"));
      issues.push(...evidenceRefIssues(operation.evidence_refs ?? [], index));
      break;
    case "remove_entity":
      refsToCheck.push(operation.ref);
      issues.push(...confirmedRefIssue(operation.ref, index, "remove_entity ref", context));
      break;
    case "modify_attributes":
      refsToCheck.push(operation.ref);
      issues.push(...confirmedRefIssue(operation.ref, index, "modify_attributes ref", context));
      issues.push(...attributeIssues(operation.attributes, index, "node"));
      break;
    case "add_relation":
      refsToCheck.push(operation.from_ref, operation.to_ref);
      issues.push(...evidenceRefIssues(operation.evidence_refs ?? [], index));
      break;
    case "remove_relation":
      refsToCheck.push(operation.from_ref, operation.to_ref);
      issues.push(...confirmedRefIssue(operation.from_ref, index, "remove_relation from_ref", context));
      issues.push(...confirmedRefIssue(operation.to_ref, index, "remove_relation to_ref", context));
      break;
    case "modify_relation":
      refsToCheck.push(operation.from_ref, operation.to_ref);
      issues.push(...confirmedRefIssue(operation.from_ref, index, "modify_relation from_ref", context));
      issues.push(...confirmedRefIssue(operation.to_ref, index, "modify_relation to_ref", context));
      issues.push(...attributeIssues(operation.attributes, index, "edge"));
      break;
  }

  for (const ref of refsToCheck) {
    if (!isWellFormedRefString(ref)) {
      issues.push({ code: "malformed_ref", operation_index: index, detail: `Ref "${ref}" is malformed (path-traversal, whitespace, or prototype-pollution-shaped).`, blocking: true });
    }
  }

  return issues;
}

function confirmedRefIssue(ref: string, index: number, label: string, context: ValidationContext): ProposalValidationIssue[] {
  if (!context.confirmedNodes) {
    return [{ code: "unresolved_confirmation_context", operation_index: index, detail: `${label} "${ref}" could not be confirmed: no observed-graph context was supplied to validation.`, blocking: false }];
  }
  const found = context.confirmedNodes.some((node) => node.id === ref);
  if (!found) {
    return [{ code: "unresolved_ref_not_found", operation_index: index, detail: `${label} "${ref}" does not match any confirmed entity in the observed graph.`, blocking: false }];
  }
  return [];
}

function attributeIssues(attributes: Record<string, unknown>, index: number, subject: "node" | "edge"): ProposalValidationIssue[] {
  const issues: ProposalValidationIssue[] = [];
  for (const key of Object.keys(attributes)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
      issues.push({ code: "prototype_pollution_shaped_key", operation_index: index, detail: `Attribute key "${key}" is prototype-pollution-shaped and is rejected outright.`, blocking: true });
    }
  }
  const findings = subject === "node" ? classifyNodeAttributes(attributes) : classifyEdgeAttributes(attributes);
  for (const finding of findings) {
    if (finding.status !== "supported" && !PROTOTYPE_POLLUTION_KEYS.has(finding.key)) {
      issues.push({ code: `attribute_${finding.status}`, operation_index: index, detail: finding.detail, blocking: false });
    }
  }
  return issues;
}

function evidenceRefIssues(evidenceRefs: Array<{ path?: string }>, index: number): ProposalValidationIssue[] {
  const issues: ProposalValidationIssue[] = [];
  for (const ref of evidenceRefs) {
    if (typeof ref.path === "string" && (ref.path.includes("..") || ref.path.startsWith("/"))) {
      issues.push({ code: "path_containment_violation", operation_index: index, detail: `Evidence path "${ref.path}" escapes the repository root or is absolute.`, blocking: true });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Conflict detection -- grouped by a canonical key, sorted before comparison
// ---------------------------------------------------------------------------

function operationKey(operation: ProposalOperation): string {
  switch (operation.kind) {
    case "add_entity":
      return `add_entity:${operation.ref}`;
    case "remove_entity":
      return `remove_entity:${operation.ref}`;
    case "modify_attributes":
      return `modify_attributes:${operation.ref}`;
    case "add_relation":
      return `add_relation:${operation.from_ref}:${operation.edge_type}:${operation.to_ref}`;
    case "remove_relation":
      return `remove_relation:${operation.from_ref}:${operation.edge_type}:${operation.to_ref}`;
    case "modify_relation":
      return `modify_relation:${operation.from_ref}:${operation.edge_type}:${operation.to_ref}`;
  }
}

function relationTriple(operation: ProposalOperation): string | undefined {
  if (operation.kind === "add_relation" || operation.kind === "remove_relation" || operation.kind === "modify_relation") {
    return `${operation.from_ref}:${operation.edge_type}:${operation.to_ref}`;
  }
  return undefined;
}

function detectConflicts(operations: ProposalOperation[]): ProposalValidationIssue[] {
  const issues: ProposalValidationIssue[] = [];
  const indexed = operations.map((operation, index) => ({ operation, index, key: operationKey(operation) }));
  const sorted = [...indexed].sort((a, b) => a.key.localeCompare(b.key) || a.index - b.index);

  // Duplicate add_entity / conflicting modify_attributes on the same ref.
  const byRef = new Map<string, typeof sorted>();
  for (const entry of sorted) {
    if (entry.operation.kind === "add_entity" || entry.operation.kind === "remove_entity" || entry.operation.kind === "modify_attributes") {
      const list = byRef.get(entry.operation.ref) ?? [];
      list.push(entry);
      byRef.set(entry.operation.ref, list);
    }
  }
  for (const [ref, entries] of [...byRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const adds = entries.filter((e) => e.operation.kind === "add_entity");
    if (adds.length > 1) {
      const distinctDigests = new Set(adds.map((e) => digestOf(canonicalize(e.operation))));
      if (distinctDigests.size > 1) {
        for (const entry of adds) {
          issues.push({ code: "conflicting_duplicate_add_entity", operation_index: entry.index, detail: `Multiple add_entity operations target ref "${ref}" with differing content -- ambiguous identity.`, blocking: true });
        }
      }
    }
    const removes = entries.filter((e) => e.operation.kind === "remove_entity");
    const modifies = entries.filter((e) => e.operation.kind === "modify_attributes");
    if (removes.length > 0 && modifies.length > 0) {
      for (const entry of modifies) {
        issues.push({ code: "modify_superseded_by_remove", operation_index: entry.index, detail: `modify_attributes on ref "${ref}" is superseded by a remove_entity on the same ref (removal takes deterministic precedence).`, blocking: false });
      }
    }
    if (modifies.length > 1) {
      const keysToValues = new Map<string, Set<string>>();
      for (const entry of modifies) {
        const attrs = (entry.operation as { attributes: Record<string, unknown> }).attributes;
        for (const [key, value] of Object.entries(attrs)) {
          const set = keysToValues.get(key) ?? new Set<string>();
          set.add(JSON.stringify(value));
          keysToValues.set(key, set);
        }
      }
      for (const [key, values] of keysToValues) {
        if (values.size > 1) {
          for (const entry of modifies) {
            issues.push({ code: "conflicting_modify_attributes", operation_index: entry.index, detail: `Multiple modify_attributes operations on ref "${ref}" assert different values for "${key}".`, blocking: true });
          }
        }
      }
    }
  }

  // add_relation directly contradicted by remove_relation for the same triple.
  const byTriple = new Map<string, typeof sorted>();
  for (const entry of sorted) {
    const triple = relationTriple(entry.operation);
    if (!triple) continue;
    const list = byTriple.get(triple) ?? [];
    list.push(entry);
    byTriple.set(triple, list);
  }
  for (const [triple, entries] of [...byTriple.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hasAdd = entries.some((e) => e.operation.kind === "add_relation");
    const hasRemove = entries.some((e) => e.operation.kind === "remove_relation");
    if (hasAdd && hasRemove) {
      for (const entry of entries) {
        issues.push({ code: "contradictory_relation_operations", operation_index: entry.index, detail: `Relation "${triple}" is both added and removed by this proposal -- direct contradiction.`, blocking: true });
      }
    }
  }

  // remove_entity A + (add_relation | modify_relation) touching A as
  // from_ref/to_ref: this proposal contains enough information, entirely on
  // its own, to know it is contradictory -- it both asserts A is gone and
  // asserts a relation must be added/modified against A. That is an
  // internally contradictory proposal, distinct from a genuinely unresolved
  // external/missing reference (a ref simply never confirmed at all, which
  // remains a non-blocking "unresolved_*" condition surfaced later by
  // overlay.ts when it is attempted). Detected here, before overlay
  // construction is ever attempted, so it folds into `invalid` rather than
  // silently passing validation and only degrading at the overlay layer.
  // remove_relation touching A is deliberately NOT flagged here: removing a
  // relation that touches an entity this same proposal also removes is
  // consistent (redundant, even), not contradictory.
  const removeEntityEntries = sorted.filter((entry) => entry.operation.kind === "remove_entity");
  if (removeEntityEntries.length > 0) {
    const removedRefs = new Set(removeEntityEntries.map((entry) => (entry.operation as { ref: string }).ref));
    const relationEntriesByRemovedRef = new Map<string, typeof sorted>();
    for (const entry of sorted) {
      if (entry.operation.kind !== "add_relation" && entry.operation.kind !== "modify_relation") continue;
      const op = entry.operation as { from_ref: string; to_ref: string };
      for (const ref of [...new Set([op.from_ref, op.to_ref])].filter((candidate) => removedRefs.has(candidate))) {
        const list = relationEntriesByRemovedRef.get(ref) ?? [];
        list.push(entry);
        relationEntriesByRemovedRef.set(ref, list);
      }
    }
    for (const [ref, relationEntries] of [...relationEntriesByRemovedRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const entry of relationEntries) {
        issues.push({
          code: "relation_from_removed_entity",
          operation_index: entry.index,
          detail: `${entry.operation.kind} references ref "${ref}", but this same proposal also removes that entity via remove_entity -- internally contradictory (a relation cannot be added or modified against an entity this proposal removes).`,
          blocking: true,
        });
      }
      for (const entry of removeEntityEntries.filter((candidate) => (candidate.operation as { ref: string }).ref === ref)) {
        issues.push({
          code: "relation_from_removed_entity",
          operation_index: entry.index,
          detail: `remove_entity targets ref "${ref}", but this same proposal also adds or modifies a relation referencing that same ref -- internally contradictory.`,
          blocking: true,
        });
      }
    }
  }

  return issues;
}
