// Extracts KnowledgeNodes from each of the six upstream intelligence
// artifacts. Every interface below is a LOCAL STRUCTURAL ECHO of the real
// upstream contracts.ts shape (declaring only the fields this module reads)
// -- never an import of @rvs/architecture-intelligence,
// @rvs/capability-intelligence, @rvs/product-intelligence,
// @rvs/portfolio-intelligence, @rvs/governance-intelligence, or
// @rvs/decision-intelligence types, matching the zero-cross-import
// convention every sibling intelligence package already follows. Field names
// were verified directly against each package's own src/contracts.ts (or
// src/types.ts for architecture-intelligence) at implementation time.
//
// Known, disclosed scope trims for this milestone: "package", "command", and
// "presentation" node types are declared in contracts.ts's KnowledgeNodeType
// union but are NOT populated by this module -- none of the six upstream
// artifacts currently expose a clean, already-computed, uniquely-identified
// inventory of workspace packages, CLI commands, or presentation
// deliverables distinct from what "component"/"runtime_entrypoint" already
// cover. Populating them would require re-deriving facts the upstream layers
// never assigned a stable id to, which the extraction principle forbids.
// Presentation reach is instead covered narrowly by change-planning.ts's
// evidence-path pattern matching, exactly as the approved plan specifies.

import type { EvidenceRef, KnowledgeNode, UpstreamSourceArtifact } from "./contracts.js";
import { buildNodeId } from "./ids.js";

interface UpstreamEvidenceReference {
  path?: string;
  lines?: string;
}

interface UpstreamEvidenceReferenceWithArtifact extends UpstreamEvidenceReference {
  source_artifact?: string;
}

interface NormalizedLabelEcho {
  displayLabel?: string;
  sourceLabel?: string;
}

function labelOf(normalized: NormalizedLabelEcho | undefined, fallback: string): string {
  return normalized?.displayLabel ?? normalized?.sourceLabel ?? fallback;
}

function toEvidenceRefs(
  sourceArtifact: UpstreamSourceArtifact,
  refs: readonly UpstreamEvidenceReference[] | undefined,
): EvidenceRef[] {
  if (!refs) return [];
  return refs.map((ref) => ({ path: ref.path, lines: ref.lines, source_artifact: sourceArtifact }));
}

/** For packages (governance/decision) whose own EvidenceRef already carries source_artifact, preserved verbatim rather than overwritten with the citing domain. */
function passThroughEvidenceRefs(refs: readonly UpstreamEvidenceReferenceWithArtifact[] | undefined): EvidenceRef[] {
  if (!refs) return [];
  return refs.map((ref) => ({
    path: ref.path,
    lines: ref.lines,
    source_artifact: (ref.source_artifact as UpstreamSourceArtifact | "repository" | undefined) ?? undefined,
  }));
}

function makeNode(params: {
  nodeType: KnowledgeNode["node_type"];
  sourceArtifact: UpstreamSourceArtifact;
  sourceEntityId: string;
  label: string;
  evidenceRefs: EvidenceRef[];
  repositoryId: string;
  confidence: KnowledgeNode["confidence"];
  resolutionStatus?: KnowledgeNode["resolution_status"];
  schemaVersion?: number;
}): KnowledgeNode {
  return {
    id: buildNodeId(params.sourceEntityId),
    node_type: params.nodeType,
    source_artifact: params.sourceArtifact,
    source_entity_id: params.sourceEntityId,
    label: params.label,
    evidence_refs: params.evidenceRefs,
    resolution_status: params.resolutionStatus ?? "resolved",
    schema_version: params.schemaVersion ?? 1,
    repository_id: params.repositoryId,
    confidence: params.confidence,
  };
}

// ---------------------------------------------------------------------------
// Architecture -- repository identity, components, workflow families,
// runtime entrypoints
// ---------------------------------------------------------------------------

export interface ArchitectureArtifactEcho {
  identity?: { id: string; name?: NormalizedLabelEcho; evidence?: UpstreamEvidenceReference[] };
  components?: Array<{
    id: string;
    label?: NormalizedLabelEcho;
    evidence?: UpstreamEvidenceReference[];
    implementation?: { entryPoints?: string[] };
  }>;
  workflowFamilies?: Array<{ id: string; label?: NormalizedLabelEcho }>;
}

export function resolveRepositoryIdFromArchitecture(architecture: ArchitectureArtifactEcho | undefined): string | undefined {
  return architecture?.identity?.id;
}

