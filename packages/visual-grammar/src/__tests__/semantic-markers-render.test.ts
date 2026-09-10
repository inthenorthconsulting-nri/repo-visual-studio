// Rendering of the generic semantic-marker channel (Milestone 11.3.3.2A).
//
// Three questions, asked adversarially:
//   1. Can a reader who cannot see colour tell a marked thing from an
//      unmarked one? (Both for nodes and for edges -- an edge has no
//      interior, which is where the previous change channel quietly died.)
//   2. Does the qualification reach assistive technology through the
//      accessible NAME, not only through a description a reader may never
//      request?
//   3. Does a model that carries no markers render exactly as it did before
//      the channel existed?

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VISUAL_GRAMMARS, type VisualSemanticMarker } from "@rvs/visual-intelligence";
import { renderGrammar } from "../render.js";
import { edge, model, node, richModel, shuffleModel, specFor } from "./fixtures.js";

const mk = (key: string, label: string, count?: number): VisualSemanticMarker =>
  count === undefined ? { key, label } : { key, label, count };

const digest = (svg: string) => createHash("sha256").update(svg).digest("hex").slice(0, 16);

/** Everything that could be a colour, removed -- what a monochrome print, or a reader who cannot distinguish hue, is left with. */
const stripColour = (svg: string) => svg.replace(/\s(?:fill|stroke)="[^"]*"/g, "");

const renderOf = (m: ReturnType<typeof model>, grammar: (typeof VISUAL_GRAMMARS)[number] = "dependency_graph") =>
  renderGrammar({ spec: specFor(grammar, m), model: m }).svg;

const twoNodes = (markers?: VisualSemanticMarker[], edgeMarkers?: VisualSemanticMarker[]) =>
  model({
    nodes: [node("a", markers === undefined ? {} : { semantic_markers: markers }), node("b")],
    edges: [edge("a", "b", edgeMarkers === undefined ? {} : { semantic_markers: edgeMarkers })],
  });

