// Shared, hand-authored, deterministic fixtures for @rvs/knowledge-graph's
// test suite. Every id below is produced through this package's own
// ids.ts helpers (buildNodeId/buildEdgeId) so fixtures match the package's
// real id conventions. No Date.now()/Math.random()/argless `new Date()`
// anywhere in this file -- GENERATED_AT is a fixed constant, and the scale
// generator derives every id from loop counters only.

import type {
  EdgeResolutionStatus,
  EvidenceRef,
  KnowledgeEdge,
  KnowledgeEdgeType,
  KnowledgeNode,
  KnowledgeNodeType,
  ResolutionStatus,
  UpstreamArtifactDigest,
  UpstreamSourceArtifact,
} from "../contracts.js";
import { buildEdgeId, buildNodeId } from "../ids.js";
import type { DecisionStateLookup } from "../decision-impact.js";

export const GENERATED_AT = "2026-01-01T00:00:00.000Z";
export const REPOSITORY_ID = "fixture-repo";

// ---------------------------------------------------------------------------
// Low-level node/edge builders
// ---------------------------------------------------------------------------

let edgeDetailSeq = 0;

export interface NodeOverrides {
  sourceEntityId: string;
  nodeType?: KnowledgeNodeType;
  sourceArtifact?: UpstreamSourceArtifact;
  label?: string;
  evidenceRefs?: EvidenceRef[];
  resolutionStatus?: ResolutionStatus;
  confidence?: KnowledgeNode["confidence"];
  repositoryId?: string;
  schemaVersion?: number;
}

export function makeNode(overrides: NodeOverrides): KnowledgeNode {
  return {
    id: buildNodeId(overrides.sourceEntityId),
    node_type: overrides.nodeType ?? "component",
    source_artifact: overrides.sourceArtifact ?? "architecture",
    source_entity_id: overrides.sourceEntityId,
    label: overrides.label ?? overrides.sourceEntityId,
    evidence_refs: overrides.evidenceRefs ?? [],
    resolution_status: overrides.resolutionStatus ?? "resolved",
    schema_version: overrides.schemaVersion ?? 1,
    repository_id: overrides.repositoryId ?? REPOSITORY_ID,
    confidence: overrides.confidence ?? "confirmed",
  };
}

export interface EdgeOverrides {
  edgeType: KnowledgeEdgeType;
  from: KnowledgeNode | string;
  to: KnowledgeNode | string;
  detail?: string;
  evidenceRefs?: EvidenceRef[];
  resolutionStatus?: EdgeResolutionStatus;
}

function idOf(nodeOrId: KnowledgeNode | string): string {
  return typeof nodeOrId === "string" ? nodeOrId : nodeOrId.id;
}

export function makeEdge(overrides: EdgeOverrides): KnowledgeEdge {
  edgeDetailSeq += 1;
  const fromId = idOf(overrides.from);
  const toId = idOf(overrides.to);
  return {
    id: buildEdgeId(overrides.edgeType, fromId, toId),
    edge_type: overrides.edgeType,
    from_node_id: fromId,
    to_node_id: toId,
    direction: "directed",
    evidence_refs: overrides.evidenceRefs ?? [],
    resolution_status: overrides.resolutionStatus ?? "resolved",
    detail: overrides.detail ?? `fixture edge #${edgeDetailSeq}`,
  };
}

// ---------------------------------------------------------------------------
// Small hand-authored fixture sets
// ---------------------------------------------------------------------------

/** Linear dependency chain: repo contains A; A -> B -> C -> D (depends_on). */
export function linearChainFixture() {
  const repo = makeNode({ sourceEntityId: "linear-repo", nodeType: "repository" });
  const a = makeNode({ sourceEntityId: "linear-a", nodeType: "component" });
  const b = makeNode({ sourceEntityId: "linear-b", nodeType: "component" });
  const c = makeNode({ sourceEntityId: "linear-c", nodeType: "component" });
  const d = makeNode({ sourceEntityId: "linear-d", nodeType: "component" });
  const nodes = [repo, a, b, c, d];
  const edges = [
    makeEdge({ edgeType: "contains", from: repo, to: a, detail: "repo contains a" }),
    makeEdge({ edgeType: "depends_on", from: a, to: b, detail: "a depends on b" }),
    makeEdge({ edgeType: "depends_on", from: b, to: c, detail: "b depends on c" }),
    makeEdge({ edgeType: "depends_on", from: c, to: d, detail: "c depends on d" }),
  ];
  return { nodes, edges, repo, a, b, c, d };
}

