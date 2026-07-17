import type { ArchitectureIntelligence, ConfidenceSummary, EvidenceReference, InferenceClass, InferredStatement } from "./types.js";

export function confirmed<T = string>(value: T, evidence: EvidenceReference[], rationale?: string): InferredStatement<T> {
  return { value, inference: "confirmed", evidence, rationale };
}

export function derived<T = string>(value: T, evidence: EvidenceReference[], rationale: string): InferredStatement<T> {
  return { value, inference: "derived", evidence, rationale };
}

export function suggested<T = string>(value: T, evidence: EvidenceReference[], rationale: string): InferredStatement<T> {
  return { value, inference: "suggested", evidence, rationale };
}

export function unresolved<T = string>(value: T, rationale: string): InferredStatement<T> {
  return { value, inference: "unresolved", evidence: [], rationale };
}

/** Walks an ArchitectureIntelligence-shaped object tree collecting every InferredStatement it contains, in deterministic order. */
export function collectStatements(model: Omit<ArchitectureIntelligence, "questions" | "metadata">): Array<InferredStatement<unknown>> {
  const statements: Array<InferredStatement<unknown>> = [];
  statements.push(model.identity.oneLineDescription, model.purpose.problemStatement, ...model.purpose.targetUsers, ...model.purpose.scopeBoundaries);
  for (const r of model.responsibilities) statements.push(r.description);
  for (const d of model.capabilityDomains) statements.push(d.summary);
  for (const c of model.components) statements.push(c.description);
  for (const a of model.actors) statements.push(a.description);
  for (const e of model.externalSystems) statements.push(e.description);
  for (const f of model.flows) statements.push(f.description);
  for (const b of model.boundaries) statements.push(b.description);
  for (const o of model.outcomes) statements.push(o.statement);
  for (const r of model.risks) statements.push(r.description);
  for (const dep of model.dependencies) statements.push(dep.description);
  for (const w of model.workflowFamilies) statements.push(w.description);
  statements.push(...model.operatingModel.deploymentEnvironments, ...model.operatingModel.releaseProcess, ...model.operatingModel.observability, ...model.operatingModel.approvalGates);
  return statements;
}

/** Walks an ArchitectureIntelligence-shaped object tree collecting every InferredStatement's inference class. */
export function summarizeConfidence(statements: Array<{ inference: InferenceClass }>): ConfidenceSummary {
  const summary: ConfidenceSummary = { confirmed: 0, derived: 0, suggested: 0, unresolved: 0, total: 0 };
  for (const statement of statements) {
    summary[statement.inference] += 1;
    summary.total += 1;
  }
  return summary;
}

/**
 * Level 1 (Executive) and Level 2 (Architecture) narration must never present
 * a suggested/unresolved statement as bare fact. Use this to decide whether a
 * statement is safe to render without a qualifier at those levels.
 */
export function isPresentableAsFact(inference: InferenceClass): boolean {
  return inference === "confirmed" || inference === "derived";
}

/** Renders a qualifier prefix for suggested/unresolved statements so Level 1/2 text never silently states them as fact. */
export function qualifierFor(inference: InferenceClass): string | undefined {
  if (inference === "suggested") return "Likely";
  if (inference === "unresolved") return "Unconfirmed";
  return undefined;
}
