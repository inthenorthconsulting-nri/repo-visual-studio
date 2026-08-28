import type { ExplorerSourceEdge, ExplorerSourceInput, ExplorerSourceNode } from "../source.js";

// Fixtures shaped like the cached knowledge-graph artifacts the CLI reads,
// built by hand so every test states its own premises. Nothing here is
// generated from a repository: a fixture that changed when the repository
// changed would turn every assertion below into a moving target.

export function sourceNode(id: string, over: Partial<ExplorerSourceNode> = {}): ExplorerSourceNode {
  return {
    id,
    node_type: "component",
    label: id.toUpperCase(),
    source_entity_id: id,
    resolution_status: "resolved",
    confidence: "confirmed",
    evidence_refs: [{ path: `src/${id}.ts`, lines: "1-20" }],
    ...over,
  };
}

export function sourceEdge(
  from: string,
  to: string,
  over: Partial<ExplorerSourceEdge> = {},
): ExplorerSourceEdge {
  return {
    id: `e-${from}-${to}`,
    edge_type: "depends_on",
    from_node_id: from,
    to_node_id: to,
    resolution_status: "resolved",
    ...over,
  };
}

/**
 * A small estate: two packages, three components each, a couple of
 * cross-package dependencies, and one unresolved reference.
 *
 * Deliberately small enough that a reader of a failing assertion can hold the
 * whole graph in their head and say whether the expectation was right.
 */
export function estateSource(): ExplorerSourceInput {
  const packages = ["pkg-alpha", "pkg-beta"];
  const members: Record<string, string[]> = {
    "pkg-alpha": ["alpha-api", "alpha-core", "alpha-store"],
    "pkg-beta": ["beta-api", "beta-worker", "beta-store"],
  };
  const nodes: ExplorerSourceNode[] = [
    ...packages.map((id) => sourceNode(id, { node_type: "package", label: id })),
    ...Object.values(members)
      .flat()
      .map((id) => sourceNode(id)),
  ];
  const edges: ExplorerSourceEdge[] = [
    ...packages.flatMap((pkg) =>
      members[pkg].map((child) =>
        sourceEdge(pkg, child, { edge_type: "contains", id: `c-${pkg}-${child}` }),
      ),
    ),
    sourceEdge("alpha-api", "alpha-core"),
    sourceEdge("alpha-core", "alpha-store"),
    sourceEdge("alpha-core", "beta-api"),
    sourceEdge("beta-api", "beta-worker"),
    sourceEdge("beta-worker", "beta-store"),
    sourceEdge("beta-store", "alpha-store", { resolution_status: "unresolved" }),
  ];
  return {
    nodes,
    edges,
    severities: [{ entity_id: "beta-worker", severity: "blocking" }],
    decisions: [{ entity_id: "alpha-core", status: "accepted" }],
    focal_entity_ids: ["alpha-api"],
    critical_path_node_ids: ["alpha-api", "alpha-core", "beta-api"],
  };
}

/** A chain long enough that a bounded traversal genuinely stops short of the end. */
export function chainSource(length = 12): ExplorerSourceInput {
  const ids = Array.from({ length }, (_, i) => `n${String(i).padStart(3, "0")}`);
  return {
    nodes: ids.map((id) => sourceNode(id)),
    edges: ids.slice(1).map((id, i) => sourceEdge(ids[i], id)),
  };
}

/** A deterministic shuffle: same input, same permutation, no randomness in a test. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed * 2654435761 + 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