describe("node carrier", () => {
  it("exposes the marker keys as a space-separated machine channel, like data-rvs-state", () => {
    const svg = renderOf(twoNodes([mk("beta", "Beta"), mk("alpha", "Alpha")]));
    expect(svg).toContain('data-rvs-markers="alpha beta"');
  });

  it("draws the caller's label as visible text inside the box", () => {
    expect(renderOf(twoNodes([mk("alpha", "Alpha term")]))).toContain("Alpha term");
  });

  it("shows multiplicity when aggregation produced it", () => {
    expect(renderOf(twoNodes([mk("alpha", "Alpha", 3)]))).toContain("Alpha x3");
  });

  it("puts the qualification in the accessible NAME, not only in the description", () => {
    const svg = renderOf(twoNodes([mk("alpha", "Alpha")]));
    const titles = [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((t) => t[1]);
    expect(titles.some((t) => t.includes("marked Alpha"))).toBe(true);
  });

  it("also states it in the description, after the facts the model already carried", () => {
    const svg = renderOf(twoNodes([mk("alpha", "Alpha")]));
    const descs = [...svg.matchAll(/<desc>([^<]*)<\/desc>/g)].map((d) => d[1]);
    expect(descs.some((d) => d.includes("marked Alpha"))).toBe(true);
  });

  it("emits no marker attribute, no marker row and no marker wording for an unmarked node", () => {
    const svg = renderOf(twoNodes());
    expect(svg).not.toContain("data-rvs-markers");
    expect(svg).not.toContain("data-rvs-marker-row");
    expect(svg).not.toContain("marked ");
  });

  it("is distinguishable from an unmarked node with every colour removed", () => {
    expect(stripColour(renderOf(twoNodes([mk("alpha", "Alpha")])))).not.toBe(stripColour(renderOf(twoNodes())));
  });

  it("does not change the node's resolution, confidence, severity, decision-status, emphasis or state channels", () => {
    const attrs = (svg: string) =>
      [...svg.matchAll(/data-rvs-(resolution|confidence|severity|decision-status|emphasis|state|marker|badge)="[^"]*"/g)].map(
        (a) => a[0],
      );
    expect(attrs(renderOf(twoNodes([mk("alpha", "Alpha")])))).toEqual(attrs(renderOf(twoNodes())));
  });

  it("renders identically however the caller ordered the marker list", () => {
    const forwards = renderOf(twoNodes([mk("c", "C"), mk("a", "A"), mk("b", "B")]));
    const backwards = renderOf(twoNodes([mk("b", "B"), mk("c", "C"), mk("a", "A")]));
    expect(digest(forwards)).toBe(digest(backwards));
  });

  it("renders identically across repeated runs and input shuffles", () => {
    const m = twoNodes([mk("a", "A")], [mk("e", "E")]);
    const base = digest(renderOf(m));
    for (let i = 0; i < 5; i++) expect(digest(renderOf(m))).toBe(base);
    for (let seed = 1; seed <= 5; seed++) expect(digest(renderOf(shuffleModel(m, seed)))).toBe(base);
  });

  it("keeps the marker on a node that also carries a governance finding and a change", () => {
    const m = model({
      nodes: [node("a", { severity: "blocking", semantic_markers: [mk("alpha", "Alpha")] })],
      edges: [],
      changes: [{ id: "c1", kind: "changed", subject_id: "a", subject_type: "node", detail: "d", evidence_refs: [] }],
    });
    const svg = renderOf(m);
    expect(svg).toContain('data-rvs-markers="alpha"');
    expect(svg).toContain('data-rvs-severity="blocking"');
    expect(svg).toContain('data-rvs-change="changed"');
  });
});

describe("edge carrier", () => {
  const marked = () => twoNodes(undefined, [mk("ea", "Edge term")]);

  it("exposes marker keys on the edge group", () => {
    expect(renderOf(marked())).toContain('data-rvs-markers="ea"');
  });

  it("draws the caller's label as visible text beside the line", () => {
    expect(renderOf(marked())).toContain("Edge term");
  });

  it("states the qualification in the edge's accessible name", () => {
    const titles = [...renderOf(marked()).matchAll(/<title>([^<]*)<\/title>/g)].map((t) => t[1]);
    expect(titles.some((t) => t.includes("marked Edge term"))).toBe(true);
  });

  it("is distinguishable from an unmarked edge with every colour removed", () => {
    expect(stripColour(renderOf(marked()))).not.toBe(stripColour(renderOf(twoNodes())));
  });

  it("renders independently of resolution, emphasis and in_cycle", () => {
    const base = model({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b", { resolution: "resolved", emphasis: "normal", in_cycle: false, semantic_markers: [mk("ea", "E")] })],
    });
    const svg = renderOf(base);
    expect(svg).toContain('data-rvs-markers="ea"');
    expect(svg).toContain('data-rvs-resolution="resolved"');
    expect(svg).toContain('data-rvs-in-cycle="0"');
  });

  it("does not route through model.changes: an edge change record is still not a marker", () => {
    const m = model({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b")],
      changes: [{ id: "c1", kind: "added", subject_id: "a->b", subject_type: "edge", detail: "d", evidence_refs: [] }],
    });
    expect(renderOf(m)).not.toContain("data-rvs-markers");
  });

  it("carries a marker on a labelled edge without losing the label", () => {
    const m = model({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b", { label: "reads", semantic_markers: [mk("ea", "Edge term")] })],
    });
    const svg = renderOf(m, "data_flow");
    expect(svg).toContain("Edge term");
    expect(svg).toContain('data-rvs-markers="ea"');
  });
});

describe("stand-in accessibility", () => {
  it("states a stand-in's aggregated qualification generically, without naming any caller domain", () => {
    const m = model({
      nodes: [
        node("p", {
          kind: "cluster",
          label: "12 component nodes",
          placeholder_for: { collapsed_group_id: "g1", entity_count: 12, source_entity_ids: ["x"] },
          semantic_markers: [mk("alpha", "Alpha", 3), mk("beta", "Beta")],
        }),
      ],
      edges: [],
    });
    const svg = renderOf(m);
    const descs = [...svg.matchAll(/<desc>([^<]*)<\/desc>/g)].map((d) => d[1]);
    expect(descs.some((d) => d.includes("stands in for 12 entities shown elsewhere, marked Alpha (3), Beta"))).toBe(true);
    expect(svg).toContain('data-rvs-placeholder="1"');
    expect(svg).toContain('data-rvs-markers="alpha beta"');
  });

  it("keeps the unmarked stand-in wording exactly as it was", () => {
    const m = model({
      nodes: [
        node("p", {
          kind: "cluster",
          label: "12 component nodes",
          placeholder_for: { collapsed_group_id: "g1", entity_count: 12, source_entity_ids: ["x"] },
        }),
      ],
      edges: [],
    });
    const descs = [...renderOf(m).matchAll(/<desc>([^<]*)<\/desc>/g)].map((d) => d[1]);
    expect(descs).toContain("stands in for 12 entities shown elsewhere");
  });
});

/**
 * Every start tag in the document.
 *
 * `<` and `>` are escaped on the way into text content, so a tag boundary is
 * reliable -- which is what lets the tests below ask the only question that
 * matters for injection: did any caller text reach ATTRIBUTE position?
 */
const startTags = (svg: string) => [...svg.matchAll(/<[a-zA-Z][^>]*>/g)].map((t) => t[0]);

const hasEventHandlerAttribute = (svg: string) => startTags(svg).some((tag) => /\son[a-z]+\s*=/i.test(tag));

describe("marker text is data, never markup", () => {
  const hostile = [
    "<script>alert('x')</script>",
    '" onload="alert(1)',
    "'; drop--",
    "a & b < c > d",
    "javascript:alert(1)",
  ];

  it("escapes hostile label text in both the visible row and the accessible name", () => {
    for (const label of hostile) {
      const svg = renderOf(twoNodes([mk("k", label)], [mk("ek", label)]));
      expect(svg).not.toContain("<script>");
      expect(svg).not.toContain("</script>");
      expect(hasEventHandlerAttribute(svg)).toBe(false);
      // Caller text reaches text content only; no start tag anywhere in the
      // document carries it.
      expect(startTags(svg).some((tag) => tag.includes("alert("))).toBe(false);
      // The text survives -- escaped, not dropped: suppressing a caller's term
      // would be its own kind of erasure.
      if (label.includes("<")) expect(svg).toContain("&lt;");
      if (label.includes("&")) expect(svg).toContain("&amp;");
    }
  });

  it("keeps a hostile key out of markup structure entirely by sanitizing it to a token", () => {
    const svg = renderOf(twoNodes([mk('" onload="alert(1)', "L")]));
    expect(hasEventHandlerAttribute(svg)).toBe(false);
    expect(svg).toContain('data-rvs-markers="--onload--alert-1-"');
  });

  it("still renders a well-formed root with hostile marker text", () => {
    const svg = renderOf(twoNodes([mk("k", hostile.join(" "))]));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
});

describe("grammar coverage and backward compatibility", () => {
  it("carries node markers in every published grammar", () => {
    const m = model({
      nodes: [node("a", { semantic_markers: [mk("alpha", "Alpha")], group_id: "g", order: 0 }), node("b", { group_id: "g", order: 1 })],
      edges: [edge("a", "b")],
      groups: [{ id: "g", label: "G", kind: "domain", member_ids: ["a", "b"], synthetic: false }],
    });
    for (const grammar of VISUAL_GRAMMARS) {
      expect(renderOf(m, grammar), `${grammar} lost the node marker`).toContain('data-rvs-markers="alpha"');
    }
  });

  it("carries edge markers in every grammar that draws the model's own edge", () => {
    const m = model({
      nodes: [node("a", { group_id: "g", order: 0 }), node("b", { group_id: "g", order: 1 })],
      edges: [edge("a", "b", { semantic_markers: [mk("ea", "E")] })],
      groups: [{ id: "g", label: "G", kind: "domain", member_ids: ["a", "b"], synthetic: false }],
    });
    for (const grammar of VISUAL_GRAMMARS) {
      const svg = renderOf(m, grammar);
      // `fishbone` draws ribs it synthesizes rather than the model's edges,
      // and `matrix`/`metric_row` draw no edges at all: there is no source
      // edge on the page to carry a marker, and inventing one would be a
      // fabrication rather than a survival.
      if (!svg.includes('data-rvs-edge="a-&gt;b"')) continue;
      expect(svg, `${grammar} lost the edge marker`).toContain('data-rvs-markers="ea"');
    }
  });

  it("renders an unmarked model identically to one whose marker lists are empty", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const bare = renderOf(richModel(), grammar);
      const emptied = model({
        ...richModel(),
        nodes: richModel().nodes.map((n) => ({ ...n, semantic_markers: [] })),
        edges: richModel().edges.map((e) => ({ ...e, semantic_markers: [] })),
      });
      expect(digest(renderOf(emptied, grammar)), grammar).toBe(digest(bare));
    }
  });

  it("emits nothing marker-shaped anywhere in the fully-featured unmarked model", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const svg = renderOf(richModel(), grammar);
      expect(svg).not.toContain("data-rvs-markers");
      expect(svg).not.toContain("data-rvs-marker-row");
    }
  });
});
