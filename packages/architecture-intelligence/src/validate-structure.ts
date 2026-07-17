import type { ArchIntelWarning, ArchitectureIntelligence } from "./types.js";

/**
 * Pure structural checks over an already-synthesized ArchitectureIntelligence
 * — no rendering, no layout. Mirrors validateGraphStructure /
 * validateTerraformTopologyStructure in the sibling graph packages.
 */
export function validateArchitectureIntelligenceStructure(model: ArchitectureIntelligence): ArchIntelWarning[] {
  const warnings: ArchIntelWarning[] = [];

  const seenIds = new Map<string, number>();
  const allIds: string[] = [
    model.identity.id,
    ...model.responsibilities.map((r) => r.id),
    ...model.capabilityDomains.map((d) => d.id),
    ...model.components.map((c) => c.id),
    ...model.actors.map((a) => a.id),
    ...model.externalSystems.map((e) => e.id),
    ...model.flows.map((f) => f.id),
    ...model.boundaries.map((b) => b.id),
    ...model.outcomes.map((o) => o.id),
    ...model.risks.map((r) => r.id),
    ...model.dependencies.map((d) => d.id),
    ...model.workflowFamilies.map((w) => w.id),
  ];
  for (const id of allIds) seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
  for (const [id, count] of seenIds) {
    if (count > 1) {
      warnings.push({
        code: "ARCH_INTEL_DUPLICATE_ID",
        severity: "error",
        message: `Entity id "${id}" is used ${count} times across the architecture intelligence model.`,
        relatedId: id,
        remediation: "Ensure every synthesized entity has a unique, deterministically-derived id.",
      });
    }
  }

  if (model.components.length === 0) {
    warnings.push({
      code: "ARCH_INTEL_NO_COMPONENTS",
      severity: "warning",
      message: "No logical components were synthesized from repository, workflow, or Terraform evidence.",
      remediation: "Run `rvs create workflow`/`rvs create topology` before `rvs synthesize architecture`, or verify the repository has scannable source files.",
    });
  }

  if (model.identity.oneLineDescription.inference === "unresolved") {
    warnings.push({
      code: "ARCH_INTEL_NO_PURPOSE_EVIDENCE",
      severity: "warning",
      message: "No README lead paragraph was found to synthesize a system purpose statement.",
      relatedId: model.identity.id,
      remediation: "Add a lead paragraph to README.md describing what the system does.",
    });
  }

  for (const component of model.components) {
    if (component.evidence.length === 0 && component.kind !== "workflow-automation") {
      warnings.push({
        code: "ARCH_INTEL_COMPONENT_MISSING_EVIDENCE",
        severity: "warning",
        message: `Component "${component.label.displayLabel}" has no evidence references.`,
        relatedId: component.id,
      });
    }
  }

  const knownEntityIds = new Set(allIds);
  for (const flow of model.flows) {
    if (!knownEntityIds.has(flow.fromId) || !knownEntityIds.has(flow.toId)) {
      warnings.push({
        code: "ARCH_INTEL_DANGLING_FLOW",
        severity: "error",
        message: `Flow "${flow.label.displayLabel}" references an entity id that does not exist in the model (from="${flow.fromId}", to="${flow.toId}").`,
        relatedId: flow.id,
      });
    }
  }

  for (const domain of model.capabilityDomains) {
    if (domain.responsibilityIds.length === 0 && domain.componentIds.length === 0 && domain.workflowFamilyIds.length === 0) {
      warnings.push({
        code: "ARCH_INTEL_EMPTY_CAPABILITY_DOMAIN",
        severity: "warning",
        message: `Capability domain "${domain.label.displayLabel}" has no responsibilities, components, or workflow families attached.`,
        relatedId: domain.id,
      });
    }
  }

  for (const family of model.workflowFamilies) {
    if (family.workflowGraphIds.length === 0) {
      warnings.push({
        code: "ARCH_INTEL_WORKFLOW_FAMILY_EMPTY",
        severity: "warning",
        message: `Workflow family "${family.label.displayLabel}" contains no workflows.`,
        relatedId: family.id,
      });
    }
  }

  for (const outcome of model.outcomes) {
    if (outcome.quantified && outcome.quantified.evidence.length === 0) {
      warnings.push({
        code: "ARCH_INTEL_QUANTIFIED_OUTCOME_MISSING_EVIDENCE",
        severity: "error",
        message: `Outcome "${outcome.id}" states a quantified metric ("${outcome.quantified.metric}") without evidence.`,
        relatedId: outcome.id,
        remediation: "Remove the quantified metric or attach a real EvidenceReference to its source.",
      });
    }
  }

  if (model.metadata.confidence.total > 0) {
    const unresolvedRatio = model.metadata.confidence.unresolved / model.metadata.confidence.total;
    if (unresolvedRatio > 0.5) {
      warnings.push({
        code: "ARCH_INTEL_LOW_OVERALL_CONFIDENCE",
        severity: "warning",
        message: `${Math.round(unresolvedRatio * 100)}% of synthesized statements are unresolved — this repository may lack enough documentation/evidence for a confident narrative.`,
      });
    }
  }

  if (model.identity.name.basis !== "readme-title") {
    warnings.push({
      code: "ARCH_INTEL_GENERIC_SYSTEM_NAME",
      severity: "informational",
      message: `System name "${model.identity.name.displayLabel}" falls back to the raw repository slug — no distinctive README title or other product-name evidence was found.`,
      relatedId: model.identity.id,
      remediation: "Add a distinctive H1 title to README.md if the system has a product name different from its repository slug.",
    });
  }

  // A rollup that isn't collapsing families anymore (or a repository with an
  // unusually wide spread of automation) reads as a directory listing again,
  // not an architecture — the coarser 5-7 domain grouping this pass adds is
  // only useful if it's actually coarser.
  if (model.capabilityDomains.length > 8) {
    warnings.push({
      code: "ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR",
      severity: "warning",
      message: `${model.capabilityDomains.length} capability domains were synthesized — a capability map this granular reads as a workflow-classification list, not a business-capability overview.`,
      remediation: "Extend the capability-domain rollup so more workflow families group under shared, broader domain labels.",
    });
  }

  for (const family of model.workflowFamilies) {
    if (family.workflowGraphIds.length > 0 && !family.representativeWorkflowGraphId) {
      warnings.push({
        code: "ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE",
        severity: "warning",
        message: `Workflow family "${family.label.displayLabel}" has workflows but no representative workflow was selected for supplementary detail scenes.`,
        relatedId: family.id,
      });
    }
  }

  return warnings;
}
