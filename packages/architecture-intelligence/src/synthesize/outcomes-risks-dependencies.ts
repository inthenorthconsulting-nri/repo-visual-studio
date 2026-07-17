import type { RepositoryModel } from "@rvs/repository-model";
import { validateGraphStructure, type WorkflowGraph } from "@rvs/workflow-graph";
import { validateTerraformTopologyStructure, type TerraformTopology } from "@rvs/terraform-graph";
import { derived } from "../inference.js";
import { dependencyId, outcomeId, riskId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { ArchitectureDependency, ArchitectureOutcome, ArchitectureRisk, CapabilityDomain, OperatingModel } from "../types.js";

/** Qualitative only: an outcome statement is derived from the presence of a capability domain or operating-model control, never a fabricated number. */
export function buildOutcomes(domains: CapabilityDomain[], operatingModel: OperatingModel): ArchitectureOutcome[] {
  const outcomes: ArchitectureOutcome[] = [];

  for (const domain of domains) {
    if (domain.workflowFamilyIds.length === 0) continue; // infrastructure domain covered separately below
    const statement = `${domain.label.displayLabel} is automated rather than performed manually.`;
    outcomes.push({
      id: outcomeId(statement),
      statement: derived(statement, domain.summary.evidence, `Derived from the "${domain.label.displayLabel}" capability domain.`),
    });
  }

  if (operatingModel.approvalGates.some((s) => s.inference === "confirmed")) {
    const statement = "Changes pass through a review or approval gate before taking effect.";
    outcomes.push({
      id: outcomeId(statement),
      statement: derived(statement, operatingModel.approvalGates.flatMap((s) => s.evidence), "Derived from confirmed approval-gate statements in the operating model."),
    });
  }

  return outcomes;
}

const SEVERITY_BY_WARNING: Record<string, "low" | "medium" | "high"> = {
  error: "high",
  warning: "medium",
  informational: "low",
};

/** Every risk traces back to a real structural-validator warning re-derived from the source WorkflowGraph/TerraformTopology — never an invented concern. */
export function buildRisks(graphs: WorkflowGraph[], topologies: TerraformTopology[]): ArchitectureRisk[] {
  const risks: ArchitectureRisk[] = [];

  for (const graph of [...graphs].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const warning of validateGraphStructure(graph)) {
      if (warning.severity !== "error" && warning.code !== "WORKFLOW_DYNAMIC_EXPRESSION" && warning.code !== "WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED") continue;
      risks.push({
        id: riskId(`${warning.code}:${warning.sourcePath}`),
        label: normalizeLabel(warning.code.replace(/^WORKFLOW_/, "").replace(/_/g, " ")),
        severity: SEVERITY_BY_WARNING[warning.severity] ?? "medium",
        description: derived(warning.message, warning.evidence ? [warning.evidence] : [{ path: warning.sourcePath }], `Derived from validator warning ${warning.code}.`),
        relatedComponentIds: [],
      });
    }
  }

  for (const topology of [...topologies].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const warning of validateTerraformTopologyStructure(topology)) {
      if (warning.severity === "informational") continue;
      risks.push({
        id: riskId(`${warning.code}:${warning.sourcePath}`),
        label: normalizeLabel(warning.code.replace(/^TERRAFORM_/, "").replace(/_/g, " ")),
        severity: SEVERITY_BY_WARNING[warning.severity] ?? "medium",
        description: derived(warning.message, [{ path: warning.sourcePath, lines: warning.lines }], `Derived from validator warning ${warning.code}.`),
        relatedComponentIds: [],
      });
    }
  }

  return risks;
}

export function buildDependencies(model: RepositoryModel): ArchitectureDependency[] {
  const deps: ArchitectureDependency[] = [];
  const manifestEvidence = model.tech_stack.manifestFile ? [{ path: model.tech_stack.manifestFile }] : [];

  for (const framework of model.tech_stack.frameworks) {
    deps.push({
      id: dependencyId("runtime", framework),
      label: normalizeLabel(framework),
      kind: "runtime",
      description: derived(`Uses ${framework} as a runtime/framework dependency.`, manifestEvidence, `Detected via manifest keyword scan of ${model.tech_stack.manifestFile ?? "the project manifest"}.`),
      evidence: manifestEvidence,
    });
  }

  for (const manager of model.tech_stack.packageManagers) {
    deps.push({
      id: dependencyId("build", manager),
      label: normalizeLabel(manager),
      kind: "build",
      description: derived(`Uses ${manager} for dependency/build management.`, manifestEvidence, "Detected via package-manager manifest presence."),
      evidence: manifestEvidence,
    });
  }

  return deps;
}
