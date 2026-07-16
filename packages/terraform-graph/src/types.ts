import type { ArchitectureEdge, ArchitectureNode, EvidenceReference } from "@rvs/architecture-graph";

// TerraformTopology is renderer-neutral, mirroring WorkflowGraph's role for
// GitHub Actions (see docs/terraform-topology.md). Its nodes/edges are typed
// as the shared ArchitectureNode/ArchitectureEdge primitives (see
// @rvs/architecture-graph) rather than Terraform-specific classes, per the
// Milestone 2 Slice 2 architecture-contract decision (sibling contract, not
// a WorkflowGraph migration).
export const TERRAFORM_TOPOLOGY_SCHEMA_VERSION = 1;

export type TerraformNodeType =
  | "root-module"
  | "child-module"
  | "external-module"
  | "resource"
  | "data-source"
  | "provider"
  | "variable"
  | "output"
  | "local"
  | "backend"
  | "unknown";

export type TerraformEdgeType =
  | "depends-on"
  | "references"
  | "contains"
  | "calls-module"
  | "uses-provider"
  | "reads-from"
  | "produces-output"
  | "passes-input"
  | "exports"
  | "connects-to"
  | "unresolved-reference";

// Cloud-provider-specific classification, kept out of the node `type`
// itself (which stays a domain-neutral TerraformNodeType) and surfaced only
// as metadata.resourceCategory, per spec section 6: "Cloud-provider-specific
// resource categories may exist as metadata."
export type TerraformResourceCategory =
  | "compute"
  | "storage"
  | "database"
  | "network"
  | "identity"
  | "messaging"
  | "observability"
  | "security"
  | "analytics"
  | "integration"
  | "unknown";

export type TerraformCloudProvider =
  | "aws"
  | "azure"
  | "google"
  | "kubernetes"
  | "databricks"
  | "snowflake"
  | "github"
  | "generic";

export type TerraformModuleSourceKind = "local" | "registry" | "git" | "other";

// Spec section 9's four detail levels for a topology scene's visible
// subgraph, ordered least- to most-detailed.
export type TerraformDetailLevel = "modules" | "modules-and-key-resources" | "modules-and-resources" | "full";

export interface TerraformProviderSummary {
  id: string;
  name: string;
  alias?: string;
  cloudProvider: TerraformCloudProvider;
  region?: string;
  accountOrProfile?: string;
  source?: string;
  versionConstraint?: string;
  configExpressions?: Record<string, string>;
  modulePath: string;
  evidence: EvidenceReference[];
}

export interface TerraformModuleSummary {
  id: string;
  name: string;
  modulePath: string; // dot-joined path from root, "" for the root module itself
  kind: "root" | "child" | "external";
  source?: string;
  sourceKind?: TerraformModuleSourceKind;
  version?: string;
  localPath?: string; // repo-relative, only when kind === "child"
  inputs?: Record<string, string>; // raw expression text, keyed by input name
  outputNames?: string[]; // declared output names, only known for kind === "child" | "root"
  evidence: EvidenceReference[];
}

export interface TerraformVariableSummary {
  id: string;
  name: string;
  modulePath: string;
  type?: string;
  hasDefault: boolean;
  sensitive: boolean;
  description?: string;
  hasValidation: boolean;
  evidence: EvidenceReference[];
}

export interface TerraformOutputSummary {
  id: string;
  name: string;
  modulePath: string;
  sensitive: boolean;
  description?: string;
  referencedAddresses: string[];
  evidence: EvidenceReference[];
}

export type TerraformWarningSeverity = "informational" | "warning" | "error";

export type TerraformWarningCode =
  | "TERRAFORM_PARSE_ERROR"
  | "TERRAFORM_UNSUPPORTED_BLOCK"
  | "TERRAFORM_DYNAMIC_EXPRESSION"
  | "TERRAFORM_UNRESOLVED_REFERENCE"
  | "TERRAFORM_UNKNOWN_DEPENDS_ON"
  | "TERRAFORM_LOCAL_MODULE_NOT_FOUND"
  | "TERRAFORM_REMOTE_MODULE_OPAQUE"
  | "TERRAFORM_SENSITIVE_VALUE_REDACTED"
  | "TERRAFORM_RESOURCE_ADDRESS_COLLISION"
  | "TERRAFORM_PROVIDER_UNRESOLVED"
  | "TERRAFORM_GRAPH_TOO_LARGE"
  | "TERRAFORM_COMPONENT_SPLIT"
  | "TERRAFORM_LABEL_TRUNCATED"
  | "TERRAFORM_LAYOUT_OVERLAP"
  | "TERRAFORM_LAYOUT_TEXT_OVERFLOW"
  | "TERRAFORM_RENDERER_DIVERGENCE"
  | "TERRAFORM_MISSING_EVIDENCE"
  // Additive beyond spec section 15's recommended set: structural-integrity
  // codes with no natural fit in the recommended list, mirroring
  // WorkflowWarningCode's equivalents.
  | "TERRAFORM_DUPLICATE_NODE_ID"
  | "TERRAFORM_DUPLICATE_EDGE_ID"
  | "TERRAFORM_DANGLING_EDGE";

export interface TerraformTopologyWarning {
  code: TerraformWarningCode;
  severity: TerraformWarningSeverity;
  message: string;
  sourcePath: string;
  lines?: string;
  relatedId?: string;
  remediation?: string;
}

export interface TerraformTopologyMetadata {
  moduleCount: number;
  resourceCount: number;
  dataSourceCount: number;
  providerCount: number;
  variableCount: number;
  outputCount: number;
  hasDynamicExpressions: boolean;
  hasExternalModules: boolean;
}

export interface TerraformTopology {
  id: string;
  name: string;
  rootModulePath: string; // repo-relative directory
  terraformVersion?: string;
  providers: TerraformProviderSummary[];
  modules: TerraformModuleSummary[];
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  variables: TerraformVariableSummary[];
  outputs: TerraformOutputSummary[];
  warnings: TerraformTopologyWarning[];
  evidence: EvidenceReference[];
  metadata: TerraformTopologyMetadata;
}

export interface TerraformRepositoryIndex {
  generated_at: string;
  topologies: Array<{
    id: string;
    name: string;
    rootModulePath: string;
    moduleCount: number;
    resourceCount: number;
    warningCount: number;
  }>;
}
