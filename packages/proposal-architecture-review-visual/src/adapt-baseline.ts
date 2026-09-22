// Observed Baseline surface (Milestone 11.3.3.2B, §13).
//
// An ordinary `VisualGraphModel` of the confirmed current architecture --
// no per-entity proposal-provenance marker is attached here. Provenance
// qualification is meaningful only relative to a proposal's projected
// outcome (see adapt-projected.ts); the observed baseline, by itself,
// carries no proposal relationship at all.

import { emptyVisualGraphModel, type VisualGraphModel } from "@rvs/visual-intelligence";
import type { ObservedBaselineGraph } from "@rvs/proposal-architecture-review";
import { toVisualEdge, toVisualNode } from "./kg-adapt.js";

export function adaptObservedBaseline(graph: ObservedBaselineGraph): VisualGraphModel {
  const model: VisualGraphModel = emptyVisualGraphModel();
  model.nodes = graph.nodes.map((node) => toVisualNode(node));
  model.edges = graph.edges.map((edge) => toVisualEdge(edge));
  return model;
}
