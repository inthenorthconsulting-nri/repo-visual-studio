// Orchestrates the 8-step graph-construction pipeline described in the
// Milestone 9 plan:
//   1. Load compatible upstream artifacts (all six optional).
//   2. Validate schema version + repository identity (compatibility.ts).
//   3. Normalize entity identities (identity.ts).
//   4. Create nodes (node-builder.ts).
//   5. Create typed edges (edge-builder.ts).
//   6. Preserve unresolved references (dangling edge endpoints become
//      `unresolved_reference` nodes, never silently dropped).
//   7. Detect duplicate and contradictory edges.
//   8. Deterministic ordering + snapshot digest (snapshot.ts).
//
// Steps 3 and 4 run in the practical order candidate-nodes-then-dedupe
// (identity.ts's deduplicateNodes operates on already-built KnowledgeNode
// candidates, not raw upstream records) -- the plan's own step numbering is
// preserved in comments below for traceability, not in literal call order.

import type {
  CompatibilityAssessment,
  EdgeResolutionStatus,
  EvidenceRef,
  GraphSnapshot,
  KnowledgeEdge,
  KnowledgeNode,
  UpstreamArtifactDigest,
  UpstreamSourceArtifact,
} from "./contracts.js";
import { assessGraphCompatibility, type LoadedArtifactInfo } from "./compatibility.js";
import { deduplicateNodes, type IdentityCollision } from "./identity.js";
import { buildGraphSnapshot, buildUpstreamArtifactDigest } from "./snapshot.js";
import * as nodeBuilder from "./node-builder.js";
import * as edgeBuilder from "./edge-builder.js";

// ---------------------------------------------------------------------------
// Raw input shapes -- each is a superset union of every field the
// corresponding node-builder.ts / edge-builder.ts functions read from that
// same upstream JSON document, so the identical raw object can be passed to
// both without narrowing.
// ---------------------------------------------------------------------------

export interface RawArchitectureArtifact {
  identity?: {
    id: string;
    name?: { displayLabel?: string; sourceLabel?: string };
    evidence?: Array<{ path?: string; lines?: string }>;
  };
  components?: Array<{
    id: string;
    label?: { displayLabel?: string; sourceLabel?: string };
    evidence?: Array<{ path?: string; lines?: string }>;
    implementation?: { entryPoints?: string[] };
  }>;
  workflowFamilies?: Array<{ id: string; label?: { displayLabel?: string; sourceLabel?: string } }>;
  flows?: Array<{ id: string; label?: string; fromId: string; toId: string; evidence?: Array<{ path?: string; lines?: string }> }>;
}

export interface RawCapabilityArtifact {
  domains?: Array<{ id: string; displayName?: string }>;
  includedCapabilities?: RawCapability[];
  qualifiedCapabilities?: RawCapability[];
  roadmapCapabilities?: RawCapability[];
  gapCapabilities?: RawCapability[];
  unresolvedCapabilities?: RawCapability[];
}

interface RawCapability {
  id: string;
  displayName?: string;
  domainId?: string;
  logicalComponents?: string[];
  workflows?: string[];
  evidence?: Array<{ id: string; sourcePath?: string; description?: string }>;
}

export interface RawProductArtifact {
  identity?: {
    displayName?: string;
    currentCapabilities?: string[];
    qualifiedCapabilities?: string[];
    evidence?: Array<{ id: string; sourcePath?: string; text?: string }>;
  };
}

export interface RawPortfolioArtifact {
  products?: Array<{ id: string; displayName?: string; currentCapabilityIds?: string[]; qualifiedCapabilityIds?: string[] }>;
  relationships?: Array<{ id: string; productAId: string; productBId: string; type?: string; statement?: string; evidenceIds?: string[] }>;
  unresolvedRelationships?: Array<{ id: string; productAId: string; productBId: string; type?: string; statement?: string; evidenceIds?: string[] }>;
  dependencyGraph?: { edges?: Array<{ id: string; kind: string; sourceProductId: string; targetId: string }> };
  evidence?: Array<{ id: string; text?: string }>;
}

