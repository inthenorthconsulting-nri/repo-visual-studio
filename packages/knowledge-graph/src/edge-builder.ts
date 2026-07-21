// Extracts KnowledgeEdges strictly from each upstream artifact's own
// already-computed relationships -- never inferred from a shared word,
// title, or path. Every interface here is a LOCAL STRUCTURAL ECHO (see
// node-builder.ts's header comment for the full rationale; the same
// zero-cross-import convention applies here).
//
// This module does NOT verify that from_node_id/to_node_id actually exist
// in the final node set -- that cross-check, and the promotion of any
// dangling endpoint into an `unresolved_reference` node, is graph-builder.ts's
// job (pipeline step 6), kept separate so edge-builder.ts stays a pure
// per-domain extraction layer, mirroring node-builder.ts's own scope.
//
// Known, disclosed scope trims: capability-intelligence's `actors`/
// `externalSystems` id-reference arrays and governance's `GovernanceBaseline`
// are not read here -- neither architecture-intelligence's actors/external
// systems nor governance's baseline internals map to a node type this
// package creates edges toward beyond the baseline node itself (which
// node-builder.ts already creates with no further-linkable fields
// confirmed). `GovernanceFinding.result`'s exact enum values were not
// independently re-verified this session, so `violates` is never asserted
// from it; only the always-present, already-typed `policy_id` link is used.

import type { EvidenceRef, KnowledgeEdge, KnowledgeEdgeType, EdgeResolutionStatus, UpstreamSourceArtifact } from "./contracts.js";
import { buildEdgeId } from "./ids.js";
import { resolveNodeIdForEntity } from "./identity.js";
import type {
  ArchitectureArtifactEcho,
  CapabilityArtifactEcho,
  ProductArtifactEcho,
  PortfolioArtifactEcho,
  GovernanceArtifactEcho,
  DecisionArtifactEcho,
  DecisionAssumptionsArtifactEcho,
  DecisionConsequencesArtifactEcho,
} from "./node-builder.js";

interface UpstreamEvidenceReference {
  path?: string;
  lines?: string;
}

interface UpstreamEvidenceReferenceWithArtifact extends UpstreamEvidenceReference {
  source_artifact?: string;
}

function toEvidenceRefs(
  sourceArtifact: UpstreamSourceArtifact,
  refs: readonly UpstreamEvidenceReference[] | undefined,
): EvidenceRef[] {
  if (!refs) return [];
  return refs.map((ref) => ({ path: ref.path, lines: ref.lines, source_artifact: sourceArtifact }));
}

function passThroughEvidenceRefs(refs: readonly UpstreamEvidenceReferenceWithArtifact[] | undefined): EvidenceRef[] {
  if (!refs) return [];
  return refs.map((ref) => ({
    path: ref.path,
    lines: ref.lines,
    source_artifact: (ref.source_artifact as UpstreamSourceArtifact | "repository" | undefined) ?? undefined,
  }));
}

function makeEdge(params: {
  edgeType: KnowledgeEdgeType;
  fromEntityId: string;
  toEntityId: string;
  detail: string;
  evidenceRefs?: EvidenceRef[];
  resolutionStatus?: EdgeResolutionStatus;
}): KnowledgeEdge {
  const fromNodeId = resolveNodeIdForEntity(params.fromEntityId);
  const toNodeId = resolveNodeIdForEntity(params.toEntityId);
  return {
    id: buildEdgeId(params.edgeType, fromNodeId, toNodeId),
    edge_type: params.edgeType,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    direction: "directed",
    evidence_refs: params.evidenceRefs ?? [],
    resolution_status: params.resolutionStatus ?? "resolved",
    detail: params.detail,
  };
}

// ---------------------------------------------------------------------------
// Architecture -- repository contains component, flow-derived invocation
// edges
// ---------------------------------------------------------------------------

export function buildArchitectureContainmentEdges(architecture: ArchitectureArtifactEcho | undefined): KnowledgeEdge[] {
  if (!architecture?.identity || !architecture.components) return [];
  const repositoryId = architecture.identity.id;
  return architecture.components.map((component) =>
    makeEdge({
      edgeType: "contains",
      fromEntityId: repositoryId,
      toEntityId: component.id,
      detail: "Repository's architecture intelligence lists this component in its own components array.",
    }),
  );
}

export interface ArchitectureFlowEcho {
  flows?: Array<{
    id: string;
    label?: string;
    fromId: string;
    toId: string;
    evidence?: UpstreamEvidenceReference[];
  }>;
}

