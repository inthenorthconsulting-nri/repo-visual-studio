// Survivability of the generic marker channel through adaptive reduction
// (Milestone 11.3.3.2A).
//
// The channel's only reason to exist is that a qualification which
// disappears when a view exceeds its budget is worse than no qualification
// at all: the reader cannot tell an unmarked entity from a marked entity
// whose marker was silently dropped. So the tests here are adversarial about
// exactly one thing -- can reduction erase a marker? -- and are indifferent
// to how pretty the result is.

import { describe, expect, it } from "vitest";
import { adaptVisualModel, subsetModel } from "../degradation.js";
import { validateFidelityReceipt } from "../fidelity.js";
import { digestOf } from "../ids.js";
import type { VisualGraphModel, VisualNode } from "../data-model.js";
import type { VisualSemanticMarker } from "../semantic-markers.js";
import { chain, edge, model, node, shuffleModel } from "./fixtures.js";

const mk = (key: string, label = key.toUpperCase()): VisualSemanticMarker => ({ key, label });

const adapt = (m: VisualGraphModel, over: Partial<Parameters<typeof adaptVisualModel>[0]> = {}) =>
  adaptVisualModel({
    spec_id: "spec_test",
    model: m,
    grammar: "dependency_graph",
    detail_mode: "simplified",
    ...over,
  });

/** Every node drawn anywhere the adaptation produced: primary view plus every detail view. */
function everyDrawnNode(result: ReturnType<typeof adapt>): VisualNode[] {
  return [...result.model.nodes, ...result.splits.flatMap((s) => s.model.nodes)];
}

/** The union of every marker key visible anywhere in the adapted output, stand-ins included. */
function survivingKeys(result: ReturnType<typeof adapt>): Set<string> {
  const keys = new Set<string>();
  for (const n of everyDrawnNode(result)) for (const m of n.semantic_markers ?? []) keys.add(m.key);
  for (const e of [...result.model.edges, ...result.splits.flatMap((s) => s.model.edges)]) {
    for (const m of e.semantic_markers ?? []) keys.add(m.key);
  }
  return keys;
}

/**
 * A hub with `count` interchangeable leaves -- the shape that collapses into
 * a single stand-in, which is exactly the shape a marker has to survive.
 */
function markedHub(count: number, markerFor: (index: number) => VisualSemanticMarker[]): VisualGraphModel {
  const leaves = Array.from({ length: count }, (_, i) =>
    node(`leaf${String(i).padStart(3, "0")}`, { semantic_markers: markerFor(i) }),
  );
  return model({ nodes: [node("hub"), ...leaves], edges: leaves.map((l) => edge("hub", l.id)) });
}