export interface RawGovernanceArtifact {
  repository_id?: string;
  policies?: Array<{ id: string; name?: string }>;
  findings?: Array<{
    id: string;
    policy_id: string;
    statement?: string;
    affected_entity_ids?: string[];
    evidence_refs?: Array<{ path?: string; lines?: string; source_artifact?: string }>;
  }>;
  baseline?: { id: string };
}

export interface RawDecisionArtifact {
  repository_id?: string;
  decisions?: Array<{
    id: string;
    title?: string;
    supersedes?: string[];
    evidence_refs?: Array<{ path?: string; lines?: string; source_artifact?: string }>;
  }>;
}

export interface RawDecisionAssumptionsArtifact {
  assumptions?: Array<{
    id: string;
    decision_id: string;
    statement?: string;
    evidence_refs?: Array<{ path?: string; lines?: string; source_artifact?: string }>;
  }>;
}

export interface RawDecisionConsequencesArtifact {
  consequences?: Array<{
    id: string;
    decision_id: string;
    statement?: string;
    evidence_refs?: Array<{ path?: string; lines?: string; source_artifact?: string }>;
  }>;
}

export interface RawDecisionLinksArtifact {
  links?: Array<{
    id: string;
    decision_id: string;
    target_id?: string;
    link_type?: string;
    resolution?: string;
    detail?: string;
    evidence_refs?: Array<{ path?: string; lines?: string; source_artifact?: string }>;
  }>;
}

export interface ArtifactMetaEntry {
  schema_version?: number;
  source_generated_at?: string;
  snapshot_id?: string;
}

export interface KnowledgeGraphBuildInput {
  /** Fallback repository identity, supplied by the caller (e.g. the CLI, which knows repoRoot), used only when no upstream artifact carries its own repository identity field. */
  repositoryIdHint?: string;
  architecture?: RawArchitectureArtifact;
  capability?: RawCapabilityArtifact;
  product?: RawProductArtifact;
  portfolio?: RawPortfolioArtifact;
  governance?: RawGovernanceArtifact;
  decision?: RawDecisionArtifact;
  decisionAssumptions?: RawDecisionAssumptionsArtifact;
  decisionConsequences?: RawDecisionConsequencesArtifact;
  decisionLinks?: RawDecisionLinksArtifact;
  artifactMeta?: Partial<Record<UpstreamSourceArtifact, ArtifactMetaEntry>>;
}

export interface DuplicateEdgeFinding {
  edge_key: string;
  edge_id: string;
  conflicting_details: string[];
  conflicting_resolution_statuses: EdgeResolutionStatus[];
}

export interface KnowledgeGraphBuildResult {
  repository_id: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  compatibility: CompatibilityAssessment;
  identity_collisions: IdentityCollision[];
  duplicate_edge_findings: DuplicateEdgeFinding[];
  unresolved_reference_node_ids: string[];
  snapshot: GraphSnapshot;
}

const ALL_SOURCE_ARTIFACTS: UpstreamSourceArtifact[] = ["architecture", "capability", "product", "portfolio", "governance", "decision"];

function resolveRepositoryId(input: KnowledgeGraphBuildInput): string {
  const fromArchitecture = input.architecture?.identity?.id;
  const fromGovernance = input.governance?.repository_id;
  const fromDecision = input.decision?.repository_id;
  const repositoryId = fromArchitecture ?? fromGovernance ?? fromDecision ?? input.repositoryIdHint;
  if (!repositoryId) {
    throw new Error(
      "Unable to resolve a repository identity from any upstream artifact (architecture.identity.id, governance.repository_id, decision.repository_id) or a caller-supplied repositoryIdHint. Cannot build a knowledge graph.",
    );
  }
  return repositoryId;
}

