import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import {
  buildDecisionStateLookup,
  buildKnowledgeGraph,
  buildKnowledgeGraphNarrative,
  buildKnowledgeGraphPlan,
  buildReportId,
  groupRootCauses,
  validateGraph,
} from "@rvs/knowledge-graph";
import type {
  DecisionStateLookup,
  KnowledgeEdgeType,
  KnowledgeGraphBuildInput,
  KnowledgeGraphBuildResult,
  KnowledgeGraphNarrative,
  KnowledgeGraphPlan,
  KnowledgeNodeType,
  RawDecisionArtifact,
  RawDecisionAssumptionsArtifact,
  RawDecisionConsequencesArtifact,
  RawDecisionLinksArtifact,
  RawGovernanceArtifact,
  RootCauseGroup,
  ValidationFinding,
} from "@rvs/knowledge-graph";
import { GOVERNANCE_OUTPUT_FILES, loadGovernanceConfig, loadPolicyFiles } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport } from "@rvs/governance-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { ArchitectureDecision, DecisionAssumption, DecisionConsequence, DecisionLink, DecisionSnapshot } from "@rvs/decision-intelligence";
import { readCachedJsonOptional } from "../cache.js";
import { readGovernanceCachedJsonOptional } from "../governance-cache.js";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { writeGraphOutputs } from "../graph-cache.js";

/**
 * Fallback repository identity, only consulted when none of
 * architecture/governance/decision's own cached artifacts carry one --
 * duplicated from decisions-analyze.ts's resolveRepositoryId (kept private
 * to each CLI command module, mirroring the existing convention of not
 * sharing unexported helpers across command files).
 */
function resolveRepositoryIdHint(repoRoot: string): string | undefined {
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (remoteUrl) {
      let normalized = remoteUrl.trim();
      normalized = normalized.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
      normalized = normalized.replace(/^[^@/]+@/, "");
      normalized = normalized.replace(/:/, "/");
      normalized = normalized.replace(/\.git$/, "");
      normalized = normalized.replace(/\/+$/, "");
      return normalized;
    }
  } catch {
    // No "origin" remote (or not a git repo) -- fall through.
  }
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (topLevel) return basename(topLevel);
  } catch {
    // Not inside a git working tree -- fall through.
  }
  return basename(repoRoot);
}

