// Certification matrix (Milestone 11.3.3.2B-T): proposal Projected State
// entities/edges are built through this package's real adaptProjectedState(),
// then reduced by @rvs/visual-intelligence's real adaptVisualModel(). Nothing
// here re-implements marker aggregation; multiplicity is read off the
// stand-ins/connectors M10 actually produced.

import { describe, expect, it } from "vitest";
import { adaptVisualModel } from "@rvs/visual-intelligence";
import type { OverlayEntityProvenance } from "@rvs/change-workbench";
import { adaptProjectedState } from "../adapt-projected.js";
import { PROJECTED_PROVENANCE_MARKER_KEYS } from "../provenance-marker.js";
import { kEdge, kNode } from "./fixtures.js";

type Prov = "confirmed" | "proposed" | "modified";
type Composition = Partial<Record<Prov, number>>;
const KEY = PROJECTED_PROVENANCE_MARKER_KEYS;

function provenanceList(composition: Composition): Prov[] {
  return (["confirmed", "proposed", "modified"] as const).flatMap((p) => Array.from({ length: composition[p] ?? 0 }, () => p));
}

function projectedHub(provs: Prov[], target: "nodes" | "edges") {
  const leaves = provs.map((p, i) => ({ id: `leaf${String(i).padStart(3, "0")}`, p }));
  const nodes = [kNode({ id: "hub" }), ...leaves.map((l) => kNode({ id: l.id }))];
  const edges = leaves.map((l) => kEdge({ id: `e-${l.id}`, from_node_id: "hub", to_node_id: l.id, edge_type: "depends_on" }));
  const node_provenance: Record<string, OverlayEntityProvenance> = { hub: "confirmed" };
  const edge_provenance: Record<string, OverlayEntityProvenance> = {};
  for (const l of leaves) {
    node_provenance[l.id] = target === "nodes" ? l.p : "confirmed";
    edge_provenance[`hub:depends_on:${l.id}`] = target === "edges" ? l.p : "confirmed";
  }
  const overlay = { repository_id: "repo-1", base_snapshot_digest: "digest-1", nodes, edges, node_provenance, edge_provenance };
  const projected = adaptProjectedState({ status: "built", result: { status: "ok", overlay, issues: [] } });
  if (projected.status !== "built") throw new Error("expected built projection");
  return projected.model;
}

function reduce(model: ReturnType<typeof projectedHub>) {
  return adaptVisualModel({ spec_id: "spec_test", model, grammar: "dependency_graph", detail_mode: "simplified" });
}

function tally(markers: Array<readonly { key: string; count?: number }[] | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const list of markers) for (const m of list ?? []) out[m.key] = (out[m.key] ?? 0) + (m.count ?? 1);
  return out;
}

/** Marker multiplicity carried by stand-in nodes only (the hub and any drawn leaf are outside the collapsed group). */
function standInNodeTally(result: ReturnType<typeof reduce>) {
  const all = [...result.model.nodes, ...result.splits.flatMap((s) => s.model.nodes)];
  const standIns = all.filter((n) => n.placeholder_for !== undefined);
  expect(standIns.length).toBeGreaterThan(0);
  return { tally: tally(standIns.map((n) => n.semantic_markers)), standIns };
}

/** Multiplicity across every edge M10 drew, drawn leaf edges plus aggregated connectors; asserts a connector really aggregated (count > 1). */
function wholeEdgeTally(result: ReturnType<typeof reduce>) {
  const edges = [...result.model.edges, ...result.splits.flatMap((s) => s.model.edges)];
  const aggregated = edges.some((e) => (e.semantic_markers ?? []).some((m) => (m.count ?? 1) > 1));
  expect(aggregated).toBe(true);
  return tally(edges.map((e) => e.semantic_markers));
}

// Drawn leaves keep their own marker; hidden leaves live in a stand-in. Their sum must equal the input exactly.
function wholeNodeTally(result: ReturnType<typeof reduce>) {
  const all = [...result.model.nodes, ...result.splits.flatMap((s) => s.model.nodes)].filter((n) => n.source_entity_id !== "hub" && n.label !== "hub");
  return tally(all.map((n) => n.semantic_markers));
}

function expectedTally(c: Composition): Record<string, number> {
  const out: Record<string, number> = {};
  if (c.confirmed) out[KEY.confirmed] = c.confirmed;
  if (c.proposed) out[KEY.proposed] = c.proposed;
  if (c.modified) out[KEY.modified] = c.modified;
  return out;
}

