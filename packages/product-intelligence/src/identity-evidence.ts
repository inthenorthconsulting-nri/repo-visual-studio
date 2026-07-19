import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityEvidence } from "./contracts.js";
import { productEvidenceId } from "./ids.js";

/**
 * §3: identity evidence is gathered ONLY from accepted (included/qualified)
 * evidence — capability domains/capabilities, architecture identity, logical
 * components, and workflow families. Roadmap-only, gap-only, and excluded
 * candidates never contribute identity evidence; unfinished capabilities
 * stay absent from the current-state story at the source, not by later
 * filtering.
 */
export function gatherIdentityEvidence(model: CapabilityModel, arch: ArchitectureIntelligence): ProductIdentityEvidence[] {
  const evidence: ProductIdentityEvidence[] = [];

  if (arch.identity.oneLineDescription.value) {
    evidence.push({
      id: productEvidenceId("repository_metadata", "identity", 0),
      sourceType: "repository_metadata",
      sourceId: arch.identity.id,
      text: arch.identity.oneLineDescription.value,
      confidence: arch.identity.oneLineDescription.inference,
      strength: arch.identity.oneLineDescription.inference === "confirmed" ? 4 : 2,
    });
  }

  let capIndex = 0;
  for (const cap of [...model.includedCapabilities, ...model.qualifiedCapabilities]) {
    evidence.push({
      id: productEvidenceId("capability", cap.id, capIndex++),
      sourceType: "capability",
      sourceId: cap.id,
      text: cap.purpose || cap.shortDescription,
      confidence: cap.confidence,
      strength: cap.inclusion === "include" ? 4 : 2,
    });
  }

  let domainIndex = 0;
  for (const domain of model.domains) {
    if (domain.capabilities.length === 0) continue;
    evidence.push({
      id: productEvidenceId("capability_domain", domain.id, domainIndex++),
      sourceType: "capability_domain",
      sourceId: domain.id,
      text: domain.purpose || domain.displayName,
      confidence: "derived",
      strength: 3,
    });
  }

  let componentIndex = 0;
  for (const component of arch.components) {
    if (component.origin === "repository-directory") continue;
    evidence.push({
      id: productEvidenceId("logical_component", component.id, componentIndex++),
      sourceType: "logical_component",
      sourceId: component.id,
      sourcePath: component.sourcePaths[0],
      text: component.description.value,
      confidence: component.description.inference,
      strength: component.description.inference === "confirmed" ? 3 : 1,
    });
  }

  let workflowIndex = 0;
  for (const family of arch.workflowFamilies) {
    evidence.push({
      id: productEvidenceId("workflow_family", family.id, workflowIndex++),
      sourceType: "workflow_family",
      sourceId: family.id,
      text: family.description.value,
      confidence: family.description.inference,
      strength: family.description.inference === "confirmed" ? 3 : 1,
    });
  }

  evidence.sort((a, b) => a.id.localeCompare(b.id));
  return evidence;
}
