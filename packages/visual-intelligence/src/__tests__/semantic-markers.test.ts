// The generic semantic-marker contract (Milestone 11.3.3.2A).
//
// Two properties are load-bearing and everything else in this file supports
// them: the canonical form of a marker set is a pure function of its
// *content* (never of the order a caller happened to write it in), and the
// canonical form of an *unmarked* entity is byte-identical to what it was
// before this channel existed.

import { describe, expect, it } from "vitest";
import {
  aggregateSemanticMarkers,
  describeSemanticMarkers,
  normalizeSemanticMarkers,
  semanticMarkerTagText,
  semanticMarkerTokens,
  type VisualSemanticMarker,
} from "../semantic-markers.js";
import { normalizeVisualGraphModel } from "../data-model.js";
import { digestOf } from "../ids.js";
import { edge, model, node, shuffleModel } from "./fixtures.js";

const m = (key: string, label = key, count?: number): VisualSemanticMarker =>
  count === undefined ? { key, label } : { key, label, count };

describe("normalization: canonical form", () => {
  it("returns undefined for absent and empty lists, so an unmarked entity carries no field", () => {
    expect(normalizeSemanticMarkers(undefined)).toBeUndefined();
    expect(normalizeSemanticMarkers([])).toBeUndefined();
  });

  it("sorts by key, so input order cannot reach the output", () => {
    const forwards = normalizeSemanticMarkers([m("c"), m("a"), m("b")]);
    const backwards = normalizeSemanticMarkers([m("b"), m("c"), m("a")]);
    expect(forwards?.map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(digestOf(forwards)).toBe(digestOf(backwards));
  });

  it("is idempotent: normalizing a canonical set changes nothing", () => {
    const once = normalizeSemanticMarkers([m("b", "B", 3), m("a", "A")]);
    expect(normalizeSemanticMarkers(once)).toEqual(once);
  });

  it("omits count when it is one, so a singly-marked entity has the shape a caller would write", () => {
    expect(normalizeSemanticMarkers([m("a", "A", 1)])).toEqual([{ key: "a", label: "A" }]);
    expect(normalizeSemanticMarkers([m("a", "A")])).toEqual([{ key: "a", label: "A" }]);
  });

  it("sanitizes keys through the repository's existing id authority rather than a second algorithm", () => {
    expect(normalizeSemanticMarkers([m("a b/c:d", "L")])?.[0].key).toBe("a-b-c-d");
  });

  it("whitespace-normalizes labels so two spellings of one term cannot both survive", () => {
    expect(normalizeSemanticMarkers([m("a", "  Two   words  ")])?.[0].label).toBe("Two words");
  });

  it("drops a marker with no key or no label: it qualifies nothing", () => {
    expect(normalizeSemanticMarkers([m("", "L")])).toBeUndefined();
    expect(normalizeSemanticMarkers([m("a", "   ")])).toBeUndefined();
    expect(normalizeSemanticMarkers([m("a", "A"), m("", "B")])).toEqual([{ key: "a", label: "A" }]);
  });

  it("clamps a nonsensical count to one rather than transporting it", () => {
    for (const bad of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeSemanticMarkers([m("a", "A", bad)])).toEqual([{ key: "a", label: "A" }]);
    }
    expect(normalizeSemanticMarkers([m("a", "A", 2.9)])).toEqual([{ key: "a", label: "A", count: 2 }]);
  });
});

describe("normalization: duplicate resolution never depends on input order", () => {
  it("collapses duplicate keys and sums multiplicity", () => {
    expect(normalizeSemanticMarkers([m("a", "A"), m("a", "A"), m("a", "A", 3)])).toEqual([
      { key: "a", label: "A", count: 5 },
    ]);
  });

  it("resolves a conflicting label by canonical authority, identically in both orders", () => {
    const forwards = normalizeSemanticMarkers([m("a", "Zebra"), m("a", "Alpha")]);
    const backwards = normalizeSemanticMarkers([m("a", "Alpha"), m("a", "Zebra")]);
    expect(forwards).toEqual([{ key: "a", label: "Alpha", count: 2 }]);
    expect(forwards).toEqual(backwards);
  });

  it("collides two caller keys that sanitize to the same token, deterministically", () => {
    const forwards = normalizeSemanticMarkers([m("a b", "Second"), m("a-b", "First")]);
    const backwards = normalizeSemanticMarkers([m("a-b", "First"), m("a b", "Second")]);
    expect(forwards).toEqual([{ key: "a-b", label: "First", count: 2 }]);
    expect(forwards).toEqual(backwards);
  });
});

