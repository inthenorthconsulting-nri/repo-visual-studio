import { questionId } from "../ids.js";
import type { ArchitectureIntelligence, ArchitectureQuestion, InferredStatement } from "../types.js";

interface Candidate {
  entityId: string;
  entityLabel: string;
  statement: InferredStatement<unknown>;
}

function collectStatements(model: Omit<ArchitectureIntelligence, "questions" | "metadata">): Candidate[] {
  const candidates: Candidate[] = [];

  candidates.push({ entityId: model.identity.id, entityLabel: model.identity.name.displayLabel, statement: model.identity.oneLineDescription });
  candidates.push({ entityId: model.identity.id, entityLabel: model.identity.name.displayLabel, statement: model.purpose.problemStatement });
  for (const s of model.purpose.targetUsers) candidates.push({ entityId: model.identity.id, entityLabel: model.identity.name.displayLabel, statement: s });
  for (const s of model.purpose.scopeBoundaries) candidates.push({ entityId: model.identity.id, entityLabel: model.identity.name.displayLabel, statement: s });

  for (const r of model.responsibilities) candidates.push({ entityId: r.id, entityLabel: r.label.displayLabel, statement: r.description });
  for (const d of model.capabilityDomains) candidates.push({ entityId: d.id, entityLabel: d.label.displayLabel, statement: d.summary });
  for (const c of model.components) candidates.push({ entityId: c.id, entityLabel: c.label.displayLabel, statement: c.description });
  for (const a of model.actors) candidates.push({ entityId: a.id, entityLabel: a.label.displayLabel, statement: a.description });
  for (const e of model.externalSystems) candidates.push({ entityId: e.id, entityLabel: e.label.displayLabel, statement: e.description });
  for (const f of model.flows) candidates.push({ entityId: f.id, entityLabel: f.label.displayLabel, statement: f.description });
  for (const b of model.boundaries) candidates.push({ entityId: b.id, entityLabel: b.label.displayLabel, statement: b.description });
  for (const o of model.outcomes) candidates.push({ entityId: o.id, entityLabel: o.id, statement: o.statement });
  for (const r of model.risks) candidates.push({ entityId: r.id, entityLabel: r.label.displayLabel, statement: r.description });
  for (const dep of model.dependencies) candidates.push({ entityId: dep.id, entityLabel: dep.label.displayLabel, statement: dep.description });
  for (const s of model.operatingModel.deploymentEnvironments) candidates.push({ entityId: "operating-model", entityLabel: "Operating model", statement: s });
  for (const s of model.operatingModel.releaseProcess) candidates.push({ entityId: "operating-model", entityLabel: "Operating model", statement: s });
  for (const s of model.operatingModel.observability) candidates.push({ entityId: "operating-model", entityLabel: "Operating model", statement: s });
  for (const s of model.operatingModel.approvalGates) candidates.push({ entityId: "operating-model", entityLabel: "Operating model", statement: s });
  for (const w of model.workflowFamilies) candidates.push({ entityId: w.id, entityLabel: w.label.displayLabel, statement: w.description });

  return candidates;
}

/** Every "suggested" or "unresolved" statement in the model becomes a visible open question — nothing weak is allowed to disappear silently. */
export function buildQuestions(model: Omit<ArchitectureIntelligence, "questions" | "metadata">): ArchitectureQuestion[] {
  const questions: ArchitectureQuestion[] = [];
  for (const candidate of collectStatements(model)) {
    if (candidate.statement.inference === "suggested") {
      questions.push({
        id: questionId("suggested-claim", candidate.entityId),
        question: `Is it accurate that ${candidate.entityLabel}: "${String(candidate.statement.value)}"?`,
        relatedEntityIds: [candidate.entityId],
        reason: "suggested-claim",
      });
    } else if (candidate.statement.inference === "unresolved") {
      questions.push({
        id: questionId("unresolved-claim", candidate.entityId),
        question: `What is ${candidate.entityLabel}'s ${candidate.statement.rationale ? candidate.statement.rationale.toLowerCase() : "status"}?`,
        relatedEntityIds: [candidate.entityId],
        reason: "unresolved-claim",
      });
    }
  }
  return questions;
}
