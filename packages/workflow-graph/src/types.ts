// WorkflowGraph is the renderer-neutral architecture contract for Milestone 2.
// Mermaid and SVG are both replaceable views over this same model; neither
// renderer's syntax or coordinates ever leaks back into it. Terraform and
// repository-dependency slices are expected to reuse this exact contract
// (see docs/workflow-engine.md).

// Bumped only when a change to WorkflowGraph's shape would break an
// existing consumer (renderer, validator, or a future adapter) — not on
// every additive field. Reported by `rvs doctor` for compatibility checks.
export const WORKFLOW_GRAPH_SCHEMA_VERSION = 1;

export type EvidenceConfidence = "confirmed" | "partially-resolved" | "dynamic" | "unsupported";

export interface EvidenceReference {
  path: string; // repository-relative
  lines?: string; // "start-end", 1-indexed, inclusive
}

export type WorkflowNodeType =
  | "trigger"
  | "job"
  | "step"
  | "reusable-workflow"
  | "environment"
  | "approval"
  | "artifact"
  | "unknown";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  evidence: EvidenceReference[];
  confidence: EvidenceConfidence;
  metadata?: Record<string, unknown>;
}

export type WorkflowEdgeType =
  | "starts"
  | "needs"
  | "contains"
  | "calls"
  | "conditional"
  | "produces"
  | "consumes"
  | "deploys-to";

export interface WorkflowEdge {
  id: string;
  type: WorkflowEdgeType;
  from: string;
  to: string;
  label?: string;
  evidence: EvidenceReference[];
  confidence: EvidenceConfidence;
  metadata?: Record<string, unknown>;
}

export interface WorkflowTrigger {
  id: string;
  name: string;
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  types?: string[];
  cron?: string[];
  inputs?: string[];
  referencedWorkflow?: string;
  evidence: EvidenceReference[];
}

export interface WorkflowGraphMetadata {
  runName?: string;
  permissions?: unknown;
  env?: Record<string, string>;
  concurrency?: unknown;
  jobCount: number;
  stepCount: number;
  hasMatrixJobs: boolean;
  hasReusableWorkflows: boolean;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  sourcePath: string;
  triggers: WorkflowTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: WorkflowGraphMetadata;
  evidence: EvidenceReference[];
}

export type WorkflowWarningSeverity = "error" | "warning";

export type WorkflowWarningCode =
  | "WORKFLOW_UNSUPPORTED_TRIGGER"
  | "WORKFLOW_UNKNOWN_NEEDS"
  | "WORKFLOW_DYNAMIC_EXPRESSION"
  | "WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED"
  | "WORKFLOW_TOO_LARGE"
  | "WORKFLOW_MATRIX_COLLAPSED"
  | "WORKFLOW_STEP_DETAIL_COLLAPSED"
  | "WORKFLOW_MISSING_EVIDENCE"
  | "WORKFLOW_LAYOUT_OVERLAP"
  | "WORKFLOW_LAYOUT_TEXT_OVERFLOW"
  | "WORKFLOW_RENDERER_DIVERGENCE"
  | "WORKFLOW_DUPLICATE_NODE_ID"
  | "WORKFLOW_DUPLICATE_EDGE_ID"
  | "WORKFLOW_DANGLING_EDGE";

export interface WorkflowWarning {
  code: WorkflowWarningCode;
  severity: WorkflowWarningSeverity;
  message: string;
  sourcePath: string;
  evidence?: EvidenceReference;
  remediation?: string;
}

export interface ParsedWorkflow {
  graph: WorkflowGraph;
  warnings: WorkflowWarning[];
}

export interface WorkflowRepositoryIndex {
  generated_at: string;
  workflows: Array<{
    id: string;
    name: string;
    sourcePath: string;
    jobCount: number;
    triggerCount: number;
    warningCount: number;
  }>;
}