/** 3-node cycle: X -> Y -> Z -> X (depends_on). */
export function cycleFixture() {
  const x = makeNode({ sourceEntityId: "cycle-x", nodeType: "component" });
  const y = makeNode({ sourceEntityId: "cycle-y", nodeType: "component" });
  const z = makeNode({ sourceEntityId: "cycle-z", nodeType: "component" });
  const nodes = [x, y, z];
  const edges = [
    makeEdge({ edgeType: "depends_on", from: x, to: y, detail: "x depends on y" }),
    makeEdge({ edgeType: "depends_on", from: y, to: z, detail: "y depends on z" }),
    makeEdge({ edgeType: "depends_on", from: z, to: x, detail: "z depends on x" }),
  ];
  return { nodes, edges, x, y, z };
}

/** Single node, zero edges. */
export function isolatedNodeFixture() {
  const solo = makeNode({ sourceEntityId: "isolated-solo", nodeType: "component" });
  return { nodes: [solo], edges: [] as KnowledgeEdge[], solo };
}

/** A resolved node pointing at a dangling reference, already promoted to an unresolved_reference node (as graph-builder.ts's own resolveUnresolvedReferences step would produce). */
export function unresolvedReferenceFixture() {
  const a = makeNode({ sourceEntityId: "unresolved-a", nodeType: "component" });
  const missingEntityId = "unresolved-missing-target";
  const missingNodeId = buildNodeId(missingEntityId);
  const unresolved = makeNode({
    sourceEntityId: missingEntityId,
    nodeType: "unresolved_reference",
    resolutionStatus: "unresolved",
    confidence: "unverifiable",
  });
  const nodes = [a, unresolved];
  const edges = [
    makeEdge({
      edgeType: "depends_on",
      from: a,
      to: unresolved,
      resolutionStatus: "unresolved",
      detail: "a depends on missing target",
    }),
  ];
  return { nodes, edges, a, unresolved, missingNodeId };
}

/**
 * Governance root-cause fixture set: five independent sub-graphs, one per
 * RootCauseClassification outcome (confirmed / probable (ambiguous) /
 * probable (partial edge) / shared_dependency_only / unresolved). Every
 * sub-graph uses disjoint node ids so groupRootCauses never accidentally
 * unions across sub-cases.
 */
