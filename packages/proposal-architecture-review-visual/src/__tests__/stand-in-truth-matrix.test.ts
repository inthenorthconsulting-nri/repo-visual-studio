// Provenance markers survive adaptive stand-in reduction (Milestone
// 11.3.3.2B, §17/§58) -- reusing @rvs/visual-intelligence's real
// `adaptVisualModel()` reduction path (the same mechanism
// semantic-marker-survivability.test.ts exercises for the generic channel),
// not a mocked collapse. Provenance markers are just this package's own use
// of that generic channel, so if they did not survive reduction the
// generic-channel guarantee would be worthless for this milestone's actual
// purpose: a reader must never be able to mistake a collapsed group of
// mixed-provenance entities for a uniformly confirmed one.

import { describe, expect, it } from "vitest";
import { adaptVisualModel } from "@rvs/visual-intelligence";
import type { VisualGraphModel, VisualNode } from "@rvs/visual-intelligence";
import { provenanceToSemanticMarker } from "../provenance-marker.js";

function node(id: string, overrides: Partial<VisualNode> = {}): VisualNode {
  return {
    id,
    source_entity_id: id,
    label: id,
    kind: "component",
    emphasis: "normal",
    resolution: "resolved",
    confidence: "confirmed",
    evidence_refs: [],
    ...overrides,
  };
}

function hubModel(count: number, provenanceFor: (index: number) => "confirmed" | "proposed" | "modified"): VisualGraphModel {
  const leaves = Array.from({ length: count }, (_, i) => node(`leaf${String(i).padStart(3, "0")}`, { semantic_markers: [provenanceToSemanticMarker(provenanceFor(i))] }));
  return {
    nodes: [node("hub"), ...leaves],
    edges: leaves.map((leaf) => ({ id: `edge-${leaf.id}`, from_id: "hub", to_id: leaf.id, kind: "depends_on", emphasis: "normal", resolution: "resolved", in_cycle: false, evidence_refs: [] })),
    groups: [],
    lanes: [],
    stages: [],
    metrics: [],
    annotations: [],
    boundaries: [],
    paths: [],
    changes: [],
    has_cycles: false,
    containment_depth: 0,
  };
}

function everyDrawnNode(result: ReturnType<typeof adaptVisualModel>): VisualNode[] {
  return [...result.model.nodes, ...result.splits.flatMap((s) => s.model.nodes)];
}

function survivingMarkerKeys(result: ReturnType<typeof adaptVisualModel>): Set<string> {
  const keys = new Set<string>();
  for (const n of everyDrawnNode(result)) for (const m of n.semantic_markers ?? []) keys.add(m.key);
  return keys;
}

describe("provenance markers survive stand-in reduction under a real adaptive collapse", () => {
  it("preserves all three provenance keys when a hub's leaves are a mix of confirmed/proposed/modified", () => {
    const model = hubModel(30, (i) => (i % 3 === 0 ? "confirmed" : i % 3 === 1 ? "proposed" : "modified"));
    const result = adaptVisualModel({ spec_id: "spec_test", model, grammar: "dependency_graph", detail_mode: "simplified" });
    const standIns = result.model.nodes.filter((n) => n.placeholder_for !== undefined);
    expect(standIns.length).toBeGreaterThan(0);
    expect(survivingMarkerKeys(result)).toEqual(new Set(["provenance-confirmed", "provenance-proposed", "provenance-modified"]));
  });

  it("never reduces a mixed-provenance group to a single reported marker", () => {
    const model = hubModel(30, (i) => (i % 2 === 0 ? "confirmed" : "proposed"));
    const result = adaptVisualModel({ spec_id: "spec_test", model, grammar: "dependency_graph", detail_mode: "simplified" });
    const mixedStandIn = result.model.nodes.find((n) => n.placeholder_for !== undefined && (n.semantic_markers?.length ?? 0) > 0);
    expect(mixedStandIn?.semantic_markers?.map((m) => m.key).sort()).toEqual(["provenance-confirmed", "provenance-proposed"]);
  });

  it("a uniformly confirmed hub's stand-in never silently reports a proposed/modified marker it never had", () => {
    const model = hubModel(30, () => "confirmed");
    const result = adaptVisualModel({ spec_id: "spec_test", model, grammar: "dependency_graph", detail_mode: "simplified" });
    for (const n of everyDrawnNode(result)) {
      for (const marker of n.semantic_markers ?? []) {
        expect(["provenance-confirmed"]).toContain(marker.key);
      }
    }
  });
});