/** Step 2: staged compatibility assessment across every present artifact. */
function buildCompatibility(input: KnowledgeGraphBuildInput): CompatibilityAssessment {
  const meta = input.artifactMeta ?? {};
  const repositoryIdByArtifact: Partial<Record<UpstreamSourceArtifact, string | undefined>> = {
    architecture: input.architecture?.identity?.id,
    governance: input.governance?.repository_id,
    decision: input.decision?.repository_id,
  };
  const artifacts: LoadedArtifactInfo[] = ALL_SOURCE_ARTIFACTS.map((sourceArtifact) => {
    const present = Boolean(input[sourceArtifact]);
    return {
      source_artifact: sourceArtifact,
      present,
      repository_id: repositoryIdByArtifact[sourceArtifact],
      schema_version: meta[sourceArtifact]?.schema_version,
      source_generated_at: meta[sourceArtifact]?.source_generated_at,
    };
  });
  return assessGraphCompatibility(artifacts);
}

/** Steps 3-4: build every domain's candidate nodes, then dedupe by (source_artifact, source_entity_id). */
function buildAllNodes(input: KnowledgeGraphBuildInput, repositoryId: string): { nodes: KnowledgeNode[]; collisions: IdentityCollision[] } {
  const candidates: KnowledgeNode[] = [];

  const repositoryNode = nodeBuilder.buildRepositoryNode(input.architecture, repositoryId);
  if (repositoryNode) candidates.push(repositoryNode);
  candidates.push(...nodeBuilder.buildComponentNodes(input.architecture, repositoryId));
  candidates.push(...nodeBuilder.buildWorkflowNodes(input.architecture, repositoryId));
  candidates.push(...nodeBuilder.buildRuntimeEntrypointNodes(input.architecture, repositoryId));

  candidates.push(...nodeBuilder.buildCapabilityDomainNodes(input.capability, repositoryId));
  candidates.push(...nodeBuilder.buildCapabilityNodes(input.capability, repositoryId));

  const productNode = nodeBuilder.buildProductIdentityNode(input.product, repositoryId);
  if (productNode) candidates.push(productNode);

  candidates.push(...nodeBuilder.buildPortfolioProductNodes(input.portfolio, repositoryId));
  candidates.push(...nodeBuilder.buildPortfolioRelationshipNodes(input.portfolio, repositoryId));

  candidates.push(...nodeBuilder.buildPolicyNodes(input.governance, repositoryId));
  candidates.push(...nodeBuilder.buildGovernanceFindingNodes(input.governance, repositoryId));
  const baselineNode = nodeBuilder.buildBaselineNode(input.governance, repositoryId);
  if (baselineNode) candidates.push(baselineNode);

  candidates.push(...nodeBuilder.buildDecisionNodes(input.decision, repositoryId));
  candidates.push(...nodeBuilder.buildDecisionAssumptionNodes(input.decisionAssumptions, repositoryId));
  candidates.push(...nodeBuilder.buildDecisionConsequenceNodes(input.decisionConsequences, repositoryId));

  candidates.push(...nodeBuilder.buildEvidenceNodes(input.capability, input.product, input.portfolio, repositoryId));

  return deduplicateNodes(candidates);
}

interface DomainTaggedEdges {
  sourceArtifact: UpstreamSourceArtifact;
  edges: KnowledgeEdge[];
}