function countByKey<T extends string>(keys: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

export interface GraphReport {
  schema_version: 1;
  id: string;
  generated_at: string;
  snapshot_id: string;
  repository_id: string;
  compatibility_status: string;
  node_count: number;
  edge_count: number;
  nodes_by_type: Record<string, number>;
  edges_by_type: Record<string, number>;
  root_cause_groups_by_classification: Record<string, number>;
  validation_finding_count: number;
  validation_blocking_count: number;
}

export interface GraphBuildResult {
  buildResult: KnowledgeGraphBuildResult;
  decisionStateLookup: DecisionStateLookup;
  rootCauseGroups: RootCauseGroup[];
  validationFindings: ValidationFinding[];
  narrative: KnowledgeGraphNarrative;
  plan: KnowledgeGraphPlan;
  report: GraphReport;
}

/**
 * Runs the full knowledge-graph construction pipeline: reads the six
 * upstream intelligence caches (never rescans the repository), assembles a
 * KnowledgeGraphBuildInput, builds the graph, groups root causes, looks up
 * decision state, validates the result, synthesizes a narrative/plan/report,
 * and caches every KNOWLEDGE_GRAPH_OUTPUT_FILES artifact. Shared by
 * `rvs graph build` and `rvs graph validate`, mirroring
 * decisions-analyze.ts's runDecisionAnalysis / governance-compare.ts's
 * runGovernanceComparison precedent.
 */
export async function runGraphBuild(repoRoot: string, logger: Logger): Promise<GraphBuildResult> {
  const generatedAt = new Date().toISOString();

  const architecture = readCachedJsonOptional<KnowledgeGraphBuildInput["architecture"]>(repoRoot, "architecture-intelligence.json");
  const capability = readCachedJsonOptional<KnowledgeGraphBuildInput["capability"]>(repoRoot, "capability-model.json");
  const product = readCachedJsonOptional<KnowledgeGraphBuildInput["product"]>(repoRoot, "product-identity-model.json");
  const portfolio = readCachedJsonOptional<KnowledgeGraphBuildInput["portfolio"]>(repoRoot, "portfolio-model.json");

  const governanceReport = readGovernanceCachedJsonOptional<ContinuousIntelligenceReport>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceReport);
  const governanceConfig = loadGovernanceConfig(repoRoot);
  const policyPaths = (governanceConfig?.policies ?? []).map((policyPath) => resolve(repoRoot, policyPath));
  const policies = policyPaths.length > 0 ? loadPolicyFiles(policyPaths, generatedAt) : [];
  const governance: RawGovernanceArtifact | undefined =
    governanceReport || policies.length > 0 || governanceConfig?.baseline
      ? {
          repository_id: governanceReport?.repository_id,
          policies: policies.map((policy) => ({ id: policy.id, name: policy.name })),
          findings: governanceReport?.findings,
          baseline: governanceConfig?.baseline ? { id: governanceConfig.baseline.snapshot } : undefined,
        }
      : undefined;

  const decisionSnapshot = readDecisionCachedJsonOptional<DecisionSnapshot>(repoRoot, DECISION_OUTPUT_FILES.decisionSnapshot);
  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const rawConsequences = readDecisionCachedJsonOptional<DecisionConsequence[]>(repoRoot, DECISION_OUTPUT_FILES.consequences);
  const rawLinks = readDecisionCachedJsonOptional<DecisionLink[]>(repoRoot, DECISION_OUTPUT_FILES.decisionLinks);

  const decision: RawDecisionArtifact | undefined = decisionsFile
    ? { repository_id: decisionSnapshot?.repository_id, decisions: decisionsFile.decisions }
    : undefined;
  const decisionAssumptions: RawDecisionAssumptionsArtifact | undefined = rawAssumptions ? { assumptions: rawAssumptions } : undefined;
  const decisionConsequences: RawDecisionConsequencesArtifact | undefined = rawConsequences ? { consequences: rawConsequences } : undefined;
  const decisionLinks: RawDecisionLinksArtifact | undefined = rawLinks ? { links: rawLinks } : undefined;

  const input: KnowledgeGraphBuildInput = {
    repositoryIdHint: resolveRepositoryIdHint(repoRoot),
    architecture,
    capability,
    product,
    portfolio,
    governance,
    decision,
    decisionAssumptions,
    decisionConsequences,
    decisionLinks,
  };

  const buildResult = buildKnowledgeGraph(input);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);
  const rootCauseGroups = groupRootCauses(buildResult.nodes, buildResult.edges);
  const validationFindings = validateGraph(buildResult, rootCauseGroups);

  const narrative = buildKnowledgeGraphNarrative({
    snapshot: buildResult.snapshot,
    nodes: buildResult.nodes,
    edges: buildResult.edges,
    rootCauseGroups,
    validationFindings,
    generatedAt,
  });

  const plan = buildKnowledgeGraphPlan({
    snapshot: buildResult.snapshot,
    narrative,
    nodes: buildResult.nodes,
    edges: buildResult.edges,
    rootCauseGroups,
    validationFindings,
    generatedAt,
  });

  // --- Report ---
  // No single builder function exists for a "GraphReport" contract in
  // @rvs/knowledge-graph (mirroring decisions-analyze.ts's identical
  // "no single builder function exists for DecisionIntelligenceReport"
  // precedent) -- hand-assembled here from the pieces above.
  const report: GraphReport = {
    schema_version: 1,
    id: buildReportId(buildResult.snapshot.id),
    generated_at: generatedAt,
    snapshot_id: buildResult.snapshot.id,
    repository_id: buildResult.repository_id,
    compatibility_status: buildResult.compatibility.status,
    node_count: buildResult.nodes.length,
    edge_count: buildResult.edges.length,
    nodes_by_type: countByKey<KnowledgeNodeType>(buildResult.nodes.map((node) => node.node_type)),
    edges_by_type: countByKey<KnowledgeEdgeType>(buildResult.edges.map((edge) => edge.edge_type)),
    root_cause_groups_by_classification: countByKey(rootCauseGroups.map((group) => group.classification)),
    validation_finding_count: validationFindings.length,
    validation_blocking_count: validationFindings.filter((finding) => finding.blocking).length,
  };

  writeGraphOutputs(repoRoot, {
    graphSnapshot: buildResult.snapshot,
    nodes: buildResult.nodes,
    edges: buildResult.edges,
    unresolvedLinks: buildResult.unresolved_reference_node_ids,
    rootCauseGroups,
    graphNarrative: narrative,
    graphPlan: plan,
    graphReport: report,
  });

  return { buildResult, decisionStateLookup, rootCauseGroups, validationFindings, narrative, plan, report };
}

export async function runGraphBuildCommand(repoRoot: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  const result = await runGraphBuild(repoRoot, logger);
  logger.info(
    `Built knowledge graph "${result.buildResult.snapshot.id}" for repository "${result.buildResult.repository_id}": ` +
      `${result.buildResult.nodes.length} node(s), ${result.buildResult.edges.length} edge(s), compatibility "${result.buildResult.compatibility.status}", ` +
      `${result.rootCauseGroups.length} root-cause group(s), ${result.validationFindings.length} validation finding(s).`,
  );
  logger.info(`Wrote .rvs/cache/knowledge-graph/*.json.`);
}