export function rootCauseFixtureSet() {
  // confirmed: one consumer causally depends on both affected entities.
  const confirmedConsumer = makeNode({ sourceEntityId: "cause-confirmed-consumer", nodeType: "component" });
  const confirmedEntityA = makeNode({ sourceEntityId: "cause-confirmed-entity-a", nodeType: "component" });
  const confirmedEntityB = makeNode({ sourceEntityId: "cause-confirmed-entity-b", nodeType: "component" });
  const findingConfirmed1 = makeNode({ sourceEntityId: "finding-confirmed-1", nodeType: "governance_finding", sourceArtifact: "governance" });
  const findingConfirmed2 = makeNode({ sourceEntityId: "finding-confirmed-2", nodeType: "governance_finding", sourceArtifact: "governance" });

  // probable (ambiguous): two consumers, both depending on both entities -> two shared-root candidates.
  const probableConsumer1 = makeNode({ sourceEntityId: "cause-probable-consumer-1", nodeType: "component" });
  const probableConsumer2 = makeNode({ sourceEntityId: "cause-probable-consumer-2", nodeType: "component" });
  const probableEntityA = makeNode({ sourceEntityId: "cause-probable-entity-a", nodeType: "component" });
  const probableEntityB = makeNode({ sourceEntityId: "cause-probable-entity-b", nodeType: "component" });
  const findingProbable1 = makeNode({ sourceEntityId: "finding-probable-1", nodeType: "governance_finding", sourceArtifact: "governance" });
  const findingProbable2 = makeNode({ sourceEntityId: "finding-probable-2", nodeType: "governance_finding", sourceArtifact: "governance" });

  // probable (partial edge): single shared consumer, but one causal edge is only "partial".
  const partialConsumer = makeNode({ sourceEntityId: "cause-partial-consumer", nodeType: "component" });
  const partialEntityA = makeNode({ sourceEntityId: "cause-partial-entity-a", nodeType: "component" });
  const partialEntityB = makeNode({ sourceEntityId: "cause-partial-entity-b", nodeType: "component" });
  const findingPartial1 = makeNode({ sourceEntityId: "finding-partial-1", nodeType: "governance_finding", sourceArtifact: "governance" });
  const findingPartial2 = makeNode({ sourceEntityId: "finding-partial-2", nodeType: "governance_finding", sourceArtifact: "governance" });

  // shared_dependency_only: shared ancestor reached only via a non-causal ("references") edge.
  const sharedDepReferencer = makeNode({ sourceEntityId: "cause-shared-dep-referencer", nodeType: "component" });
  const sharedDepEntityD = makeNode({ sourceEntityId: "cause-shared-dep-entity-d", nodeType: "component" });
  const sharedDepEntityE = makeNode({ sourceEntityId: "cause-shared-dep-entity-e", nodeType: "component" });
  const findingSharedDep1 = makeNode({ sourceEntityId: "finding-shared-dep-1", nodeType: "governance_finding", sourceArtifact: "governance" });
  const findingSharedDep2 = makeNode({ sourceEntityId: "finding-shared-dep-2", nodeType: "governance_finding", sourceArtifact: "governance" });

  // unresolved: the finding's own anchor entity is itself an unresolved_reference node.
  const unresolvedTargetEntityId = "cause-unresolved-target";
  const unresolvedTarget = makeNode({
    sourceEntityId: unresolvedTargetEntityId,
    nodeType: "unresolved_reference",
    resolutionStatus: "unresolved",
    confidence: "unverifiable",
  });
  const findingUnresolved1 = makeNode({ sourceEntityId: "finding-unresolved-1", nodeType: "governance_finding", sourceArtifact: "governance" });

  const nodes = [
    confirmedConsumer, confirmedEntityA, confirmedEntityB, findingConfirmed1, findingConfirmed2,
    probableConsumer1, probableConsumer2, probableEntityA, probableEntityB, findingProbable1, findingProbable2,
    partialConsumer, partialEntityA, partialEntityB, findingPartial1, findingPartial2,
    sharedDepReferencer, sharedDepEntityD, sharedDepEntityE, findingSharedDep1, findingSharedDep2,
    unresolvedTarget, findingUnresolved1,
  ];

  const edges = [
    makeEdge({ edgeType: "depends_on", from: confirmedConsumer, to: confirmedEntityA }),
    makeEdge({ edgeType: "depends_on", from: confirmedConsumer, to: confirmedEntityB }),
    makeEdge({ edgeType: "affects", from: findingConfirmed1, to: confirmedEntityA }),
    makeEdge({ edgeType: "affects", from: findingConfirmed2, to: confirmedEntityB }),

    makeEdge({ edgeType: "depends_on", from: probableConsumer1, to: probableEntityA }),
    makeEdge({ edgeType: "depends_on", from: probableConsumer1, to: probableEntityB }),
    makeEdge({ edgeType: "depends_on", from: probableConsumer2, to: probableEntityA }),
    makeEdge({ edgeType: "depends_on", from: probableConsumer2, to: probableEntityB }),
    makeEdge({ edgeType: "affects", from: findingProbable1, to: probableEntityA }),
    makeEdge({ edgeType: "affects", from: findingProbable2, to: probableEntityB }),

    makeEdge({ edgeType: "depends_on", from: partialConsumer, to: partialEntityA, resolutionStatus: "partial" }),
    makeEdge({ edgeType: "depends_on", from: partialConsumer, to: partialEntityB }),
    makeEdge({ edgeType: "affects", from: findingPartial1, to: partialEntityA }),
    makeEdge({ edgeType: "affects", from: findingPartial2, to: partialEntityB }),

    makeEdge({ edgeType: "references", from: sharedDepReferencer, to: sharedDepEntityD }),
    makeEdge({ edgeType: "references", from: sharedDepReferencer, to: sharedDepEntityE }),
    makeEdge({ edgeType: "affects", from: findingSharedDep1, to: sharedDepEntityD }),
    makeEdge({ edgeType: "affects", from: findingSharedDep2, to: sharedDepEntityE }),

    makeEdge({ edgeType: "affects", from: findingUnresolved1, to: unresolvedTarget, resolutionStatus: "unresolved" }),
  ];

  return {
    nodes,
    edges,
    confirmedConsumer, confirmedEntityA, confirmedEntityB, findingConfirmed1, findingConfirmed2,
    probableConsumer1, probableConsumer2, probableEntityA, probableEntityB, findingProbable1, findingProbable2,
    partialConsumer, partialEntityA, partialEntityB, findingPartial1, findingPartial2,
    sharedDepReferencer, sharedDepEntityD, sharedDepEntityE, findingSharedDep1, findingSharedDep2,
    unresolvedTarget, findingUnresolved1,
  };
}

