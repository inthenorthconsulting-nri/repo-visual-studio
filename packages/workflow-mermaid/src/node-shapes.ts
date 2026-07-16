import type { WorkflowNodeType } from "@rvs/workflow-graph";

// Wraps an already mermaid-safe id + escaped label in the shape syntax for
// each WorkflowNode type, so every type is visually distinguishable.
export function wrapNodeShape(type: WorkflowNodeType, id: string, label: string): string {
  switch (type) {
    case "trigger":
      return `${id}(["${label}"])`;
    case "job":
      return `${id}["${label}"]`;
    case "step":
      return `${id}("${label}")`;
    case "reusable-workflow":
      return `${id}[["${label}"]]`;
    case "environment":
      return `${id}{{"${label}"}}`;
    case "approval":
      return `${id}{"${label}"}`;
    case "artifact":
      return `${id}[/"${label}"/]`;
    case "unknown":
    default:
      return `${id}["${label}"]`;
  }
}

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  job: "Job",
  step: "Step",
  "reusable-workflow": "Reusable workflow",
  environment: "Environment",
  approval: "Approval",
  artifact: "Artifact",
  unknown: "Unknown",
};

export const NODE_TYPE_CLASS_DEFS: Record<WorkflowNodeType, string> = {
  trigger: "fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e",
  job: "fill:#ffffff,stroke:#334155,color:#0f172a",
  step: "fill:#f8fafc,stroke:#94a3b8,color:#334155",
  "reusable-workflow": "fill:#ede9fe,stroke:#7c3aed,color:#4c1d95",
  environment: "fill:#dcfce7,stroke:#16a34a,color:#14532d",
  approval: "fill:#fef9c3,stroke:#ca8a04,color:#713f12",
  artifact: "fill:#fee2e2,stroke:#dc2626,color:#7f1d1d",
  unknown: "fill:#f1f5f9,stroke:#64748b,color:#334155,stroke-dasharray: 4 2",
};
