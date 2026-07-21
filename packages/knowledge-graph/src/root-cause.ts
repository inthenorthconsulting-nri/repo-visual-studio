// rvs graph roots. Groups governance findings by shared upstream ancestor,
// using only each finding's own already-computed anchor edge
// ("affects": finding -> entity) and the shared bounded-BFS traversal
// engine -- never claims causality merely because findings share a tag or
// repository. Strictly conservative: a shared ancestor reached only via
// non-causal edge types (references, evidenced_by, ...) is reported as
// `shared_dependency_only`, never promoted to `probable`/`confirmed`.

import type { EvidenceRef, KnowledgeEdge, KnowledgeNode, RootCauseClassification, RootCauseGroup } from "./contracts.js";
import { buildRootCauseGroupId, digestOf } from "./ids.js";
import { traverse } from "./traversal.js";
import { CAUSAL_EDGE_TYPES, DEFAULT_MAX_TRAVERSAL_DEPTH, DEFAULT_RESULT_LIMIT } from "./constants.js";

interface AncestorTrace {
  ancestorIds: Set<string>;
  allResolved: boolean;
}

function traceAncestors(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  anchorNodeIds: string[],
  causalOnly: boolean,
): AncestorTrace {
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const ancestorIds = new Set<string>();
  let allResolved = true;
  for (const anchorNodeId of anchorNodeIds) {
    const result = traverse(nodes, edges, anchorNodeId, {
      maxDepth: DEFAULT_MAX_TRAVERSAL_DEPTH,
      direction: "upstream",
      allowedEdgeTypes: causalOnly ? Array.from(CAUSAL_EDGE_TYPES) : undefined,
      repositoryBoundary: "single",
      resultLimit: DEFAULT_RESULT_LIMIT,
    });
    for (const traversedNode of result.nodes) {
      if (traversedNode.node_id !== anchorNodeId) ancestorIds.add(traversedNode.node_id);
    }
    for (const edgeId of result.edges_traversed) {
      if (edgeById.get(edgeId)?.resolution_status !== "resolved") allResolved = false;
    }
  }
  return { ancestorIds, allResolved };
}

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootA] = rootB;
  }
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const value of a) if (b.has(value)) result.add(value);
  return result;
}

function buildGroup(
  findingNodes: KnowledgeNode[],
  candidateRootIds: string[],
  classification: RootCauseClassification,
  detail: string,
): RootCauseGroup {
  const findingIds = findingNodes.map((node) => node.id).sort();
  const sortedRoots = [...candidateRootIds].sort();
  const rootKey = sortedRoots.length === 1 ? sortedRoots[0]! : `multi:${digestOf(sortedRoots.length > 0 ? sortedRoots : findingIds)}`;
  const evidenceSeen = new Set<string>();
  const evidenceRefs: EvidenceRef[] = [];
  for (const node of findingNodes) {
    for (const ref of node.evidence_refs) {
      const key = JSON.stringify(ref);
      if (evidenceSeen.has(key)) continue;
      evidenceSeen.add(key);
      evidenceRefs.push(ref);
    }
  }
  return {
    id: buildRootCauseGroupId(rootKey),
    schema_version: 1,
    finding_node_ids: findingIds,
    candidate_root_node_ids: sortedRoots,
    classification,
    detail,
    evidence_refs: evidenceRefs,
  };
}

function componentsOf(count: number, unionFind: UnionFind): number[][] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const root = unionFind.find(i);
    const bucket = groups.get(root) ?? [];
    bucket.push(i);
    groups.set(root, bucket);
  }
  return Array.from(groups.values());
}

