import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { Scene } from "@rvs/visualdoc-schema";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { renderArchitectureScene } from "./architecture.js";
import { renderArchitectureIntelligenceScene } from "./architecture-intelligence/index.js";
import { renderCapabilityIntelligenceOverviewScene } from "./capability-intelligence/index.js";
import { renderHeadlineScene } from "./headline.js";
import { renderMetricScene } from "./metric.js";
import { renderSectionDividerScene } from "./section-divider.js";
import { renderTitleScene } from "./title.js";
import { renderTopologyScene } from "./topology.js";
import { renderWorkflowScene } from "./workflow.js";

export function renderSceneInner(
  scene: Scene,
  index: number,
  workflowGraphs: Map<string, WorkflowGraph>,
  terraformTopologies: Map<string, TerraformTopology>,
  architectureArtifacts: Map<string, ArchitectureIntelligence>,
  capabilityModels: Map<string, CapabilityModel>,
): string {
  switch (scene.type) {
    case "title":
      return renderTitleScene(scene);
    case "section-divider":
      return renderSectionDividerScene(scene, index);
    case "headline":
      return renderHeadlineScene(scene);
    case "metric":
      return renderMetricScene(scene);
    case "architecture":
      return renderArchitectureScene(scene);
    case "workflow":
      return renderWorkflowScene(scene, workflowGraphs.get(scene.graph_id));
    case "topology":
      return renderTopologyScene(scene, terraformTopologies.get(scene.topology_id));
    case "architecture-intelligence":
      return renderArchitectureIntelligenceScene(scene, architectureArtifacts.get(scene.artifact_id));
    case "capability-intelligence-overview":
      return renderCapabilityIntelligenceOverviewScene(scene, capabilityModels.get(scene.model_id));
    default: {
      const exhaustive: never = scene;
      throw new Error(`Unhandled scene type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
