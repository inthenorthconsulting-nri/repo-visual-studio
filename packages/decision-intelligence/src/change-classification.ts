// The single shared rule set diff.ts calls to populate DecisionChange.
// classification, so editorial/metadata/material/governance_relevant is
// derived by ONE deterministic rule set rather than duplicated logic.
//
// A wording-only change with unchanged normalized semantics is never
// "material" (spec §34, adversarially tested): only a change to a field
// that itself changes what the decision *means* (its status axes, scope, or
// supersession edges) is material. A change to governance_status alone
// (populated only once governance-links.ts runs) is "governance_relevant",
// distinct from material since it reflects governance's own re-evaluation,
// not a change the decision's author made. Author/date/evidence-ref-only
// changes are "metadata". Everything else observable as a field diff
// (title/context/decision_text wording) is "editorial".

import type { ArchitectureDecision, DecisionChangeClassification, DecisionChangeType } from "./contracts.js";

const MATERIAL_FIELDS = new Set<keyof ArchitectureDecision>(["decision_status", "implementation_status", "scope", "supersedes", "superseded_by"]);
const GOVERNANCE_FIELDS = new Set<keyof ArchitectureDecision>(["governance_status"]);
const METADATA_FIELDS = new Set<keyof ArchitectureDecision>(["authors", "date", "evidence_refs"]);

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedFields(source: ArchitectureDecision, target: ArchitectureDecision): Set<keyof ArchitectureDecision> {
  const fields: (keyof ArchitectureDecision)[] = ["title", "decision_status", "implementation_status", "governance_status", "scope", "context", "decision_text", "authors", "date", "supersedes", "superseded_by", "evidence_refs"];
  const changed = new Set<keyof ArchitectureDecision>();
  for (const field of fields) {
    if (!sameValue(source[field], target[field])) changed.add(field);
  }
  return changed;
}

export function classifyDecisionChange(changeType: DecisionChangeType, source: ArchitectureDecision | undefined, target: ArchitectureDecision | undefined): DecisionChangeClassification {
  if (changeType === "unresolved") return "unresolved";
  if (changeType === "added" || changeType === "removed") return "material";
  if (changeType === "unchanged") return "editorial";

  if (!source || !target) return "unresolved";
  const changed = changedFields(source, target);

  for (const field of changed) if (MATERIAL_FIELDS.has(field)) return "material";
  for (const field of changed) if (GOVERNANCE_FIELDS.has(field)) return "governance_relevant";
  for (const field of changed) if (METADATA_FIELDS.has(field)) return "metadata";
  return "editorial";
}