const MATRIX: Array<{ name: string; composition: Composition }> = [
  { name: "10 confirmed", composition: { confirmed: 10 } },
  { name: "10 proposed", composition: { proposed: 10 } },
  { name: "10 modified", composition: { modified: 10 } },
  { name: "9 confirmed + 1 proposed", composition: { confirmed: 9, proposed: 1 } },
  { name: "1 confirmed + 9 proposed", composition: { confirmed: 1, proposed: 9 } },
  { name: "8 confirmed + 1 proposed + 1 modified", composition: { confirmed: 8, proposed: 1, modified: 1 } },
];

describe("projected-node provenance survives real adaptive stand-in reduction with exact multiplicity", () => {
  for (const { name, composition } of MATRIX) {
    it(`preserves ${name}`, () => {
      const result = reduce(projectedHub(provenanceList(composition), "nodes"));
      standInNodeTally(result);
      expect(wholeNodeTally(result)).toEqual(expectedTally(composition));
    });
  }

  it("a collapsed all-proposed group carries proposed only, never confirmed or modified", () => {
    const { tally: t } = standInNodeTally(reduce(projectedHub(provenanceList({ proposed: 10 }), "nodes")));
    expect(Object.keys(t)).toEqual([KEY.proposed]);
  });

  it("a collapsed all-modified group carries modified only, never confirmed or proposed", () => {
    const { tally: t } = standInNodeTally(reduce(projectedHub(provenanceList({ modified: 10 }), "nodes")));
    expect(Object.keys(t)).toEqual([KEY.modified]);
  });

  it("a collapsed all-confirmed group carries confirmed only", () => {
    const { tally: t } = standInNodeTally(reduce(projectedHub(provenanceList({ confirmed: 10 }), "nodes")));
    expect(Object.keys(t)).toEqual([KEY.confirmed]);
  });

  it("preserves inverse confirmed/proposed distributions through real adaptive stand-ins", () => {
    const a = wholeNodeTally(reduce(projectedHub(provenanceList({ confirmed: 9, proposed: 1 }), "nodes")));
    const b = wholeNodeTally(reduce(projectedHub(provenanceList({ confirmed: 1, proposed: 9 }), "nodes")));
    expect(a).toEqual({ [KEY.confirmed]: 9, [KEY.proposed]: 1 });
    expect(b).toEqual({ [KEY.confirmed]: 1, [KEY.proposed]: 9 });
    expect(a).not.toEqual(b);
  });

  it("preserves three-way proposal provenance through real adaptive stand-ins without any marker becoming a winner", () => {
    const t = wholeNodeTally(reduce(projectedHub(provenanceList({ confirmed: 8, proposed: 1, modified: 1 }), "nodes")));
    expect(t).toEqual({ [KEY.confirmed]: 8, [KEY.proposed]: 1, [KEY.modified]: 1 });
  });

  it("a stand-in reports only the members it represents; a proposed hub never leaks into a confirmed-leaf stand-in", () => {
    const result = reduce(projectedHub(provenanceList({ confirmed: 10 }), "nodes"));
    const { tally: t } = standInNodeTally(result);
    expect(t[KEY.proposed]).toBeUndefined();
    expect(t[KEY.modified]).toBeUndefined();
  });
});

describe("projected-edge provenance survives real generic connector aggregation with exact multiplicity", () => {
  it("preserves inverse confirmed/proposed distributions through real edge connector aggregation", () => {
    const a = wholeEdgeTally(reduce(projectedHub(provenanceList({ confirmed: 9, proposed: 1 }), "edges")));
    const b = wholeEdgeTally(reduce(projectedHub(provenanceList({ confirmed: 1, proposed: 9 }), "edges")));
    expect(a).toEqual({ [KEY.confirmed]: 9, [KEY.proposed]: 1 });
    expect(b).toEqual({ [KEY.confirmed]: 1, [KEY.proposed]: 9 });
    expect(a).not.toEqual(b);
  });

  it("preserves three-way edge provenance through real edge connector aggregation", () => {
    const t = wholeEdgeTally(reduce(projectedHub(provenanceList({ confirmed: 4, proposed: 3, modified: 3 }), "edges")));
    expect(t).toEqual({ [KEY.confirmed]: 4, [KEY.proposed]: 3, [KEY.modified]: 3 });
  });
});
