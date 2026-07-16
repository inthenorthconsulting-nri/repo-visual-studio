// ArchitectureGraph is a compatible SIBLING contract to WorkflowGraph
// (see @rvs/workflow-graph), not a generalization of it. WorkflowGraph and
// its entire dependent chain (workflow-mermaid, workflow-svg, validator's
// workflow-checks, narrative-planner, renderer-html, create-workflow) stay
// untouched. Domains that need a renderer-neutral node/edge shape beyond
// GitHub Actions (Terraform now; repository dependency graphs later) build
// on these shared primitives instead. This is intentional, documented
// duplication with WorkflowGraph's own EvidenceReference/EvidenceConfidence
// shape (which itself already duplicates @rvs/core's differently-shaped
// evidence vocabulary) — see docs/terraform-topology.md.

// Bumped only when a change to ArchitectureGraph's shape would break an
// existing consumer — not on every additive field.
export const ARCHITECTURE_GRAPH_SCHEMA_VERSION = 1;

export type EvidenceConfidence = "confirmed" | "partially-resolved" | "dynamic" | "unsupported";

export interface EvidenceReference {
  path: string; // repository-relative
  lines?: string; // "start-end", 1-indexed, inclusive
}

export type ArchitectureNodeStatus = "confirmed" | "partial" | "dynamic" | "unresolved";

// `type` and edge `type` are intentionally open strings, not a shared enum:
// each domain (workflow, terraform, repository) owns its own node/edge type
// vocabulary. Forcing a single cross-domain enum here would either bloat it
// with domain-specific names or force domains to share meanings they don't
// actually share (see spec section 2's "do not force Terraform semantics
// into workflow-specific node names").
export interface ArchitectureNode {
  id: string;
  type: string;
  label: string;
  status?: ArchitectureNodeStatus;
  evidence: EvidenceReference[];
  metadata?: Record<string, unknown>;
}

export interface ArchitectureEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  label?: string;
  status?: ArchitectureNodeStatus;
  evidence: EvidenceReference[];
  metadata?: Record<string, unknown>;
}

export type ArchitectureSourceType = "github-actions" | "terraform" | "repository";

export type ArchitectureGraphMetadata = Record<string, unknown>;

// Deliberately renderer-neutral: no Mermaid syntax, no SVG coordinates, no
// cloud-provider styling ever belongs on this contract or its primitives.
export interface ArchitectureGraph {
  id: string;
  name: string;
  sourceType: ArchitectureSourceType;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  metadata: ArchitectureGraphMetadata;
  evidence: EvidenceReference[];
}
