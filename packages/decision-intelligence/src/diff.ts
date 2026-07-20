// Snapshot-to-snapshot DecisionChangeSet diffing -- a Map<id, entity>-based
// pure diff, mirroring governance-intelligence's architecture-diff.ts shape:
// every decision id present in either snapshot gets exactly one DecisionChange
// entry (including "unchanged" ones, so a snapshot diffed against itself
// produces an entry per decision, all "unchanged" -- see
// no-change-identity.test.ts), classified via change-classification.ts.
//
// Conservative rename detection is gated behind the explicit `detectRenames`
// flag and never inferred from a single removal+addition pair: a candidate
// pair must corroborate on content_digest, source_type, AND authors before
// it is treated as one renamed decision (emitted as a single "modified"-or-
// better change under the target's new id) rather than as one "removed" and
// one unrelated "added" entry. contracts.ts's DecisionChangeType has no
// "renamed" variant (unlike governance's GovernanceChangeType), so a
// detected rename collapses into the ordinary modified/unchanged path.

import { assessDecisionSnapshotCompatibility } from "./compatibility.js";
import { classifyDecisionChange } from "./change-classification.js";
import type { ArchitectureDecision, DecisionChange, DecisionChangeSet, DecisionChangeType, DecisionSnapshot, EvidenceRef } from "./contracts.js";
import { DECISION_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildChangeId, buildChangeSetId } from "./ids.js";

export interface DiffDecisionsInput {
  source: DecisionSnapshot;
  target: DecisionSnapshot;
  generatedAt: string;
  /** Opt-in conservative rename detection; see file header. Defaults to false -- a rename is never assumed. */
  detectRenames?: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key]);
    return sorted;
  }
  return value;
}

function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const byKey = new Map<string, EvidenceRef>();
  for (const ref of refs) byKey.set(`${ref.source_artifact}:${ref.path}:${ref.lines ?? ""}`, ref);
  return [...byKey.values()].sort((a, b) => (a.path === b.path ? (a.lines ?? "").localeCompare(b.lines ?? "") : a.path.localeCompare(b.path)));
}

interface RenamePair {
  fromId: string;
  toId: string;
}

function detectRenamePairs(sourceById: Map<string, ArchitectureDecision>, targetById: Map<string, ArchitectureDecision>): RenamePair[] {
  const removedOnly = [...sourceById.keys()].filter((id) => !targetById.has(id)).sort();
  const addedOnly = [...targetById.keys()].filter((id) => !sourceById.has(id));
  const usedTargets = new Set<string>();
  const pairs: RenamePair[] = [];

  for (const fromId of removedOnly) {
    const s = sourceById.get(fromId)!;
    const toId = addedOnly.find((candidateId) => {
      if (usedTargets.has(candidateId)) return false;
      const t = targetById.get(candidateId)!;
      return t.source.content_digest === s.source.content_digest && t.source.source_type === s.source.source_type && sameValue(t.authors, s.authors);
    });
    if (toId) {
      usedTargets.add(toId);
      pairs.push({ fromId, toId });
    }
  }

  return pairs.sort((a, b) => a.fromId.localeCompare(b.fromId));
}

function isUnparseable(decision: ArchitectureDecision | undefined, unparseablePaths: Set<string>): boolean {
  return decision !== undefined && unparseablePaths.has(decision.source.repo_relative_path);
}

export function diffDecisions(input: DiffDecisionsInput): DecisionChangeSet {
  const { source, target } = input;
  const compatibility = assessDecisionSnapshotCompatibility(source, target);

  const sourceById = new Map(source.decisions.map((d) => [d.id, d]));
  const targetById = new Map(target.decisions.map((d) => [d.id, d]));
  const unparseableSourcePaths = new Set(source.source_issues.filter((i) => i.kind === "unparseable_structure").flatMap((i) => i.affected_paths));
  const unparseableTargetPaths = new Set(target.source_issues.filter((i) => i.kind === "unparseable_structure").flatMap((i) => i.affected_paths));

  const renamePairs = input.detectRenames ? detectRenamePairs(sourceById, targetById) : [];
  const renamedFromIds = new Set(renamePairs.map((p) => p.fromId));
  const renamedToIds = new Set(renamePairs.map((p) => p.toId));

  const changes: DecisionChange[] = [];

  for (const { fromId, toId } of renamePairs) {
    const s = sourceById.get(fromId)!;
    const t = targetById.get(toId)!;
    const unresolved = isUnparseable(s, unparseableSourcePaths) || isUnparseable(t, unparseableTargetPaths);
    const changeType: DecisionChangeType = unresolved ? "unresolved" : sameValue(s, { ...t, id: s.id }) ? "unchanged" : "modified";
    const classification = classifyDecisionChange(changeType, s, t);
    changes.push({
      id: buildChangeId(toId, changeType),
      decision_id: toId,
      change_type: changeType,
      classification,
      detail: `Decision "${fromId}" appears to have been renamed to "${toId}" (matching content digest, source type, and authors).`,
      evidence_refs: dedupeEvidenceRefs([...s.evidence_refs, ...t.evidence_refs]),
    });
  }

  const allIds = new Set([...sourceById.keys(), ...targetById.keys()]);
  for (const id of allIds) {
    if (renamedFromIds.has(id) || renamedToIds.has(id)) continue;
    const s = sourceById.get(id);
    const t = targetById.get(id);

    let changeType: DecisionChangeType;
    let detail: string;
    if (isUnparseable(s, unparseableSourcePaths) || isUnparseable(t, unparseableTargetPaths)) {
      changeType = "unresolved";
      detail = `Decision "${id}"'s document could not be parsed in at least one snapshot, so its change status is unresolved.`;
    } else if (!s && t) {
      changeType = "added";
      detail = `Decision "${id}" is new in the target snapshot.`;
    } else if (s && !t) {
      changeType = "removed";
      detail = `Decision "${id}" is present in the source snapshot but absent from the target snapshot.`;
    } else {
      changeType = sameValue(s, t) ? "unchanged" : "modified";
      detail = changeType === "unchanged" ? `Decision "${id}" is unchanged between snapshots.` : `Decision "${id}" changed between snapshots.`;
    }

    const classification = classifyDecisionChange(changeType, s, t);
    changes.push({
      id: buildChangeId(id, changeType),
      decision_id: id,
      change_type: changeType,
      classification,
      detail,
      evidence_refs: dedupeEvidenceRefs([...(s?.evidence_refs ?? []), ...(t?.evidence_refs ?? [])]),
    });
  }

  return {
    schema_version: DECISION_INTELLIGENCE_SCHEMA_VERSION,
    id: buildChangeSetId(source.id, target.id),
    generated_at: input.generatedAt,
    source_snapshot_id: source.id,
    target_snapshot_id: target.id,
    compatibility,
    changes: changes.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