describe("collapse aggregation: a stand-in reports what its members were marked with", () => {
  it("preserves {m1, m2, m3} when members were marked {m1}, {m2}, {m1, m3}", () => {
    const result = adapt(
      markedHub(30, (i) => (i % 3 === 0 ? [mk("m1")] : i % 3 === 1 ? [mk("m2")] : [mk("m1"), mk("m3")])),
    );
    const standIns = result.model.nodes.filter((n) => n.placeholder_for !== undefined);
    expect(standIns.length).toBeGreaterThan(0);
    expect(survivingKeys(result)).toEqual(new Set(["m1", "m2", "m3"]));
  });

  it("never reduces a mixed group to one marker, and keeps mixed categories visibly mixed", () => {
    const result = adapt(markedHub(30, (i) => (i % 2 === 0 ? [mk("a")] : [mk("b")])));
    const mixed = result.model.nodes.find(
      (n) => n.placeholder_for !== undefined && (n.semantic_markers?.length ?? 0) > 0,
    );
    expect(mixed?.semantic_markers?.map((m) => m.key)).toEqual(["a", "b"]);
  });

  it("distinguishes a 9xA + 1xB group from a 1xA + 9xB group", () => {
    const heavy = (dominant: string, other: string) =>
      adapt(markedHub(10, (i) => [i === 0 ? mk(other) : mk(dominant)]), { detail_mode: "simplified" });
    const heavyA = heavy("a", "b");
    const heavyB = heavy("b", "a");
    const standInOf = (r: ReturnType<typeof adapt>) =>
      r.model.nodes.find((n) => n.placeholder_for !== undefined && n.semantic_markers !== undefined);
    const a = standInOf(heavyA);
    const b = standInOf(heavyB);
    expect(a?.semantic_markers).toBeDefined();
    expect(b?.semantic_markers).toBeDefined();
    expect(digestOf(a?.semantic_markers)).not.toBe(digestOf(b?.semantic_markers));
    const countOf = (n: VisualNode | undefined, key: string) =>
      n?.semantic_markers?.find((m) => m.key === key)?.count ?? 1;
    expect(countOf(a, "a")).toBeGreaterThan(countOf(a, "b"));
    expect(countOf(b, "b")).toBeGreaterThan(countOf(b, "a"));
  });

  it("carries no marker field at all on a stand-in built from unmarked members", () => {
    const result = adapt(markedHub(30, () => []));
    for (const n of result.model.nodes) expect("semantic_markers" in n).toBe(false);
  });

  it("aggregates deterministically under a whole-model shuffle", () => {
    const m = markedHub(30, (i) => (i % 3 === 0 ? [mk("m1")] : i % 3 === 1 ? [mk("m2")] : [mk("m3")]));
    const base = digestOf(adapt(m).model.nodes.map((n) => n.semantic_markers));
    for (let seed = 1; seed <= 5; seed++) {
      expect(digestOf(adapt(shuffleModel(m, seed)).model.nodes.map((n) => n.semantic_markers))).toBe(base);
    }
  });
});

describe("a marker changes what is drawn about an entity, never whether it is drawn", () => {
  it("does not change which entities survive, in any detail mode", () => {
    for (const detail_mode of ["faithful", "balanced", "simplified"] as const) {
      const plain = chain(40);
      const marked = model({
        ...plain,
        nodes: plain.nodes.map((n) => ({ ...n, semantic_markers: [mk("x")] })),
      });
      const before = adapt(plain, { detail_mode });
      const after = adapt(marked, { detail_mode });
      expect(after.model.nodes.map((n) => n.id)).toEqual(before.model.nodes.map((n) => n.id));
      expect(after.receipt.hidden_entity_ids).toEqual(before.receipt.hidden_entity_ids);
      expect(after.receipt.preserved_entity_ids).toEqual(before.receipt.preserved_entity_ids);
    }
  });

  it("does not rescue a node that reduction would otherwise have removed", () => {
    const plain = chain(60);
    const oneMarked = model({
      ...plain,
      nodes: plain.nodes.map((n, i) => (i === 45 ? { ...n, semantic_markers: [mk("x")] } : n)),
    });
    const before = adapt(plain);
    const after = adapt(oneMarked);
    expect(after.model.nodes.map((n) => n.id)).toEqual(before.model.nodes.map((n) => n.id));
    expect(after.receipt.hidden_entity_ids).toEqual(before.receipt.hidden_entity_ids);
  });

  it("leaves the fidelity receipt's own fields untouched -- no marker accounting is minted", () => {
    const plain = chain(40);
    const marked = model({ ...plain, nodes: plain.nodes.map((n) => ({ ...n, semantic_markers: [mk("x")] })) });
    const before = adapt(plain).receipt;
    const after = adapt(marked).receipt;
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(JSON.stringify(after)).not.toContain("marker");
    expect(after.reason_codes).toEqual(before.reason_codes);
    expect(validateFidelityReceipt(after, marked.nodes.map((n) => n.source_entity_id))).toEqual([]);
  });

  it("keeps the receipt valid (the partition invariant holds) for a marked model", () => {
    const source = markedHub(40, (i) => [mk(`k${i % 4}`)]);
    const result = adapt(source);
    expect(validateFidelityReceipt(result.receipt, source.nodes.map((n) => n.source_entity_id))).toEqual([]);
  });
});