describe("aggregation: the union is non-lossy by marker kind", () => {
  it("preserves {m1, m2, m3} from members marked {m1}, {m2}, {m1, m3}", () => {
    const result = aggregateSemanticMarkers([[m("m1")], [m("m2")], [m("m1"), m("m3")]]);
    expect(result?.map((x) => x.key)).toEqual(["m1", "m2", "m3"]);
    expect(result).toEqual([
      { key: "m1", label: "m1", count: 2 },
      { key: "m2", label: "m2" },
      { key: "m3", label: "m3" },
    ]);
  });

  it("does not select a single winner even when one kind dominates", () => {
    const nine = Array.from({ length: 9 }, () => [m("a", "A")]);
    const result = aggregateSemanticMarkers([...nine, [m("b", "B")]]);
    expect(result?.map((x) => x.key)).toEqual(["a", "b"]);
  });

  it("distinguishes 9xA+1xB from 1xA+9xB: multiplicity is carried, not discarded", () => {
    const heavyA = aggregateSemanticMarkers([
      ...Array.from({ length: 9 }, () => [m("a", "A")]),
      [m("b", "B")],
    ]);
    const heavyB = aggregateSemanticMarkers([
      [m("a", "A")],
      ...Array.from({ length: 9 }, () => [m("b", "B")]),
    ]);
    expect(heavyA).toEqual([
      { key: "a", label: "A", count: 9 },
      { key: "b", label: "B" },
    ]);
    expect(heavyB).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B", count: 9 },
    ]);
    expect(digestOf(heavyA)).not.toBe(digestOf(heavyB));
    expect(describeSemanticMarkers(heavyA)).not.toBe(describeSemanticMarkers(heavyB));
    expect(semanticMarkerTagText(heavyA)).not.toBe(semanticMarkerTagText(heavyB));
  });

  it("is order-independent across member groups", () => {
    const groups = [[m("c")], [m("a")], undefined, [m("b"), m("a")]];
    const reversed = [...groups].reverse();
    expect(digestOf(aggregateSemanticMarkers(groups))).toBe(digestOf(aggregateSemanticMarkers(reversed)));
  });

  it("aggregating already-aggregated sets equals aggregating the leaves (a stand-in of stand-ins cannot drift)", () => {
    const left = aggregateSemanticMarkers([[m("a")], [m("b")]]);
    const right = aggregateSemanticMarkers([[m("b")], [m("c")]]);
    expect(aggregateSemanticMarkers([left, right])).toEqual(
      aggregateSemanticMarkers([[m("a")], [m("b")], [m("b")], [m("c")]]),
    );
  });

  it("returns undefined when every member is unmarked", () => {
    expect(aggregateSemanticMarkers([undefined, [], undefined])).toBeUndefined();
  });
});

describe("presentation helpers state attachment, never authority", () => {
  it("spells the caller's own terms with multiplicity, and no judgement word of its own", () => {
    expect(describeSemanticMarkers([m("a", "Alpha", 3), m("b", "Beta")])).toBe("marked Alpha (3), Beta");
    expect(semanticMarkerTagText([m("a", "Alpha", 3), m("b", "Beta")])).toBe("Alpha x3 · Beta");
  });

  it("emits keys only into the machine channel, space-separated like data-rvs-state", () => {
    expect(semanticMarkerTokens([m("b", "B"), m("a", "A")])).toBe("a b");
    expect(semanticMarkerTokens(undefined)).toBeUndefined();
  });

  it("adds no word implying verification, certification, approval, safety, or observation", () => {
    const phrase = describeSemanticMarkers([m("a", "Alpha")]) ?? "";
    for (const word of ["verified", "certified", "approved", "safe", "observed", "confirmed", "valid"]) {
      expect(phrase.toLowerCase()).not.toContain(word);
    }
  });
});

describe("model normalization carries the channel without disturbing anything else", () => {
  it("normalizes markers on nodes and on edges", () => {
    const normalized = normalizeVisualGraphModel(
      model({
        nodes: [node("a", { semantic_markers: [m("z", "Z"), m("y", "Y")] })],
        edges: [edge("a", "a", { semantic_markers: [m("q", "Q"), m("q", "Q")] })],
      }),
    );
    expect(normalized.nodes[0].semantic_markers?.map((x) => x.key)).toEqual(["y", "z"]);
    expect(normalized.edges[0].semantic_markers).toEqual([{ key: "q", label: "Q", count: 2 }]);
  });

  it("leaves an unmarked model byte-identical: no semantic_markers key appears anywhere", () => {
    const before = model({ nodes: [node("a"), node("b")], edges: [edge("a", "b")] });
    const normalized = normalizeVisualGraphModel(before);
    expect(JSON.stringify(normalized)).not.toContain("semantic_markers");
    for (const n of normalized.nodes) expect("semantic_markers" in n).toBe(false);
    for (const e of normalized.edges) expect("semantic_markers" in e).toBe(false);
  });

  it("removes the field entirely when a caller supplies an empty list", () => {
    const normalized = normalizeVisualGraphModel(model({ nodes: [node("a", { semantic_markers: [] })] }));
    expect("semantic_markers" in normalized.nodes[0]).toBe(false);
  });

  it("digests identically when the caller shuffles marker order", () => {
    const build = (markers: VisualSemanticMarker[]) =>
      model({ nodes: [node("a", { semantic_markers: markers })], edges: [] });
    const forwards = normalizeVisualGraphModel(build([m("c"), m("a"), m("b")]));
    const backwards = normalizeVisualGraphModel(build([m("b"), m("c"), m("a")]));
    expect(digestOf(forwards)).toBe(digestOf(backwards));
  });

  it("stays deterministic under the whole-model shuffle the determinism gate uses", () => {
    const marked = model({
      nodes: [node("a", { semantic_markers: [m("x", "X")] }), node("b", { semantic_markers: [m("y", "Y")] })],
      edges: [edge("a", "b", { semantic_markers: [m("z", "Z")] })],
    });
    const base = digestOf(normalizeVisualGraphModel(marked));
    for (let seed = 1; seed <= 5; seed++) {
      expect(digestOf(normalizeVisualGraphModel(shuffleModel(marked, seed)))).toBe(base);
    }
  });

  it("does not touch resolution, confidence, severity, decision_status, emphasis or kind", () => {
    const source = node("a", {
      emphasis: "muted",
      resolution: "partial",
      confidence: "qualified",
      severity: "blocking",
      decision_status: "superseded",
      semantic_markers: [m("x", "X")],
    });
    const out = normalizeVisualGraphModel(model({ nodes: [source] })).nodes[0];
    expect(out.emphasis).toBe("muted");
    expect(out.resolution).toBe("partial");
    expect(out.confidence).toBe("qualified");
    expect(out.severity).toBe("blocking");
    expect(out.decision_status).toBe("superseded");
    expect(out.kind).toBe(source.kind);
  });
});
