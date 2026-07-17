export type AbstractionLevel = 1 | 2 | 3 | 4;

export type WorkflowDetailPolicy = "none" | "representative" | "critical" | "all";

export type ArchitectureSceneKind =
  | "executive-title"
  | "executive-summary"
  | "problem-and-response"
  | "platform-responsibilities"
  | "system-context"
  | "logical-architecture"
  | "capability-map"
  | "operating-model"
  | "architecture-flow"
  | "boundary-map"
  | "outcomes"
  | "risk-summary"
  | "risk-and-dependency-summary"
  | "workflow-family-map"
  | "repository-map"
  | "evidence-confidence"
  | "decision-or-next-step";

export type NarrativeProfileId = "executive-overview" | "architecture-review" | "engineering-onboarding" | "operating-review" | "repository-audit" | "repository-inventory";

export interface NarrativeProfile {
  id: NarrativeProfileId;
  label: string;
  description: string;
  minScenes: number;
  maxScenes: number;
  includeLevels: AbstractionLevel[];
  workflowDetailDefault: WorkflowDetailPolicy;
  sceneSequence: ArchitectureSceneKind[];
}

// "repository-inventory" is the explicit backward-compatible profile: it emits
// zero architecture-intelligence scenes and preserves `rvs create slides`'s
// pre-Milestone-3 behavior exactly (title/context/architecture/metric/
// workflow/topology/status/decision, built by @rvs/narrative-planner).
export const NARRATIVE_PROFILES: Record<NarrativeProfileId, NarrativeProfile> = {
  "repository-inventory": {
    id: "repository-inventory",
    label: "Repository inventory (legacy)",
    description: "Pre-Milestone-3 default: file/git/markdown evidence plus raw workflow/topology diagrams, no architecture synthesis.",
    minScenes: 1,
    maxScenes: 200,
    includeLevels: [],
    workflowDetailDefault: "all",
    sceneSequence: [],
  },
  "executive-overview": {
    id: "executive-overview",
    label: "Executive overview",
    description: "A short, non-technical narrative for a decision-making audience.",
    minScenes: 8,
    maxScenes: 12,
    includeLevels: [1],
    workflowDetailDefault: "none",
    sceneSequence: [
      "executive-title",
      "executive-summary",
      "problem-and-response",
      "platform-responsibilities",
      "capability-map",
      "outcomes",
      "risk-and-dependency-summary",
      "decision-or-next-step",
    ],
  },
  "architecture-review": {
    id: "architecture-review",
    label: "Architecture review",
    description: "The default profile: system context, logical architecture, flows, boundaries, operating model, workflow families, evidence confidence.",
    minScenes: 12,
    maxScenes: 20,
    includeLevels: [1, 2],
    workflowDetailDefault: "representative",
    sceneSequence: [
      "executive-title",
      "system-context",
      "logical-architecture",
      "capability-map",
      "architecture-flow",
      "boundary-map",
      "operating-model",
      "workflow-family-map",
      "outcomes",
      "risk-summary",
      "evidence-confidence",
    ],
  },
  "engineering-onboarding": {
    id: "engineering-onboarding",
    label: "Engineering onboarding",
    description: "Level 1-3 walk-through for a new engineer: architecture plus representative implementation detail.",
    minScenes: 12,
    maxScenes: 24,
    includeLevels: [1, 2, 3],
    workflowDetailDefault: "critical",
    sceneSequence: [
      "executive-title",
      "system-context",
      "logical-architecture",
      "repository-map",
      "capability-map",
      "workflow-family-map",
      "architecture-flow",
      "boundary-map",
      "operating-model",
      "risk-summary",
      "evidence-confidence",
    ],
  },
  "operating-review": {
    id: "operating-review",
    label: "Operating review",
    description: "Focused on how the system runs today: operating model, boundaries, risks, dependencies.",
    minScenes: 8,
    maxScenes: 16,
    includeLevels: [1, 2],
    workflowDetailDefault: "representative",
    sceneSequence: ["executive-title", "system-context", "operating-model", "boundary-map", "workflow-family-map", "risk-summary", "outcomes", "evidence-confidence"],
  },
  "repository-audit": {
    id: "repository-audit",
    label: "Repository audit",
    description: "Full Level 1-4 detail: every component, flow, risk, dependency, and evidence-confidence rollup.",
    minScenes: 16,
    maxScenes: 60,
    includeLevels: [1, 2, 3, 4],
    workflowDetailDefault: "all",
    sceneSequence: [
      "executive-title",
      "system-context",
      "logical-architecture",
      "repository-map",
      "capability-map",
      "architecture-flow",
      "boundary-map",
      "operating-model",
      "workflow-family-map",
      "outcomes",
      "risk-summary",
      "evidence-confidence",
    ],
  },
};

export function getNarrativeProfile(id: string): NarrativeProfile {
  const profile = NARRATIVE_PROFILES[id as NarrativeProfileId];
  if (!profile) {
    throw new Error(`Unknown narrative profile "${id}". Valid profiles: ${Object.keys(NARRATIVE_PROFILES).join(", ")}.`);
  }
  return profile;
}
