import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed, derived } from "../inference.js";
import { capabilityDomainId, responsibilityId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { CapabilityDomain, LogicalComponent, Responsibility, ResponsibilityKind, WorkflowFamily } from "../types.js";

// Rolls the workflow-family classification (fine-grained, ~10-11 families —
// see workflow-families.ts FAMILY_RULES) up into a coarser set of ~6-7
// capability domains for narrative presentation. A reader scanning a
// capability-map slide wants "what does this platform do", not one card per
// workflow-classification bucket. Generic, GitHub-Actions-vocabulary-level
// groupings — not specific to any one repository's business domain. A family
// label with no entry here stays its own standalone domain rather than being
// dropped, so this degrades safely if FAMILY_RULES changes.
const CAPABILITY_DOMAIN_ROLLUP: Record<string, string> = {
  Governance: "Governance and approval",
  "Review and approval": "Governance and approval",
  "Identity and access": "Identity and access governance",
  Credentials: "Identity and access governance",
  Onboarding: "Migration and enablement",
  Migration: "Migration and enablement",
  Diagnostics: "Operational diagnostics",
  Observability: "Operational diagnostics",
  "Query and PDT management": "Query and data reliability",
  "Release and maintenance": "Release and maintenance",
  "Other automation": "General automation",
};

function rollupDomainLabel(familySourceLabel: string): string {
  return CAPABILITY_DOMAIN_ROLLUP[familySourceLabel] ?? familySourceLabel;
}

const FAMILY_TO_RESPONSIBILITY_KIND: Record<string, ResponsibilityKind> = {
  Governance: "governance",
  "Identity and access": "security",
  Onboarding: "operations",
  Diagnostics: "operations",
  Observability: "operations",
  Migration: "data",
  Credentials: "security",
  "Review and approval": "governance",
  "Query and PDT management": "data",
  "Release and maintenance": "operations",
  "Other automation": "automation",
};

const CATEGORY_TO_RESPONSIBILITY_KIND: Record<string, ResponsibilityKind> = {
  compute: "infrastructure",
  network: "infrastructure",
  storage: "data",
  database: "data",
  analytics: "data",
  identity: "security",
  security: "security",
  messaging: "integration",
  integration: "integration",
  observability: "operations",
};

export function buildResponsibilitiesFromWorkflowFamilies(families: WorkflowFamily[]): Responsibility[] {
  return families.map((family) => {
    const kind = FAMILY_TO_RESPONSIBILITY_KIND[family.label.sourceLabel] ?? "unknown";
    return {
      id: responsibilityId(family.label.sourceLabel),
      label: family.label,
      kind,
      description: derived(`Responsible for ${family.label.displayLabel.toLowerCase()} via automated workflows.`, [], `Derived from the "${family.label.displayLabel}" workflow family.`),
      supportingComponentIds: [],
    };
  });
}

export function buildResponsibilitiesFromTerraform(topologies: TerraformTopology[]): Responsibility[] {
  const byKind = new Map<ResponsibilityKind, { path: string; lines?: string }[]>();
  for (const topology of topologies) {
    for (const node of topology.nodes) {
      const category = (node.metadata as { resourceCategory?: string } | undefined)?.resourceCategory;
      if (!category) continue;
      const kind = CATEGORY_TO_RESPONSIBILITY_KIND[category];
      if (!kind) continue;
      const bucket = byKind.get(kind) ?? [];
      bucket.push(...node.evidence);
      byKind.set(kind, bucket);
    }
  }
  if (topologies.length > 0) {
    byKind.set("infrastructure", [...(byKind.get("infrastructure") ?? []), ...topologies.flatMap((t) => t.evidence)]);
  }

  return [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, evidence]) => ({
      id: responsibilityId(`infrastructure-${kind}`),
      label: normalizeLabel(`${kind} provisioning`),
      kind,
      description: confirmed(`Provisions ${kind}-category infrastructure via Terraform.`, evidence),
      supportingComponentIds: [],
    }));
}

/** Groups responsibilities/components/workflow-families into capability domains: one per rolled-up domain (see CAPABILITY_DOMAIN_ROLLUP), plus one for infrastructure/platform. */
export function buildCapabilityDomains(
  workflowFamilies: WorkflowFamily[],
  workflowResponsibilities: Responsibility[],
  terraformResponsibilities: Responsibility[],
  workflowFamilyComponents: LogicalComponent[],
  terraformComponents: LogicalComponent[],
): CapabilityDomain[] {
  const byDomainLabel = new Map<string, { families: WorkflowFamily[]; responsibilityIds: Set<string>; componentIds: Set<string> }>();

  for (const family of workflowFamilies) {
    const domainLabel = rollupDomainLabel(family.label.sourceLabel);
    const entry = byDomainLabel.get(domainLabel) ?? { families: [], responsibilityIds: new Set<string>(), componentIds: new Set<string>() };
    entry.families.push(family);

    const responsibility = workflowResponsibilities.find((r) => r.label.sourceLabel === family.label.sourceLabel);
    if (responsibility) entry.responsibilityIds.add(responsibility.id);
    const component = workflowFamilyComponents.find((c) => c.implementation.workflowGraphIds.length > 0 && family.workflowGraphIds.every((id) => c.implementation.workflowGraphIds.includes(id)));
    if (component) entry.componentIds.add(component.id);

    byDomainLabel.set(domainLabel, entry);
  }

  const domains: CapabilityDomain[] = [...byDomainLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainLabel, entry]) => {
      const isSingleFamily = entry.families.length === 1;
      const totalWorkflows = entry.families.reduce((n, f) => n + f.workflowGraphIds.length, 0);
      const memberNames = entry.families.map((f) => f.label.displayLabel.toLowerCase());
      return {
        id: capabilityDomainId(domainLabel),
        label: normalizeLabel(domainLabel),
        summary: isSingleFamily
          ? entry.families[0].description
          : derived(
              `Covers ${memberNames.join(", ")} across ${totalWorkflows} workflow${totalWorkflows === 1 ? "" : "s"}.`,
              [],
              `Rolled up from workflow families: ${entry.families.map((f) => f.label.displayLabel).join(", ")}.`,
            ),
        responsibilityIds: [...entry.responsibilityIds].sort(),
        componentIds: [...entry.componentIds].sort(),
        workflowFamilyIds: entry.families.map((f) => f.id),
      };
    });

  if (terraformComponents.length > 0) {
    domains.push({
      id: capabilityDomainId("Infrastructure and platform"),
      label: normalizeLabel("Infrastructure and platform"),
      summary: confirmed(`Provisions and manages ${terraformComponents.length} infrastructure module${terraformComponents.length === 1 ? "" : "s"} via Terraform.`, terraformComponents.flatMap((c) => c.evidence)),
      responsibilityIds: terraformResponsibilities.map((r) => r.id),
      componentIds: terraformComponents.map((c) => c.id),
      workflowFamilyIds: [],
    });
  }

  return domains;
}