/** A target entity reachable to/from a decision node (plus its assumption and consequence), for decision-impact / impact-analysis tests. */
export function decisionReachableFixture() {
  const entity = makeNode({ sourceEntityId: "decision-target-entity", nodeType: "component" });
  const decision = makeNode({ sourceEntityId: "decision-alpha", nodeType: "decision", sourceArtifact: "decision" });
  const assumption = makeNode({ sourceEntityId: "decision-alpha-assumption-1", nodeType: "decision_assumption", sourceArtifact: "decision" });
  const consequence = makeNode({ sourceEntityId: "decision-alpha-consequence-1", nodeType: "decision_consequence", sourceArtifact: "decision" });
  const nodes = [entity, decision, assumption, consequence];
  const edges = [
    makeEdge({ edgeType: "references", from: decision, to: entity, detail: "decision references entity" }),
    makeEdge({ edgeType: "requires", from: decision, to: assumption, detail: "decision requires assumption" }),
    makeEdge({ edgeType: "produces", from: decision, to: consequence, detail: "decision produces consequence" }),
  ];
  return { nodes, edges, entity, decision, assumption, consequence };
}

export function emptyDecisionStateLookup(): DecisionStateLookup {
  return { decisionByDecisionId: new Map(), assumptionsByDecisionId: new Map() };
}

export function makeDecisionStateLookup(entries: {
  decisions?: Array<{ id: string; decision_status?: string; implementation_status?: string }>;
  assumptions?: Array<{ id: string; decision_id: string; state?: string }>;
}): DecisionStateLookup {
  const decisionByDecisionId = new Map<string, { decision_status?: string; implementation_status?: string }>();
  for (const decision of entries.decisions ?? []) {
    decisionByDecisionId.set(decision.id, { decision_status: decision.decision_status, implementation_status: decision.implementation_status });
  }
  const assumptionsByDecisionId = new Map<string, Array<{ id: string; state?: string }>>();
  for (const assumption of entries.assumptions ?? []) {
    const bucket = assumptionsByDecisionId.get(assumption.decision_id) ?? [];
    bucket.push({ id: assumption.id, state: assumption.state });
    assumptionsByDecisionId.set(assumption.decision_id, bucket);
  }
  return { decisionByDecisionId, assumptionsByDecisionId };
}

