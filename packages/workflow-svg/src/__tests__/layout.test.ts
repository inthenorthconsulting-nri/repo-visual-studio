import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_OPTIONS, LayeredLayoutEngine } from "../layout.js";

const engine = new LayeredLayoutEngine();

describe("LayeredLayoutEngine", () => {
  it("places a source node strictly before its successor along the main axis", () => {
    const nodes = [
      { id: "b", width: 100, height: 50 },
      { id: "a", width: 100, height: 50 },
    ];
    const edges = [{ id: "e1", from: "a", to: "b" }];
    const result = engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS);

    const a = result.nodes.find((n) => n.id === "a")!;
    const b = result.nodes.find((n) => n.id === "b")!;
    expect(a.layer).toBeLessThan(b.layer);
    expect(a.y).toBeLessThan(b.y);
  });

  it("produces identical output across repeated runs on the same input (determinism)", () => {
    const nodes = [
      { id: "c", width: 120, height: 50 },
      { id: "a", width: 90, height: 50 },
      { id: "b", width: 110, height: 50 },
    ];
    const edges = [
      { id: "e1", from: "a", to: "c" },
      { id: "e2", from: "b", to: "c" },
    ];
    const first = engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS);
    const second = engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS);
    expect(first).toEqual(second);
  });

  it("orders same-layer nodes deterministically by sorted id", () => {
    const nodes = [
      { id: "z-job", width: 100, height: 50 },
      { id: "a-job", width: 100, height: 50 },
      { id: "m-job", width: 100, height: 50 },
    ];
    const result = engine.layout(nodes, [], DEFAULT_LAYOUT_OPTIONS);
    const sameLayer = result.nodes.filter((n) => n.layer === 0).sort((a, b) => a.x - b.x);
    expect(sameLayer.map((n) => n.id)).toEqual(["a-job", "m-job", "z-job"]);
  });

  it("does not overlap sibling nodes within the same layer", () => {
    const nodes = [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
      { id: "c", width: 100, height: 50 },
    ];
    const result = engine.layout(nodes, [], DEFAULT_LAYOUT_OPTIONS);
    const sorted = [...result.nodes].sort((x, y) => x.x - y.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width);
    }
  });

  it("handles a cyclic edge set without throwing, assigning every node a layer", () => {
    const nodes = [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
    ];
    const edges = [
      { id: "e1", from: "a", to: "b" },
      { id: "e2", from: "b", to: "a" },
    ];
    expect(() => engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS)).not.toThrow();
    const result = engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.every((n) => typeof n.layer === "number")).toBe(true);
  });

  it("lays out left-to-right by varying x rather than y across layers", () => {
    const nodes = [
      { id: "a", width: 100, height: 50 },
      { id: "b", width: 100, height: 50 },
    ];
    const edges = [{ id: "e1", from: "a", to: "b" }];
    const result = engine.layout(nodes, edges, { ...DEFAULT_LAYOUT_OPTIONS, direction: "left-to-right" });
    const a = result.nodes.find((n) => n.id === "a")!;
    const b = result.nodes.find((n) => n.id === "b")!;
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBe(b.y);
  });

  it("returns an empty-but-valid layout for a graph with no nodes", () => {
    const result = engine.layout([], [], DEFAULT_LAYOUT_OPTIONS);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("drops positioned edges whose endpoints are not in the node set", () => {
    const nodes = [{ id: "a", width: 100, height: 50 }];
    const edges = [{ id: "e1", from: "a", to: "missing" }];
    const result = engine.layout(nodes, edges, DEFAULT_LAYOUT_OPTIONS);
    expect(result.edges).toEqual([]);
  });
});
