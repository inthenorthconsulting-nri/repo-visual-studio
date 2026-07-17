import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { renderArchitectureFlow, renderBoundaryMap, renderLogicalArchitecture, renderSystemContext } from "./diagrams.js";
import { renderCapabilityMap, renderEvidenceConfidence, renderRepositoryMap, renderWorkflowFamilyMap } from "./maps.js";
import {
  renderDecisionOrNextStep,
  renderExecutiveSummary,
  renderExecutiveTitle,
  renderOperatingModel,
  renderOutcomes,
  renderPlatformResponsibilities,
  renderProblemAndResponse,
  renderRiskSummary,
} from "./text.js";

// An architecture-intelligence scene never embeds synthesized data — it
// resolves a single ArchitectureIntelligence artifact by id, mirroring
// renderWorkflowScene/renderTopologyScene's "unresolved reference throws"
// contract exactly.
export function renderArchitectureIntelligenceScene(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence | undefined): string {
  if (!artifact) {
    throw new Error(`Architecture-intelligence scene "${scene.id}" references unresolved artifact_id "${scene.artifact_id}"`);
  }

  switch (scene.kind) {
    case "executive-title":
      return renderExecutiveTitle(scene, artifact);
    case "executive-summary":
      return renderExecutiveSummary(scene, artifact);
    case "problem-and-response":
      return renderProblemAndResponse(scene, artifact);
    case "platform-responsibilities":
      return renderPlatformResponsibilities(scene, artifact);
    case "system-context":
      return renderSystemContext(scene, artifact);
    case "logical-architecture":
      return renderLogicalArchitecture(scene, artifact);
    case "capability-map":
      return renderCapabilityMap(scene, artifact);
    case "operating-model":
      return renderOperatingModel(scene, artifact);
    case "architecture-flow":
      return renderArchitectureFlow(scene, artifact);
    case "boundary-map":
      return renderBoundaryMap(scene, artifact);
    case "outcomes":
      return renderOutcomes(scene, artifact);
    case "risk-summary":
      return renderRiskSummary(scene, artifact, false);
    case "risk-and-dependency-summary":
      return renderRiskSummary(scene, artifact, true);
    case "workflow-family-map":
      return renderWorkflowFamilyMap(scene, artifact);
    case "repository-map":
      return renderRepositoryMap(scene, artifact);
    case "evidence-confidence":
      return renderEvidenceConfidence(scene, artifact);
    case "decision-or-next-step":
      return renderDecisionOrNextStep(scene, artifact);
    default: {
      const exhaustive: never = scene.kind;
      throw new Error(`Unhandled architecture scene kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