describe("markers survive every other reduction path", () => {
  it("subsetModel carries a node's and an edge's markers into a detail view unchanged", () => {
    const m = model({
      nodes: [node("a", { semantic_markers: [mk("x")] }), node("b", { semantic_markers: [mk("y")] })],
      edges: [edge("a", "b", { semantic_markers: [mk("z")] })],
    });
    const subset = subsetModel(m, (n) => n.id === "a" || n.id === "b");
    expect(subset.nodes.map((n) => n.semantic_markers?.[0].key)).toEqual(["x", "y"]);
    expect(subset.edges[0].semantic_markers?.[0].key).toBe("z");
  });

  it("split views keep the markers of the entities they received", () => {
    const grouped = model({
      nodes: Array.from({ length: 40 }, (_, i) =>
        node(`u${String(i).padStart(3, "0")}`, {
          resolution: "unresolved",
          group_id: `dom${i % 4}`,
          semantic_markers: [mk(`k${i % 4}`)],
        }),
      ),
      edges: [],
      groups: Array.from({ length: 4 }, (_, g) => ({
        id: `dom${g}`,
        label: `Domain ${g}`,
        kind: "domain",
        member_ids: Array.from({ length: 40 }, (_, i) => i)
          .filter((i) => i % 4 === g)
          .map((i) => `u${String(i).padStart(3, "0")}`),
        synthetic: false,
      })),
    });
    const result = adapt(grouped);
    expect(survivingKeys(result)).toEqual(new Set(["k0", "k1", "k2", "k3"]));
  });

  it("a connector standing in for marked edges reports every one of their markers", () => {
    const leaves = Array.from({ length: 30 }, (_, i) => node(`leaf${String(i).padStart(3, "0")}`));
    const m = model({
      nodes: [node("hub"), ...leaves],
      edges: leaves.map((l, i) => edge("hub", l.id, { semantic_markers: [mk(i % 2 === 0 ? "ea" : "eb")] })),
    });
    const result = adapt(m);
    const connectors = result.model.edges.filter((e) => e.semantic_markers !== undefined);
    expect(connectors.length).toBeGreaterThan(0);
    const keys = new Set(connectors.flatMap((e) => (e.semantic_markers ?? []).map((x) => x.key)));
    expect(keys).toEqual(new Set(["ea", "eb"]));
  });

  it("leaves synthetic connectors unmarked when the edges they stand for were unmarked", () => {
    const result = adapt(markedHub(30, () => []));
    for (const e of result.model.edges) expect("semantic_markers" in e).toBe(false);
  });

  it("invents no marker for an entity that is hidden rather than collapsed", () => {
    const plain = chain(60);
    const marked = model({
      ...plain,
      nodes: plain.nodes.map((n, i) => (i > 50 ? { ...n, semantic_markers: [mk("ghost")] } : n)),
    });
    const result = adapt(marked);
    const hidden = new Set(result.receipt.hidden_entity_ids);
    for (const n of everyDrawnNode(result)) {
      if (n.placeholder_for !== undefined) continue;
      expect(hidden.has(n.source_entity_id)).toBe(false);
    }
  });
});

describe("audience and detail mode never remove a marker", () => {
  it("keeps every marker key across all three detail modes", () => {
    const m = markedHub(30, (i) => [mk(`k${i % 3}`)]);
    for (const detail_mode of ["faithful", "balanced", "simplified"] as const) {
      expect(survivingKeys(adapt(m, { detail_mode }))).toEqual(new Set(["k0", "k1", "k2"]));
    }
  });

  it("keeps every marker key across all grammars that adapt a graph", () => {
    const m = markedHub(30, (i) => [mk(`k${i % 3}`)]);
    for (const grammar of ["architecture", "dependency_graph", "tree", "nested", "layer_stack", "delta"] as const) {
      expect(survivingKeys(adapt(m, { grammar }))).toEqual(new Set(["k0", "k1", "k2"]));
    }
  });
});
