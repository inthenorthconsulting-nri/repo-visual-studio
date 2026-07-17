import type { ArchitectureIntelligence, ArchitectureSceneKind, NarrativeProfile } from "@rvs/architecture-intelligence";
import { getNarrativeProfile } from "@rvs/architecture-intelligence";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { Scene, VisualDoc } from "@rvs/visualdoc-schema";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { buildTopologyScenes, buildWorkflowScenes } from "./visualdoc-builder.js";

// Every scene sequence entry in a NarrativeProfile becomes exactly one
// architecture-intelligence scene that references the artifact by id
// (never embeds it) — mirrors WorkflowScene/TopologyScene's graph_id /
// topology_id contract. The headline is a deterministic template fill off
// the artifact's own identity, matching brief.ts's "no LLM in the default
// path" principle.
function plural(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

// Headlines are conclusion-oriented (state what's true, not what the slide
// covers) and built only from counts already present on the artifact — real
// structural facts, never a fabricated quantitative outcome. Every branch
// stays well under a 14-word budget.
function headlineFor(kind: ArchitectureSceneKind, artifact: ArchitectureIntelligence): string {
  const name = artifact.identity.name.displayLabel;
  const architecturalComponentCount = artifact.components.filter((c) => c.origin !== "repository-directory").length || artifact.components.length;
  const domainCount = artifact.capabilityDomains.length;
  const familyCount = artifact.workflowFamilies.length;
  const riskCount = artifact.risks.length;
  const boundaryCount = artifact.boundaries.length;
  const outcomeCount = artifact.outcomes.length;
  const questionCount = artifact.questions.length;

  switch (kind) {
    case "executive-title":
      return name;
    case "executive-summary":
      return domainCount > 0 ? `${name} spans ${domainCount} capability ${plural(domainCount, "domain", "domains")}` : `${name}: what it does and why`;
    case "problem-and-response":
      return "The problem this platform solves, and how it responds";
    case "platform-responsibilities":
      return domainCount > 0 ? `The platform owns ${domainCount} core ${plural(domainCount, "responsibility", "responsibilities")}` : "What the platform is responsible for";
    case "system-context":
      return `${name} sits between its operators and external systems`;
    case "logical-architecture":
      return `${architecturalComponentCount} ${plural(architecturalComponentCount, "component makes", "components make")} up the architecture`;
    case "capability-map":
      return domainCount > 0 ? `Capabilities group into ${domainCount} ${plural(domainCount, "domain", "domains")}` : "Capability map";
    case "operating-model":
      return "How the platform is operated and released today";
    case "architecture-flow":
      return "How requests and approvals flow through the system";
    case "boundary-map":
      return boundaryCount > 0 ? `${boundaryCount} deployment ${plural(boundaryCount, "boundary separates", "boundaries separate")} environments` : "No deployment boundaries were evidenced";
    case "outcomes":
      return outcomeCount > 0 ? "What this platform delivers today" : "Outcomes are not yet documented";
    case "risk-summary":
      return riskCount > 0 ? `${riskCount} ${plural(riskCount, "risk needs", "risks need")} attention` : "No structural risks were detected";
    case "risk-and-dependency-summary":
      return riskCount > 0 ? `${riskCount} ${plural(riskCount, "risk and dependency need", "risks and dependencies need")} tracking` : "Risks and dependencies to track";
    case "workflow-family-map":
      return familyCount > 0 ? `Automation is organized into ${familyCount} ${plural(familyCount, "family", "families")}` : "No workflow automation was detected";
    case "repository-map":
      return "How the repository is organized";
    case "evidence-confidence":
      return "How confident this analysis is, and why";
    case "decision-or-next-step":
      return questionCount > 0 ? `${questionCount} open ${plural(questionCount, "question needs", "questions need")} a decision` : "No open questions remain";
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled architecture scene kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function buildArchitectureIntelligenceScenes(artifact: ArchitectureIntelligence, profile: NarrativeProfile, nextId: () => string): Scene[] {
  return profile.sceneSequence.map((kind) => ({
    id: nextId(),
    type: "architecture-intelligence",
    headline: headlineFor(kind, artifact),
    evidence: [],
    artifact_id: artifact.identity.id,
    kind,
    focus_ids: [],
  }));
}

// workflowDetailDefault governs how much raw workflow/Terraform diagram
// detail (Level 3/4) supplements the synthesized narrative:
// - "none": no raw diagrams — the narrative stands on its own (executive audiences).
// - "representative": one summary-level scene per workflow family's
//   representative graph — enough to ground the family in a real workflow
//   without showing all of them.
// - "critical": representative workflow scenes plus a topology overview per
//   Terraform root module.
// - "all": every workflow graph and every topology, at full detail — mirrors
//   buildVisualDoc()'s legacy (repository-inventory) behavior exactly.
function buildSupplementaryScenes(
  artifact: ArchitectureIntelligence,
  profile: NarrativeProfile,
  workflowGraphs: WorkflowGraph[],
  terraformTopologies: TerraformTopology[],
  nextId: () => string,
): Scene[] {
  if (profile.workflowDetailDefault === "none") return [];

  const graphsById = new Map(workflowGraphs.map((g) => [g.id, g]));
  const scenes: Scene[] = [];

  if (profile.workflowDetailDefault === "all") {
    for (const graph of [...workflowGraphs].sort((a, b) => a.id.localeCompare(b.id))) {
      scenes.push(...buildWorkflowScenes(graph, nextId));
    }
    for (const topology of [...terraformTopologies].sort((a, b) => a.id.localeCompare(b.id))) {
      scenes.push(...buildTopologyScenes(topology, nextId));
    }
    return scenes;
  }

  const representativeGraphIds = artifact.workflowFamilies
    .map((f) => f.representativeWorkflowGraphId)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));
  for (const graphId of representativeGraphIds) {
    const graph = graphsById.get(graphId);
    if (!graph) continue;
    scenes.push({
      id: nextId(),
      type: "workflow",
      headline: `${graph.name} (representative)`,
      graph_id: graph.id,
      detail_level: "summary",
      direction: "top-to-bottom",
      highlight: [],
      annotations: [],
      evidence: [],
    });
  }

  if (profile.workflowDetailDefault === "critical") {
    for (const topology of [...terraformTopologies].sort((a, b) => a.id.localeCompare(b.id))) {
      scenes.push({
        id: nextId(),
        type: "topology",
        headline: `${topology.name} Terraform topology (overview)`,
        topology_id: topology.id,
        detail_level: "modules-and-key-resources",
        direction: "top-to-bottom",
        highlight: [],
        part_index: 0,
        evidence: [],
      });
    }
  }

  return scenes;
}

export function buildArchitectureVisualDoc(
  artifact: ArchitectureIntelligence,
  profileId: string,
  themeId: string,
  workflowGraphs: WorkflowGraph[] = [],
  terraformTopologies: TerraformTopology[] = [],
): VisualDoc {
  const profile = getNarrativeProfile(profileId);
  if (profile.sceneSequence.length === 0) {
    throw new Error(`Profile "${profileId}" has no architecture scene sequence — use buildVisualDoc() (the repository-inventory builder) for this profile instead.`);
  }

  let sceneCounter = 0;
  const nextId = () => `scene-${(sceneCounter += 1)}`;

  const scenes: Scene[] = [
    ...buildArchitectureIntelligenceScenes(artifact, profile, nextId),
    ...buildSupplementaryScenes(artifact, profile, workflowGraphs, terraformTopologies, nextId),
  ];

  return {
    version: 1,
    document: {
      type: "presentation",
      title: `${artifact.identity.name.displayLabel} — ${profile.label}`,
      aspect_ratio: "16:9",
      audience: profile.id,
      theme: themeId,
    },
    scenes,
  };
}