/** Step 5: build every domain's candidate edges, tagged by originating domain (used in step 6 to attribute unresolved_reference nodes). */
function buildAllEdges(input: KnowledgeGraphBuildInput, repositoryId: string): DomainTaggedEdges[] {
  return [
    {
      sourceArtifact: "architecture",
      edges: [
        ...edgeBuilder.buildArchitectureContainmentEdges(input.architecture),
        ...edgeBuilder.buildArchitectureFlowEdges(input.architecture),
      ],
    },
    { sourceArtifact: "capability", edges: edgeBuilder.buildCapabilityRelationshipEdges(input.capability) },
    { sourceArtifact: "product", edges: edgeBuilder.buildProductRequiresCapabilityEdges(input.product, repositoryId) },
    {
      sourceArtifact: "portfolio",
      edges: [
        ...edgeBuilder.buildPortfolioProductCapabilityEdges(input.portfolio),
        ...edgeBuilder.buildPortfolioRelationshipReferenceEdges(input.portfolio),
        ...edgeBuilder.buildPortfolioDependencyGraphEdges(input.portfolio),
      ],
    },
    { sourceArtifact: "governance", edges: edgeBuilder.buildGovernanceEdges(input.governance) },
    {
      sourceArtifact: "decision",
      edges: [
        ...edgeBuilder.buildDecisionSupersessionEdges(input.decision),
        ...edgeBuilder.buildDecisionAssumptionEdges(input.decisionAssumptions),
        ...edgeBuilder.buildDecisionConsequenceEdges(input.decisionConsequences),
        ...edgeBuilder.buildDecisionLinkEdges(input.decisionLinks),
      ],
    },
    {
      sourceArtifact: "capability",
      edges: edgeBuilder.buildEvidencedByEdges(input.capability, input.product, input.portfolio, repositoryId),
    },
  ];
}

/** Step 7: same (from, to, edge_type) id collapses to one edge; identical resolution_status+detail merges silently (evidence union), differing resolution_status/detail is kept as one edge (first-encountered, stable input order) plus a recorded contradiction finding. */
function dedupeEdges(edges: KnowledgeEdge[]): { edges: KnowledgeEdge[]; duplicateEdgeFindings: DuplicateEdgeFinding[] } {
  const groups = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges) {
    const group = groups.get(edge.id) ?? [];
    group.push(edge);
    groups.set(edge.id, group);
  }

  const dedupedEdges: KnowledgeEdge[] = [];
  const duplicateEdgeFindings: DuplicateEdgeFinding[] = [];

  for (const [edgeId, group] of groups) {
    if (group.length === 1) {
      dedupedEdges.push(group[0]!);
      continue;
    }
    const details = new Set(group.map((edge) => edge.detail));
    const statuses = new Set(group.map((edge) => edge.resolution_status));
    const mergedEvidence: EvidenceRef[] = [];
    const seenEvidence = new Set<string>();
    for (const edge of group) {
      for (const ref of edge.evidence_refs) {
        const key = JSON.stringify(ref);
        if (!seenEvidence.has(key)) {
          seenEvidence.add(key);
          mergedEvidence.push(ref);
        }
      }
    }
    const primary = group[0]!;
    dedupedEdges.push({ ...primary, evidence_refs: mergedEvidence });
    if (details.size > 1 || statuses.size > 1) {
      duplicateEdgeFindings.push({
        edge_key: edgeId,
        edge_id: edgeId,
        conflicting_details: Array.from(details).sort(),
        conflicting_resolution_statuses: Array.from(statuses).sort() as EdgeResolutionStatus[],
      });
    }
  }

  return { edges: dedupedEdges, duplicateEdgeFindings: duplicateEdgeFindings.sort((a, b) => (a.edge_key < b.edge_key ? -1 : 1)) };
}