export function buildRepositoryNode(
  architecture: ArchitectureArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeNode | undefined {
  if (!architecture?.identity) return undefined;
  return makeNode({
    nodeType: "repository",
    sourceArtifact: "architecture",
    sourceEntityId: architecture.identity.id,
    label: labelOf(architecture.identity.name, architecture.identity.id),
    evidenceRefs: toEvidenceRefs("architecture", architecture.identity.evidence),
    repositoryId,
    confidence: "confirmed",
  });
}

export function buildComponentNodes(architecture: ArchitectureArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!architecture?.components) return [];
  return architecture.components.map((component) =>
    makeNode({
      nodeType: "component",
      sourceArtifact: "architecture",
      sourceEntityId: component.id,
      label: labelOf(component.label, component.id),
      evidenceRefs: toEvidenceRefs("architecture", component.evidence),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

export function buildWorkflowNodes(architecture: ArchitectureArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!architecture?.workflowFamilies) return [];
  return architecture.workflowFamilies.map((family) =>
    makeNode({
      nodeType: "workflow",
      sourceArtifact: "architecture",
      sourceEntityId: family.id,
      label: labelOf(family.label, family.id),
      evidenceRefs: [],
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

/**
 * Materializes each component's already-computed `implementation.entryPoints`
 * string into its own node. The synthesized id is a pure function of the
 * owning component id + the entrypoint string itself -- never an array
 * index -- so it stays stable across reordering.
 */
export function buildRuntimeEntrypointNodes(architecture: ArchitectureArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!architecture?.components) return [];
  const nodes: KnowledgeNode[] = [];
  for (const component of architecture.components) {
    for (const entryPoint of component.implementation?.entryPoints ?? []) {
      nodes.push(
        makeNode({
          nodeType: "runtime_entrypoint",
          sourceArtifact: "architecture",
          sourceEntityId: `${component.id}#entrypoint:${entryPoint}`,
          label: entryPoint,
          evidenceRefs: toEvidenceRefs("architecture", component.evidence),
          repositoryId,
          confidence: "confirmed",
        }),
      );
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Capability -- capabilities and capability domains
// ---------------------------------------------------------------------------

export interface CapabilityArtifactEcho {
  domains?: Array<{ id: string; displayName?: string }>;
  includedCapabilities?: CapabilityEcho[];
  qualifiedCapabilities?: CapabilityEcho[];
  roadmapCapabilities?: CapabilityEcho[];
  gapCapabilities?: CapabilityEcho[];
  unresolvedCapabilities?: CapabilityEcho[];
}

interface CapabilityEcho {
  id: string;
  displayName?: string;
  evidence?: Array<{ id: string; sourcePath?: string; description?: string }>;
}

export function buildCapabilityDomainNodes(capability: CapabilityArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!capability?.domains) return [];
  return capability.domains.map((domain) =>
    makeNode({
      nodeType: "capability_domain",
      sourceArtifact: "capability",
      sourceEntityId: domain.id,
      label: domain.displayName ?? domain.id,
      evidenceRefs: [],
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

/**
 * "excludedCandidates" is deliberately never read here -- an excluded
 * candidate was explicitly rejected by capability-intelligence's own
 * inclusion policy and must never surface as a graph node.
 */
export function buildCapabilityNodes(capability: CapabilityArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!capability) return [];
  const groups: Array<{ list: CapabilityEcho[] | undefined; confidence: KnowledgeNode["confidence"] }> = [
    { list: capability.includedCapabilities, confidence: "confirmed" },
    { list: capability.qualifiedCapabilities, confidence: "qualified" },
    { list: capability.roadmapCapabilities, confidence: "unverifiable" },
    { list: capability.gapCapabilities, confidence: "unverifiable" },
    { list: capability.unresolvedCapabilities, confidence: "unverifiable" },
  ];
  const nodes: KnowledgeNode[] = [];
  for (const group of groups) {
    for (const candidate of group.list ?? []) {
      nodes.push(
        makeNode({
          nodeType: "capability",
          sourceArtifact: "capability",
          sourceEntityId: candidate.id,
          label: candidate.displayName ?? candidate.id,
          evidenceRefs: (candidate.evidence ?? []).map((evidence) => ({
            path: evidence.sourcePath,
            detail: evidence.description,
            source_artifact: "capability" as const,
          })),
          repositoryId,
          confidence: group.confidence,
        }),
      );
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Product -- single-repository product identity (no stable upstream id;
// synthesized deterministically from repository identity only)
// ---------------------------------------------------------------------------

export interface ProductArtifactEcho {
  identity?: {
    displayName?: string;
    evidence?: Array<{ id: string; sourcePath?: string; text?: string }>;
  };
}

export function buildProductIdentityNode(product: ProductArtifactEcho | undefined, repositoryId: string): KnowledgeNode | undefined {
  if (!product?.identity) return undefined;
  return makeNode({
    nodeType: "product",
    sourceArtifact: "product",
    sourceEntityId: `product-identity:${repositoryId}`,
    label: product.identity.displayName ?? repositoryId,
    evidenceRefs: (product.identity.evidence ?? []).map((evidence) => ({
      path: evidence.sourcePath,
      detail: evidence.text,
      source_artifact: "product" as const,
    })),
    repositoryId,
    confidence: "confirmed",
  });
}

// ---------------------------------------------------------------------------
// Portfolio -- multi-product view (authoritative "product" node source when
// present), product relationships
// ---------------------------------------------------------------------------

export interface PortfolioArtifactEcho {
  products?: Array<{ id: string; displayName?: string }>;
  relationships?: PortfolioRelationshipEcho[];
  unresolvedRelationships?: PortfolioRelationshipEcho[];
  evidence?: Array<{ id: string; text?: string }>;
}

interface PortfolioRelationshipEcho {
  id: string;
  productAId: string;
  productBId: string;
  statement?: string;
  evidenceIds?: string[];
}

export function buildPortfolioProductNodes(portfolio: PortfolioArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!portfolio?.products) return [];
  return portfolio.products.map((product) =>
    makeNode({
      nodeType: "product",
      sourceArtifact: "portfolio",
      sourceEntityId: product.id,
      label: product.displayName ?? product.id,
      evidenceRefs: [],
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

function resolvePortfolioEvidence(
  evidenceIds: string[] | undefined,
  evidenceById: Map<string, { text?: string }>,
): EvidenceRef[] {
  if (!evidenceIds) return [];
  return evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((entry): entry is { text?: string } => Boolean(entry))
    .map((entry) => ({ detail: entry.text, source_artifact: "portfolio" as const }));
}

export function buildPortfolioRelationshipNodes(portfolio: PortfolioArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!portfolio) return [];
  const evidenceById = new Map((portfolio.evidence ?? []).map((entry) => [entry.id, entry]));
  const relationships = [...(portfolio.relationships ?? []), ...(portfolio.unresolvedRelationships ?? [])];
  return relationships.map((relationship) =>
    makeNode({
      nodeType: "portfolio_relationship",
      sourceArtifact: "portfolio",
      sourceEntityId: relationship.id,
      label: relationship.statement ?? relationship.id,
      evidenceRefs: resolvePortfolioEvidence(relationship.evidenceIds, evidenceById),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

// ---------------------------------------------------------------------------
// Governance -- policies, findings, baseline
// ---------------------------------------------------------------------------

export interface GovernanceArtifactEcho {
  policies?: Array<{ id: string; name?: string }>;
  findings?: Array<{
    id: string;
    statement?: string;
    evidence_refs?: UpstreamEvidenceReferenceWithArtifact[];
  }>;
  baseline?: { id: string };
}

export function buildPolicyNodes(governance: GovernanceArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!governance?.policies) return [];
  return governance.policies.map((policy) =>
    makeNode({
      nodeType: "policy",
      sourceArtifact: "governance",
      sourceEntityId: policy.id,
      label: policy.name ?? policy.id,
      evidenceRefs: [],
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

export function buildGovernanceFindingNodes(governance: GovernanceArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!governance?.findings) return [];
  return governance.findings.map((finding) =>
    makeNode({
      nodeType: "governance_finding",
      sourceArtifact: "governance",
      sourceEntityId: finding.id,
      label: finding.statement ?? finding.id,
      evidenceRefs: passThroughEvidenceRefs(finding.evidence_refs),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

export function buildBaselineNode(governance: GovernanceArtifactEcho | undefined, repositoryId: string): KnowledgeNode | undefined {
  if (!governance?.baseline) return undefined;
  return makeNode({
    nodeType: "baseline",
    sourceArtifact: "governance",
    sourceEntityId: governance.baseline.id,
    label: governance.baseline.id,
    evidenceRefs: [],
    repositoryId,
    confidence: "confirmed",
  });
}

// ---------------------------------------------------------------------------
// Decision -- decisions, assumptions, consequences
// ---------------------------------------------------------------------------

export interface DecisionArtifactEcho {
  repository_id?: string;
  decisions?: Array<{ id: string; title?: string; evidence_refs?: UpstreamEvidenceReferenceWithArtifact[] }>;
}

export interface DecisionAssumptionsArtifactEcho {
  assumptions?: Array<{ id: string; decision_id: string; statement?: string; evidence_refs?: UpstreamEvidenceReferenceWithArtifact[] }>;
}

export interface DecisionConsequencesArtifactEcho {
  consequences?: Array<{ id: string; decision_id: string; statement?: string; evidence_refs?: UpstreamEvidenceReferenceWithArtifact[] }>;
}

export function buildDecisionNodes(decision: DecisionArtifactEcho | undefined, repositoryId: string): KnowledgeNode[] {
  if (!decision?.decisions) return [];
  return decision.decisions.map((entry) =>
    makeNode({
      nodeType: "decision",
      sourceArtifact: "decision",
      sourceEntityId: entry.id,
      label: entry.title ?? entry.id,
      evidenceRefs: passThroughEvidenceRefs(entry.evidence_refs),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

export function buildDecisionAssumptionNodes(
  assumptions: DecisionAssumptionsArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeNode[] {
  if (!assumptions?.assumptions) return [];
  return assumptions.assumptions.map((assumption) =>
    makeNode({
      nodeType: "decision_assumption",
      sourceArtifact: "decision",
      sourceEntityId: assumption.id,
      label: assumption.statement ?? assumption.id,
      evidenceRefs: passThroughEvidenceRefs(assumption.evidence_refs),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

export function buildDecisionConsequenceNodes(
  consequences: DecisionConsequencesArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeNode[] {
  if (!consequences?.consequences) return [];
  return consequences.consequences.map((consequence) =>
    makeNode({
      nodeType: "decision_consequence",
      sourceArtifact: "decision",
      sourceEntityId: consequence.id,
      label: consequence.statement ?? consequence.id,
      evidenceRefs: passThroughEvidenceRefs(consequence.evidence_refs),
      repositoryId,
      confidence: "confirmed",
    }),
  );
}

// ---------------------------------------------------------------------------
// Evidence nodes -- only for evidence entries the upstream artifact already
// assigned a stable id to (capability/product/portfolio evidence arrays).
// Anonymous path+lines-only references (architecture, governance, decision)
// stay embedded in citing nodes'/edges' evidence_refs and never get a
// dedicated "evidence" node, since no upstream layer assigned them an id.
// ---------------------------------------------------------------------------

export function buildEvidenceNodes(
  capability: CapabilityArtifactEcho | undefined,
  product: ProductArtifactEcho | undefined,
  portfolio: PortfolioArtifactEcho | undefined,
  repositoryId: string,
): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  const seen = new Set<string>();

  const allCapabilities = [
    ...(capability?.includedCapabilities ?? []),
    ...(capability?.qualifiedCapabilities ?? []),
    ...(capability?.roadmapCapabilities ?? []),
    ...(capability?.gapCapabilities ?? []),
    ...(capability?.unresolvedCapabilities ?? []),
  ];
  for (const cap of allCapabilities) {
    for (const evidence of cap.evidence ?? []) {
      if (seen.has(evidence.id)) continue;
      seen.add(evidence.id);
      nodes.push(
        makeNode({
          nodeType: "evidence",
          sourceArtifact: "capability",
          sourceEntityId: evidence.id,
          label: evidence.description ?? evidence.id,
          evidenceRefs: [{ path: evidence.sourcePath, source_artifact: "capability" }],
          repositoryId,
          confidence: "confirmed",
        }),
      );
    }
  }

  for (const evidence of product?.identity?.evidence ?? []) {
    if (seen.has(evidence.id)) continue;
    seen.add(evidence.id);
    nodes.push(
      makeNode({
        nodeType: "evidence",
        sourceArtifact: "product",
        sourceEntityId: evidence.id,
        label: evidence.text ?? evidence.id,
        evidenceRefs: [{ path: evidence.sourcePath, source_artifact: "product" }],
        repositoryId,
        confidence: "confirmed",
      }),
    );
  }

  for (const evidence of portfolio?.evidence ?? []) {
    if (seen.has(evidence.id)) continue;
    seen.add(evidence.id);
    nodes.push(
      makeNode({
        nodeType: "evidence",
        sourceArtifact: "portfolio",
        sourceEntityId: evidence.id,
        label: evidence.text ?? evidence.id,
        evidenceRefs: [{ source_artifact: "portfolio" }],
        repositoryId,
        confidence: "confirmed",
      }),
    );
  }

  return nodes;
}
