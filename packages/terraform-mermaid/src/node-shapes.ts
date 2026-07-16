import type { TerraformNodeType } from "@rvs/terraform-graph";

// Wraps an already mermaid-safe id + escaped label in the shape syntax for
// each TerraformNodeType, so every type is visually distinguishable.
export function wrapNodeShape(type: TerraformNodeType, id: string, label: string): string {
  switch (type) {
    case "root-module":
    case "child-module":
      return `${id}[["${label}"]]`;
    case "external-module":
      return `${id}[/"${label}"\\]`;
    case "resource":
      return `${id}["${label}"]`;
    case "data-source":
      return `${id}[("${label}")]`;
    case "provider":
      return `${id}{{"${label}"}}`;
    case "variable":
      return `${id}(["${label}"])`;
    case "output":
      return `${id}>"${label}"]`;
    case "local":
      return `${id}("${label}")`;
    case "backend":
      return `${id}[\\"${label}"/]`;
    case "unknown":
    default:
      return `${id}["${label}"]`;
  }
}

export const NODE_TYPE_LABELS: Record<TerraformNodeType, string> = {
  "root-module": "Root module",
  "child-module": "Child module",
  "external-module": "External module",
  resource: "Resource",
  "data-source": "Data source",
  provider: "Provider",
  variable: "Variable",
  output: "Output",
  local: "Local value",
  backend: "Backend",
  unknown: "Unknown",
};

export const NODE_TYPE_CLASS_DEFS: Record<TerraformNodeType, string> = {
  "root-module": "fill:#ede9fe,stroke:#6d28d9,color:#3b0764",
  "child-module": "fill:#f3e8ff,stroke:#7c3aed,color:#4c1d95",
  "external-module": "fill:#f1f5f9,stroke:#64748b,color:#334155,stroke-dasharray: 4 2",
  resource: "fill:#ffffff,stroke:#334155,color:#0f172a",
  "data-source": "fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e",
  provider: "fill:#fef3c7,stroke:#d97706,color:#78350f",
  variable: "fill:#dcfce7,stroke:#16a34a,color:#14532d",
  output: "fill:#fee2e2,stroke:#dc2626,color:#7f1d1d",
  local: "fill:#f8fafc,stroke:#94a3b8,color:#334155",
  backend: "fill:#fce7f3,stroke:#db2777,color:#831843",
  unknown: "fill:#f1f5f9,stroke:#64748b,color:#334155,stroke-dasharray: 4 2",
};