export function groupRootCauses(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): RootCauseGroup[] {
  const findingNodes = nodes.filter((node) => node.node_type === "governance_finding").sort((a, b) => (a.id < b.id ? -1 : 1));
  const edgesFromFinding = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges) {
    if (edge.edge_type !== "affects") continue;
    const bucket = edgesFromFinding.get(edge.from_node_id) ?? [];
    bucket.push(edge);
    edgesFromFinding.set(edge.from_node_id, bucket);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const anchorResolved: KnowledgeNode[] = [];
  const anchorUnresolved: KnowledgeNode[] = [];
  const anchorsByFinding = new Map<string, string[]>();
  for (const finding of findingNodes) {
    const anchorNodeIds = (edgesFromFinding.get(finding.id) ?? []).map((edge) => edge.to_node_id);
    const resolvedAnchors = anchorNodeIds.filter((id) => nodeById.get(id)?.node_type !== "unresolved_reference");
    if (anchorNodeIds.length === 0 || resolvedAnchors.length === 0) {
      anchorUnresolved.push(finding);
    } else {
      anchorsByFinding.set(finding.id, resolvedAnchors);
      anchorResolved.push(finding);
    }
  }

  const causalTraces = anchorResolved.map((finding) => traceAncestors(nodes, edges, anchorsByFinding.get(finding.id)!, true));
  const allTraces = anchorResolved.map((finding) => traceAncestors(nodes, edges, anchorsByFinding.get(finding.id)!, false));

  const groups: RootCauseGroup[] = [];

  const causalUnionFind = new UnionFind(anchorResolved.length);
  for (let i = 0; i < anchorResolved.length; i++) {
    for (let j = i + 1; j < anchorResolved.length; j++) {
      if (intersect(causalTraces[i]!.ancestorIds, causalTraces[j]!.ancestorIds).size > 0) {
        causalUnionFind.union(i, j);
      }
    }
  }
  const causalComponents = componentsOf(anchorResolved.length, causalUnionFind).filter((component) => component.length >= 2);
  const groupedIndices = new Set<number>();
  for (const component of causalComponents) {
    for (const index of component) groupedIndices.add(index);
    const memberNodes = component.map((index) => anchorResolved[index]!);
    let sharedRoots = causalTraces[component[0]!]!.ancestorIds;
    for (const index of component.slice(1)) sharedRoots = intersect(sharedRoots, causalTraces[index]!.ancestorIds);
    const allMembersResolved = component.every((index) => causalTraces[index]!.allResolved);
    if (sharedRoots.size === 1 && allMembersResolved) {
      groups.push(
        buildGroup(
          memberNodes,
          Array.from(sharedRoots),
          "confirmed",
          "Every finding in this group traces to exactly one common upstream ancestor via resolved causal edges only.",
        ),
      );
    } else {
      const pairwiseUnion = new Set<string>();
      for (const index of component) for (const id of causalTraces[index]!.ancestorIds) pairwiseUnion.add(id);
      const candidateRoots = sharedRoots.size > 0 ? Array.from(sharedRoots) : Array.from(pairwiseUnion);
      groups.push(
        buildGroup(
          memberNodes,
          candidateRoots,
          "probable",
          sharedRoots.size > 1
            ? "Findings share more than one common causal ancestor candidate -- which one is the root is ambiguous."
            : "Findings are causally linked, but at least one path includes a partial edge or the group has no single ancestor common to every member.",
        ),
      );
    }
  }

  const remainingIndices = anchorResolved.map((_, index) => index).filter((index) => !groupedIndices.has(index));
  const dependencyUnionFind = new UnionFind(remainingIndices.length);
  for (let a = 0; a < remainingIndices.length; a++) {
    for (let b = a + 1; b < remainingIndices.length; b++) {
      const i = remainingIndices[a]!;
      const j = remainingIndices[b]!;
      if (intersect(allTraces[i]!.ancestorIds, allTraces[j]!.ancestorIds).size > 0) {
        dependencyUnionFind.union(a, b);
      }
    }
  }
  const dependencyComponents = componentsOf(remainingIndices.length, dependencyUnionFind).filter((component) => component.length >= 2);
  for (const component of dependencyComponents) {
    const memberIndices = component.map((localIndex) => remainingIndices[localIndex]!);
    const memberNodes = memberIndices.map((index) => anchorResolved[index]!);
    let sharedRoots = allTraces[memberIndices[0]!]!.ancestorIds;
    for (const index of memberIndices.slice(1)) sharedRoots = intersect(sharedRoots, allTraces[index]!.ancestorIds);
    const pairwiseUnion = new Set<string>();
    for (const index of memberIndices) for (const id of allTraces[index]!.ancestorIds) pairwiseUnion.add(id);
    const candidateRoots = sharedRoots.size > 0 ? Array.from(sharedRoots) : Array.from(pairwiseUnion);
    groups.push(
      buildGroup(
        memberNodes,
        candidateRoots,
        "shared_dependency_only",
        "Findings reach a common node only via non-causal edge types (e.g. references/evidenced_by) -- connectivity does not establish causality here.",
      ),
    );
  }

  for (const finding of anchorUnresolved) {
    groups.push(
      buildGroup(
        [finding],
        [],
        "unresolved",
        "This finding's own anchor entity is unresolved, so no upstream relationship to any other finding can be computed.",
      ),
    );
  }

  return groups.sort((a, b) => (a.id < b.id ? -1 : 1));
}