/** Step 6: any edge endpoint not present in the final node set is promoted to an `unresolved_reference` node, never silently dropped; the citing edge's own resolution_status is downgraded to "unresolved" accordingly. */
function resolveUnresolvedReferences(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  edgeDomainHints: Map<string, UpstreamSourceArtifact>,
  repositoryId: string,
): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const synthesized = new Map<string, KnowledgeNode>();

  function synthesizeIfMissing(nodeId: string): void {
    if (nodeIds.has(nodeId) || synthesized.has(nodeId)) return;
    const sourceEntityId = nodeId.startsWith("graph:node:") ? nodeId.slice("graph:node:".length) : nodeId;
    const sourceArtifact = edgeDomainHints.get(nodeId) ?? "architecture";
    synthesized.set(nodeId, {
      id: nodeId,
      node_type: "unresolved_reference",
      source_artifact: sourceArtifact,
      source_entity_id: sourceEntityId,
      label: sourceEntityId,
      evidence_refs: [],
      resolution_status: "unresolved",
      schema_version: 1,
      repository_id: repositoryId,
      confidence: "unverifiable",
    });
  }

  const patchedEdges = edges.map((edge) => {
    const fromMissing = !nodeIds.has(edge.from_node_id);
    const toMissing = !nodeIds.has(edge.to_node_id);
    if (!fromMissing && !toMissing) return edge;
    synthesizeIfMissing(edge.from_node_id);
    synthesizeIfMissing(edge.to_node_id);
    return { ...edge, resolution_status: "unresolved" as const };
  });

  const allNodes = [...nodes, ...Array.from(synthesized.values())];
  return { nodes: allNodes, edges: patchedEdges };
}

function sortNodesAndEdges(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
  const sortedNodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.edge_type !== b.edge_type) return a.edge_type < b.edge_type ? -1 : 1;
    if (a.from_node_id !== b.from_node_id) return a.from_node_id < b.from_node_id ? -1 : 1;
    if (a.to_node_id !== b.to_node_id) return a.to_node_id < b.to_node_id ? -1 : 1;
    return 0;
  });
  return { nodes: sortedNodes, edges: sortedEdges };
}

export function buildKnowledgeGraph(input: KnowledgeGraphBuildInput): KnowledgeGraphBuildResult {
  const repositoryId = resolveRepositoryId(input);
  const compatibility = buildCompatibility(input);

  const { nodes: dedupedNodes, collisions } = buildAllNodes(input, repositoryId);

  const domainTaggedEdges = buildAllEdges(input, repositoryId);
  const edgeDomainHints = new Map<string, UpstreamSourceArtifact>();
  const rawEdges: KnowledgeEdge[] = [];
  for (const group of domainTaggedEdges) {
    for (const edge of group.edges) {
      edgeDomainHints.set(edge.to_node_id, group.sourceArtifact);
      edgeDomainHints.set(edge.from_node_id, group.sourceArtifact);
      rawEdges.push(edge);
    }
  }

  const { edges: dedupedEdges, duplicateEdgeFindings } = dedupeEdges(rawEdges);
  const { nodes: nodesWithUnresolved, edges: edgesWithUnresolved } = resolveUnresolvedReferences(
    dedupedNodes,
    dedupedEdges,
    edgeDomainHints,
    repositoryId,
  );

  const { nodes: finalNodes, edges: finalEdges } = sortNodesAndEdges(nodesWithUnresolved, edgesWithUnresolved);

  const meta = input.artifactMeta ?? {};
  const upstreamArtifacts: UpstreamArtifactDigest[] = ALL_SOURCE_ARTIFACTS.map((sourceArtifact) =>
    buildUpstreamArtifactDigest({
      sourceArtifact,
      present: Boolean(input[sourceArtifact]),
      snapshotId: meta[sourceArtifact]?.snapshot_id,
      schemaVersion: meta[sourceArtifact]?.schema_version,
    }),
  );

  const snapshot = buildGraphSnapshot({ repositoryId, upstreamArtifacts, nodes: finalNodes, edges: finalEdges });

  return {
    repository_id: repositoryId,
    nodes: finalNodes,
    edges: finalEdges,
    compatibility,
    identity_collisions: collisions,
    duplicate_edge_findings: duplicateEdgeFindings,
    unresolved_reference_node_ids: finalNodes
      .filter((node) => node.node_type === "unresolved_reference")
      .map((node) => node.id)
      .sort(),
    snapshot,
  };
}