export function buildArchitectureFlowEdges(architecture: ArchitectureFlowEcho | undefined): KnowledgeEdge[] {
  if (!architecture?.flows) return [];
  return architecture.flows.map((flow) =>
    makeEdge({
      edgeType: "invokes",
      fromEntityId: flow.fromId,
      toEntityId: flow.toId,
      detail: flow.label ?? `Architecture flow ${flow.id}`,
      evidenceRefs: toEvidenceRefs("architecture", flow.evidence),
    }),
  );
}

// ---------------------------------------------------------------------------
// Capability -- capability<->component/workflow, domain<->capability
// ---------------------------------------------------------------------------

export interface CapabilityLinkArtifactEcho {
  domains?: Array<{ id: string }>;
  includedCapabilities?: CapabilityLinkEcho[];
  qualifiedCapabilities?: CapabilityLinkEcho[];
  roadmapCapabilities?: CapabilityLinkEcho[];
  gapCapabilities?: CapabilityLinkEcho[];
  unresolvedCapabilities?: CapabilityLinkEcho[];
}

interface CapabilityLinkEcho {
  id: string;
  domainId?: string;
  logicalComponents?: string[];
  workflows?: string[];
}

export function buildCapabilityRelationshipEdges(capability: CapabilityLinkArtifactEcho | undefined): KnowledgeEdge[] {
  if (!capability) return [];
  const allCapabilities = [
    ...(capability.includedCapabilities ?? []),
    ...(capability.qualifiedCapabilities ?? []),
    ...(capability.roadmapCapabilities ?? []),
    ...(capability.gapCapabilities ?? []),
    ...(capability.unresolvedCapabilities ?? []),
  ];
  const edges: KnowledgeEdge[] = [];
  for (const cap of allCapabilities) {
    if (cap.domainId) {
      edges.push(
        makeEdge({
          edgeType: "contains",
          fromEntityId: cap.domainId,
          toEntityId: cap.id,
          detail: "capability-intelligence's own domainId assigns this capability to this domain.",
        }),
      );
    }
    for (const componentId of cap.logicalComponents ?? []) {
      edges.push(
        makeEdge({
          edgeType: "depends_on",
          fromEntityId: cap.id,
          toEntityId: componentId,
          detail: "capability-intelligence's own logicalComponents link ties this capability to this component.",
        }),
      );
    }
    for (const workflowId of cap.workflows ?? []) {
      edges.push(
        makeEdge({
          edgeType: "depends_on",
          fromEntityId: cap.id,
          toEntityId: workflowId,
          detail: "capability-intelligence's own workflows link ties this capability to this workflow.",
        }),
      );
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Product -- single product identity requires capabilities
// ---------------------------------------------------------------------------

export interface ProductCapabilityLinkArtifactEcho {
  identity?: { currentCapabilities?: string[]; qualifiedCapabilities?: string[] };
}

export function buildProductRequiresCapabilityEdges(
  product: ProductCapabilityLinkArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeEdge[] {
  if (!product?.identity) return [];
  const productEntityId = `product-identity:${repositoryId}`;
  const capabilityIds = [
    ...(product.identity.currentCapabilities ?? []),
    ...(product.identity.qualifiedCapabilities ?? []),
  ];
  return capabilityIds.map((capabilityId) =>
    makeEdge({
      edgeType: "requires",
      fromEntityId: productEntityId,
      toEntityId: capabilityId,
      detail: "product-intelligence's own currentCapabilities/qualifiedCapabilities link.",
    }),
  );
}

// ---------------------------------------------------------------------------
// Portfolio -- product requires capability (per-product view), product
// relationships, dependency graph
// ---------------------------------------------------------------------------

export interface PortfolioLinkArtifactEcho {
  products?: Array<{ id: string; currentCapabilityIds?: string[]; qualifiedCapabilityIds?: string[] }>;
  relationships?: PortfolioRelationshipLinkEcho[];
  unresolvedRelationships?: PortfolioRelationshipLinkEcho[];
  dependencyGraph?: { edges?: Array<{ id: string; kind: string; sourceProductId: string; targetId: string }> };
}

interface PortfolioRelationshipLinkEcho {
  id: string;
  productAId: string;
  productBId: string;
  type?: string;
}

export function buildPortfolioProductCapabilityEdges(portfolio: PortfolioLinkArtifactEcho | undefined): KnowledgeEdge[] {
  if (!portfolio?.products) return [];
  const edges: KnowledgeEdge[] = [];
  for (const product of portfolio.products) {
    const capabilityIds = [...(product.currentCapabilityIds ?? []), ...(product.qualifiedCapabilityIds ?? [])];
    for (const capabilityId of capabilityIds) {
      edges.push(
        makeEdge({
          edgeType: "requires",
          fromEntityId: product.id,
          toEntityId: capabilityId,
          detail: "portfolio-intelligence's own currentCapabilityIds/qualifiedCapabilityIds link.",
        }),
      );
    }
  }
  return edges;
}

/** portfolio_relationship nodes reference the two products they connect -- two "references" edges per relationship rather than a single product-to-product edge, since the relationship is itself a first-class graph node (see node-builder.ts). */
export function buildPortfolioRelationshipReferenceEdges(portfolio: PortfolioLinkArtifactEcho | undefined): KnowledgeEdge[] {
  if (!portfolio) return [];
  const edges: KnowledgeEdge[] = [];
  const groups: Array<{ list: PortfolioRelationshipLinkEcho[] | undefined; resolutionStatus: EdgeResolutionStatus }> = [
    { list: portfolio.relationships, resolutionStatus: "resolved" },
    { list: portfolio.unresolvedRelationships, resolutionStatus: "unresolved" },
  ];
  for (const group of groups) {
    for (const relationship of group.list ?? []) {
      edges.push(
        makeEdge({
          edgeType: "references",
          fromEntityId: relationship.id,
          toEntityId: relationship.productAId,
          detail: relationship.type ?? "portfolio relationship endpoint A",
          resolutionStatus: group.resolutionStatus,
        }),
      );
      edges.push(
        makeEdge({
          edgeType: "references",
          fromEntityId: relationship.id,
          toEntityId: relationship.productBId,
          detail: relationship.type ?? "portfolio relationship endpoint B",
          resolutionStatus: group.resolutionStatus,
        }),
      );
    }
  }
  return edges;
}

/**
 * PortfolioDependencyEdge.kind's exact enum values were not independently
 * re-verified this session, so every dependency-graph edge is conservatively
 * mapped to the generic `depends_on` edge type with the upstream kind string
 * preserved verbatim in `detail`, rather than guessing a more specific
 * mapping that could misrepresent the relationship.
 */
export function buildPortfolioDependencyGraphEdges(portfolio: PortfolioLinkArtifactEcho | undefined): KnowledgeEdge[] {
  if (!portfolio?.dependencyGraph?.edges) return [];
  return portfolio.dependencyGraph.edges.map((edge) =>
    makeEdge({
      edgeType: "depends_on",
      fromEntityId: edge.sourceProductId,
      toEntityId: edge.targetId,
      detail: `portfolio dependency graph edge kind: ${edge.kind}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Governance -- policy governs finding, finding affects entities
// ---------------------------------------------------------------------------

export interface GovernanceLinkArtifactEcho {
  findings?: Array<{
    id: string;
    policy_id: string;
    affected_entity_ids?: string[];
    evidence_refs?: UpstreamEvidenceReferenceWithArtifact[];
  }>;
}

export function buildGovernanceEdges(governance: GovernanceLinkArtifactEcho | undefined): KnowledgeEdge[] {
  if (!governance?.findings) return [];
  const edges: KnowledgeEdge[] = [];
  for (const finding of governance.findings) {
    edges.push(
      makeEdge({
        edgeType: "governs",
        fromEntityId: finding.policy_id,
        toEntityId: finding.id,
        detail: "governance-intelligence's own policy_id link produced this finding.",
      }),
    );
    for (const entityId of finding.affected_entity_ids ?? []) {
      edges.push(
        makeEdge({
          edgeType: "affects",
          fromEntityId: finding.id,
          toEntityId: entityId,
          detail: "governance-intelligence's own affected_entity_ids link.",
          evidenceRefs: passThroughEvidenceRefs(finding.evidence_refs),
        }),
      );
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Decision -- supersession, decision->assumption, decision->consequence,
// decision links to other domains
// ---------------------------------------------------------------------------

export interface DecisionSupersessionArtifactEcho {
  decisions?: Array<{ id: string; supersedes?: string[]; evidence_refs?: UpstreamEvidenceReferenceWithArtifact[] }>;
}

export function buildDecisionSupersessionEdges(decision: DecisionSupersessionArtifactEcho | undefined): KnowledgeEdge[] {
  if (!decision?.decisions) return [];
  const edges: KnowledgeEdge[] = [];
  for (const entry of decision.decisions) {
    for (const supersededId of entry.supersedes ?? []) {
      edges.push(
        makeEdge({
          edgeType: "supersedes",
          fromEntityId: entry.id,
          toEntityId: supersededId,
          detail: "decision-intelligence's own supersedes link.",
          evidenceRefs: passThroughEvidenceRefs(entry.evidence_refs),
        }),
      );
    }
  }
  return edges;
}

export function buildDecisionAssumptionEdges(assumptions: DecisionAssumptionsArtifactEcho | undefined): KnowledgeEdge[] {
  if (!assumptions?.assumptions) return [];
  return assumptions.assumptions.map((assumption) =>
    makeEdge({
      edgeType: "requires",
      fromEntityId: assumption.decision_id,
      toEntityId: assumption.id,
      detail: "decision-intelligence's own decision_id link on this assumption.",
    }),
  );
}

export function buildDecisionConsequenceEdges(consequences: DecisionConsequencesArtifactEcho | undefined): KnowledgeEdge[] {
  if (!consequences?.consequences) return [];
  return consequences.consequences.map((consequence) =>
    makeEdge({
      edgeType: "produces",
      fromEntityId: consequence.decision_id,
      toEntityId: consequence.id,
      detail: "decision-intelligence's own decision_id link on this consequence.",
    }),
  );
}

export interface DecisionLinksArtifactEcho {
  links?: Array<{
    id: string;
    decision_id: string;
    target_id?: string;
    link_type?: string;
    resolution?: string;
    detail?: string;
    evidence_refs?: UpstreamEvidenceReferenceWithArtifact[];
  }>;
}

const KNOWN_EDGE_RESOLUTION_STATUSES: EdgeResolutionStatus[] = ["resolved", "unresolved", "partial", "ambiguous", "incompatible"];

/**
 * decision-intelligence's own decision-links.json is already resolved
 * against target entities -- consumed verbatim, never re-derived. Every
 * link becomes a generic `references` edge (link_type's exact enum values
 * were not independently re-verified this session) with the upstream
 * link_type preserved in `detail`; links with no target_id are skipped
 * since there is nothing to point the edge at.
 */
export function buildDecisionLinkEdges(decisionLinks: DecisionLinksArtifactEcho | undefined): KnowledgeEdge[] {
  if (!decisionLinks?.links) return [];
  const edges: KnowledgeEdge[] = [];
  for (const link of decisionLinks.links) {
    if (!link.target_id) continue;
    const resolutionStatus = KNOWN_EDGE_RESOLUTION_STATUSES.includes(link.resolution as EdgeResolutionStatus)
      ? (link.resolution as EdgeResolutionStatus)
      : "partial";
    edges.push(
      makeEdge({
        edgeType: "references",
        fromEntityId: link.decision_id,
        toEntityId: link.target_id,
        detail: link.detail ?? `decision link type: ${link.link_type ?? "unknown"}`,
        evidenceRefs: passThroughEvidenceRefs(link.evidence_refs),
        resolutionStatus,
      }),
    );
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Cross-layer -- evidenced_by edges from already-id-bearing evidence arrays
// (see node-builder.ts's buildEvidenceNodes for which evidence entries
// become nodes)
// ---------------------------------------------------------------------------

export function buildEvidencedByEdges(
  capability: CapabilityArtifactEcho | undefined,
  product: ProductArtifactEcho | undefined,
  portfolio: PortfolioArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];

  const allCapabilities = [
    ...(capability?.includedCapabilities ?? []),
    ...(capability?.qualifiedCapabilities ?? []),
    ...(capability?.roadmapCapabilities ?? []),
    ...(capability?.gapCapabilities ?? []),
    ...(capability?.unresolvedCapabilities ?? []),
  ];
  for (const cap of allCapabilities) {
    for (const evidence of cap.evidence ?? []) {
      edges.push(
        makeEdge({
          edgeType: "evidenced_by",
          fromEntityId: cap.id,
          toEntityId: evidence.id,
          detail: "capability-intelligence's own evidence array.",
        }),
      );
    }
  }

  if (product?.identity) {
    const productEntityId = `product-identity:${repositoryId}`;
    for (const evidence of product.identity.evidence ?? []) {
      edges.push(
        makeEdge({
          edgeType: "evidenced_by",
          fromEntityId: productEntityId,
          toEntityId: evidence.id,
          detail: "product-intelligence's own evidence array.",
        }),
      );
    }
  }

  const evidenceById = new Map((portfolio?.evidence ?? []).map((entry) => [entry.id, entry]));
  for (const relationship of [...(portfolio?.relationships ?? []), ...(portfolio?.unresolvedRelationships ?? [])]) {
    for (const evidenceId of relationship.evidenceIds ?? []) {
      if (!evidenceById.has(evidenceId)) continue;
      edges.push(
        makeEdge({
          edgeType: "evidenced_by",
          fromEntityId: relationship.id,
          toEntityId: evidenceId,
          detail: "portfolio-intelligence's own relationship evidenceIds array.",
        }),
      );
    }
  }

  return edges;
}