/** A capability with test/docs/presentation-shaped evidence, a baseline reachable via `governs`, and an unresolved downstream consumer -- for change-planning.ts tests. */
export function evidencePathFixture() {
  const root = makeNode({ sourceEntityId: "evidence-root", nodeType: "component" });
  const capability = makeNode({ sourceEntityId: "evidence-capability", nodeType: "capability", sourceArtifact: "capability" });
  const testEvidence = makeNode({
    sourceEntityId: "evidence-test-1",
    nodeType: "evidence",
    sourceArtifact: "capability",
    evidenceRefs: [{ path: "packages/example/src/__tests__/example.test.ts", source_artifact: "capability" }],
  });
  const docsEvidence = makeNode({
    sourceEntityId: "evidence-docs-1",
    nodeType: "evidence",
    sourceArtifact: "capability",
    evidenceRefs: [{ path: "docs/example.md", source_artifact: "capability" }],
  });
  const presentationEvidence = makeNode({
    sourceEntityId: "evidence-presentation-1",
    nodeType: "evidence",
    sourceArtifact: "capability",
    evidenceRefs: [{ path: "packages/renderer-html/src/scene.ts", source_artifact: "capability" }],
  });
  const baseline = makeNode({ sourceEntityId: "evidence-baseline", nodeType: "baseline", sourceArtifact: "governance" });
  const unresolvedConsumerEntityId = "evidence-unresolved-consumer";
  const unresolvedConsumer = makeNode({
    sourceEntityId: unresolvedConsumerEntityId,
    nodeType: "unresolved_reference",
    resolutionStatus: "unresolved",
    confidence: "unverifiable",
  });

  const nodes = [root, capability, testEvidence, docsEvidence, presentationEvidence, baseline, unresolvedConsumer];
  const edges = [
    makeEdge({ edgeType: "depends_on", from: root, to: capability, detail: "root depends on capability" }),
    makeEdge({ edgeType: "evidenced_by", from: capability, to: testEvidence }),
    makeEdge({ edgeType: "evidenced_by", from: capability, to: docsEvidence }),
    makeEdge({ edgeType: "evidenced_by", from: capability, to: presentationEvidence }),
    makeEdge({ edgeType: "governs", from: root, to: baseline }),
    makeEdge({ edgeType: "depends_on", from: capability, to: unresolvedConsumer, resolutionStatus: "unresolved" }),
  ];
  return { nodes, edges, root, capability, testEvidence, docsEvidence, presentationEvidence, baseline, unresolvedConsumer };
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

export function allPresentUpstreamArtifacts(): UpstreamArtifactDigest[] {
  const sources: UpstreamSourceArtifact[] = ["architecture", "capability", "product", "portfolio", "governance", "decision"];
  return sources.map((source_artifact) => ({
    source_artifact,
    snapshot_id: `${source_artifact}-snapshot-1`,
    schema_version: 1,
    provenance: "complete" as const,
  }));
}

// ---------------------------------------------------------------------------
// Deterministic scale generator (no Math.random()/Date.now(); every id is a
// pure function of loop counters).
// ---------------------------------------------------------------------------

export interface ScaleFixtureOptions {
  chainCount?: number;
  chainLength?: number;
  capabilityCount?: number;
  productCount?: number;
  governanceClusterCount?: number;
  decisionCount?: number;
  unresolvedReferenceCount?: number;
}

export interface ScaleFixture {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  chainRootNodeIds: string[];
  governanceFindingNodeIds: string[];
  decisionNodeIds: string[];
}

export function generateScaleFixture(options: ScaleFixtureOptions = {}): ScaleFixture {
  const {
    chainCount = 100,
    chainLength = 5,
    capabilityCount = 500,
    productCount = 100,
    governanceClusterCount = 100,
    decisionCount = 250,
    unresolvedReferenceCount = 100,
  } = options;

  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const chainRootNodeIds: string[] = [];
  const chainComponentEntityIds: string[][] = [];

  for (let c = 0; c < chainCount; c++) {
    const entityIds: string[] = [];
    for (let i = 0; i < chainLength; i++) {
      const entityId = `scale-chain-${c}-component-${i}`;
      entityIds.push(entityId);
      nodes.push(makeNode({ sourceEntityId: entityId, nodeType: "component", sourceArtifact: "architecture" }));
      if (i > 0) {
        edges.push(
          makeEdge({
            edgeType: "depends_on",
            from: buildNodeId(entityIds[i - 1]!),
            to: buildNodeId(entityId),
            detail: `chain ${c} step ${i}`,
          }),
        );
      }
    }
    chainComponentEntityIds.push(entityIds);
    chainRootNodeIds.push(buildNodeId(entityIds[0]!));
  }

  const capabilityNodeIds: string[] = [];
  for (let k = 0; k < capabilityCount; k++) {
    const entityId = `scale-capability-${k}`;
    nodes.push(makeNode({ sourceEntityId: entityId, nodeType: "capability", sourceArtifact: "capability" }));
    capabilityNodeIds.push(buildNodeId(entityId));
    const targetChain = chainComponentEntityIds[k % chainCount]!;
    const targetComponentEntityId = targetChain[k % targetChain.length]!;
    edges.push(
      makeEdge({
        edgeType: "depends_on",
        from: buildNodeId(entityId),
        to: buildNodeId(targetComponentEntityId),
        detail: `capability ${k} depends on component`,
      }),
    );
  }

  for (let p = 0; p < productCount; p++) {
    const entityId = `scale-product-${p}`;
    nodes.push(makeNode({ sourceEntityId: entityId, nodeType: "product", sourceArtifact: "product" }));
    const capabilityIndex = p % capabilityCount;
    edges.push(
      makeEdge({
        edgeType: "requires",
        from: buildNodeId(entityId),
        to: capabilityNodeIds[capabilityIndex]!,
        detail: `product ${p} requires capability`,
      }),
    );
  }

  const governanceFindingNodeIds: string[] = [];
  let findingCounter = 0;
  for (let g = 0; g < governanceClusterCount; g++) {
    const chain = chainComponentEntityIds[g % chainCount]!;
    for (let m = 1; m <= 2 && m < chain.length; m++) {
      const findingEntityId = `scale-finding-${findingCounter}`;
      findingCounter += 1;
      const findingNode = makeNode({ sourceEntityId: findingEntityId, nodeType: "governance_finding", sourceArtifact: "governance" });
      nodes.push(findingNode);
      governanceFindingNodeIds.push(findingNode.id);
      edges.push(
        makeEdge({
          edgeType: "affects",
          from: findingNode,
          to: buildNodeId(chain[m]!),
          detail: `finding ${findingEntityId} affects chain component`,
        }),
      );
    }
  }

  const decisionNodeIds: string[] = [];
  for (let d = 0; d < decisionCount; d++) {
    const decisionEntityId = `scale-decision-${d}`;
    const decisionNode = makeNode({ sourceEntityId: decisionEntityId, nodeType: "decision", sourceArtifact: "decision" });
    nodes.push(decisionNode);
    decisionNodeIds.push(decisionNode.id);
    const assumptionEntityId = `scale-decision-${d}-assumption`;
    const assumptionNode = makeNode({ sourceEntityId: assumptionEntityId, nodeType: "decision_assumption", sourceArtifact: "decision" });
    nodes.push(assumptionNode);
    edges.push(makeEdge({ edgeType: "requires", from: decisionNode, to: assumptionNode, detail: `decision ${d} requires assumption` }));
    const chain = chainComponentEntityIds[d % chainCount]!;
    const referencedEntityId = chain[d % chain.length]!;
    edges.push(
      makeEdge({
        edgeType: "references",
        from: decisionNode,
        to: buildNodeId(referencedEntityId),
        detail: `decision ${d} references component`,
      }),
    );
  }

  for (let u = 0; u < unresolvedReferenceCount; u++) {
    const chain = chainComponentEntityIds[u % chainCount]!;
    const sourceEntityId = chain[u % chain.length]!;
    const missingEntityId = `scale-unresolved-target-${u}`;
    const unresolvedNode = makeNode({
      sourceEntityId: missingEntityId,
      nodeType: "unresolved_reference",
      resolutionStatus: "unresolved",
      confidence: "unverifiable",
    });
    nodes.push(unresolvedNode);
    edges.push(
      makeEdge({
        edgeType: "references",
        from: buildNodeId(sourceEntityId),
        to: unresolvedNode,
        resolutionStatus: "unresolved",
        detail: `scale unresolved reference ${u}`,
      }),
    );
  }

  return { nodes, edges, chainRootNodeIds, governanceFindingNodeIds, decisionNodeIds };
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function isSorted(values: string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
  }
  return true;
}

export function hasNoDuplicates(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function rotate<T>(items: T[], shift: number): T[] {
  if (items.length === 0) return items;
  const offset = shift % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
