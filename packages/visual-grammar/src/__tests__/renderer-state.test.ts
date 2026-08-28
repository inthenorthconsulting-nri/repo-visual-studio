import { describe, expect, it } from "vitest";
import { MINIMUM_TEXT_SIZE_PX, resolveVisualDesignTokens } from "@rvs/visual-intelligence";
import type { VisualChange, VisualGraphModel } from "@rvs/visual-intelligence";
import { grammarStyleFromTokens } from "../tokens-bridge.js";
import { renderGrammar } from "../render.js";
import { model, node, edge, specFor } from "./fixtures.js";

// The grammar renderer, wired to the shared state model.
//
// Milestone 10.5 §55 puts node styling, states and accessibility hooks in the
// shared layer and leaves layout semantics with the grammar. These are the
// proofs that the wiring actually happened here rather than the renderer
// keeping a private opinion: the states a node resolves to must reach the
// document, and the same facts must be legible without colour and without a
// pointer.

function change(subject: string, kind: VisualChange["kind"]): VisualChange {
  return {
    id: `chg-${subject}`,
    kind,
    subject_id: subject,
    subject_type: "node",
    detail: `${subject} was ${kind}.`,
    evidence_refs: [],
  };
}

function delta(): VisualGraphModel {
  return model({
    nodes: [
      node("api", { kind: "runtime_entrypoint" }),
      node("cost", { kind: "component" }),
      node("legacy", { kind: "component", severity: "blocking" }),
      node("core", { kind: "component" }),
      node("ghost", { kind: "component", resolution: "unresolved", confidence: "unverifiable" }),
    ],
    edges: [edge("api", "core"), edge("core", "legacy")],
    changes: [change("cost", "added"), change("legacy", "removed"), change("core", "changed")],
  });
}

const svgOf = (m: VisualGraphModel, grammar: Parameters<typeof specFor>[0] = "architecture") =>
  renderGrammar({ spec: specFor(grammar, m), model: m }).svg;

/** The `<g>` a node was drawn into, isolated so one node's attributes cannot be read off another's. */
function groupOf(svg: string, id: string): string {
  const start = svg.indexOf(`data-rvs-node="${id}"`);
  expect(start, `node ${id} was not drawn`).toBeGreaterThan(-1);
  const open = svg.lastIndexOf("<g", start);
  return svg.slice(open, svg.indexOf("</g>", start) + 4);
}

const attr = (fragment: string, name: string): string | undefined =>
  fragment.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe("resolved state reaches the document", () => {
  it("lists every simultaneously-true state, so neither one overwrites the other", () => {
    // `legacy` is removed *and* under a blocking finding. Milestone 10.5 §21
    // is explicit that both meanings survive; a single precedence chain would
    // have dropped one of them.
    const states = attr(groupOf(svgOf(delta()), "legacy"), "data-rvs-state")!.split(" ");
    expect(states).toContain("removed");
    expect(states).toContain("blocking");
  });

  it("maps resolution and confidence onto the shared vocabulary rather than a local one", () => {
    const states = attr(groupOf(svgOf(delta()), "ghost"), "data-rvs-state")!.split(" ");
    // Both land in the confidence layer, so the layer -- not this renderer --
    // decides which one presents. Both are still declared.
    expect(states).toContain("unresolved");
    expect(states).toContain("qualified");
  });

  it("omits the attribute entirely on a node with nothing to say", () => {
    expect(attr(groupOf(svgOf(delta()), "api"), "data-rvs-state")).toBeUndefined();
  });

  it("does not mint keyboard focus out of editorial prominence", () => {
    const m = model({ nodes: [node("a", { emphasis: "focal" })], edges: [] });
    const group = groupOf(svgOf(m), "a");
    expect(attr(group, "data-rvs-emphasis")).toBe("focal");
    expect(group).not.toContain("focused");
  });
});

describe("B1 -- a compound state keeps both meanings on the drawn box, not only in the attributes", () => {
  // The `data-rvs-state` and `<title>` proofs above already passed while the
  // production bug was live: both are written straight from
  // `resolveVisualState`'s output, never from the box's own paint. This block
  // is the renderer-layer half of Milestone 10's matrix -- it reads the same
  // signals a sighted reviewer or a printed page would, the `<rect>` and the
  // `<text>` nodes actually drawn into the box.
  function matrix(): VisualGraphModel {
    return model({
      nodes: [
        node("removed-blocking", { severity: "blocking" }),
        node("removed-review", { severity: "review_required" }),
        node("changed-blocking", { severity: "blocking" }),
        node("changed-unresolved", { resolution: "unresolved" }),
      ],
      edges: [],
      changes: [
        change("removed-blocking", "removed"),
        change("removed-review", "removed"),
        change("changed-blocking", "changed"),
        change("changed-unresolved", "changed"),
      ],
    });
  }

  const rectOf = (fragment: string): string => fragment.match(/<rect[^>]*>/)![0];
  const badgeText = (fragment: string): string | undefined =>
    fragment.match(/<text[^>]*aria-hidden="true"[^>]*>([^<]*)<\/text>/g)?.map((t) => t.match(/>([^<]*)</)![1]).find((t) => t !== "+" && t !== "−" && t !== "~" && t !== "↷");

  it("draws a marker and a badge as two separate, non-overlapping text nodes", () => {
    const svg = svgOf(matrix());
    const group = groupOf(svg, "removed-blocking");
    expect(attr(group, "data-rvs-marker")).toBe("−");
    expect(badgeText(group)).toBe("Blocking");
    const markerFragment = group.match(/<text[^>]*>−<\/text>/)![0];
    const badgeFragment = group.match(/<text[^>]*aria-hidden="true"[^>]*>Blocking<\/text>/)![0];
    const markerX = Number(attr(markerFragment, "x"));
    const badgeX = Number(attr(badgeFragment, "x"));
    // The marker sits in the trailing gutter and the badge in the leading
    // one, so a node that is both draws both instead of one displacing the
    // other -- B1's failure was that the badge was never drawn at all.
    expect(badgeX).toBeLessThan(markerX);
    expect(attr(badgeFragment, "text-anchor")).toBe("start");
  });

  it("colours the border by the governance role that actually asked for it, not by the lifecycle colour", () => {
    const svg = svgOf(matrix());
    const compoundStroke = attr(rectOf(groupOf(svg, "changed-blocking")), "stroke");
    // changed's own colour and blocking's colour are distinct tokens (see
    // `roleColor`), so if the compound node's border matches a blocking-only
    // node rather than a changed-only node, the resolved governance
    // precedence -- not a fixed "lifecycle always wins the border" rule --
    // reached the paint.
    const blockingOnly = model({ nodes: [node("b", { severity: "blocking" })], edges: [], changes: [] });
    const changedOnly = model({ nodes: [node("c")], edges: [], changes: [change("c", "changed")] });
    const blockingStroke = attr(rectOf(groupOf(svgOf(blockingOnly), "b")), "stroke");
    const changedStroke = attr(rectOf(groupOf(svgOf(changedOnly), "c")), "stroke");
    expect(changedStroke).not.toBe(blockingStroke);
    expect(compoundStroke).toBe(blockingStroke);
    expect(compoundStroke).not.toBe(changedStroke);
  });

  it("scales the stroke width from the resolved channel instead of a fixed emphasis value", () => {
    const svg = svgOf(matrix());
    const blockingWidth = Number(attr(rectOf(groupOf(svg, "removed-blocking")), "stroke-width"));
    const reviewWidth = Number(attr(rectOf(groupOf(svg, "removed-review")), "stroke-width"));
    const plainWidth = Number(
      attr(rectOf(groupOf(svgOf(model({ nodes: [node("plain")], edges: [], changes: [] })), "plain")), "stroke-width"),
    );
    // Blocking doubles the base width, review-required scales it by 1.5: a
    // node under a blocking finding must read as more severe than one under
    // review, and both must read as heavier than an untouched node.
    expect(blockingWidth).toBeGreaterThan(reviewWidth);
    expect(reviewWidth).toBeGreaterThan(plainWidth);
  });

  it("takes the dash pattern from confidence even when lifecycle is the reason the node changed", () => {
    // `changed` alone draws a solid border -- only `unresolved` asks for a
    // dashed one. If the renderer still read `node.resolution` directly
    // instead of the resolved channel this would coincidentally pass too, so
    // it is paired with the solid case to be a real proof.
    const svg = svgOf(matrix());
    const dashed = attr(rectOf(groupOf(svg, "changed-unresolved")), "stroke-dasharray");
    const solid = attr(rectOf(groupOf(svgOf(matrix()), "changed-blocking")), "stroke-dasharray");
    expect(dashed).toBe("6 4");
    expect(solid).toBeUndefined();
  });

  it("draws no badge for a node whose only active layers are lifecycle and confidence", () => {
    const group = groupOf(svgOf(matrix()), "changed-unresolved");
    expect(badgeText(group)).toBeUndefined();
  });

  it("keeps the badge inside the box it annotates", () => {
    const result = renderGrammar({ spec: specFor("architecture", matrix()), model: matrix() });
    const box = result.boxes.find((b) => b.node_id === "removed-blocking")!;
    const group = groupOf(result.svg, "removed-blocking");
    const badge = group.match(/<text[^>]*aria-hidden="true"[^>]*>Blocking<\/text>/)![0];
    const x = Number(attr(badge, "x"));
    const y = Number(attr(badge, "y"));
    expect(x).toBeGreaterThanOrEqual(box.rect.x);
    expect(x).toBeLessThan(box.rect.x + box.rect.width);
    expect(y).toBeGreaterThan(box.rect.y);
    expect(y).toBeLessThan(box.rect.y + box.rect.height);
  });

  it("never mints keyboard focus or a traced route out of static model fields", () => {
    // `focused` and `route` are interaction-layer states that only ever
    // arrive from an interactive runtime (see `nodeStates`'s own comment);
    // this renderer has no field that produces them, so "focused + blocking"
    // and "route + removed" cannot be exercised through `renderGrammar` --
    // only through `resolveVisualState` directly, which
    // `visual-state.test.ts`'s compound-matrix block covers. This test pins
    // that absence so a future change to `nodeStates` that starts inferring
    // interaction state from static fields is caught here.
    const svg = svgOf(matrix());
    for (const id of ["removed-blocking", "removed-review", "changed-blocking", "changed-unresolved"]) {
      const group = groupOf(svg, id);
      expect(group, id).not.toContain("focused");
      expect(group, id).not.toContain("route");
    }
  });
});

describe("change semantics survive without colour", () => {
  // Proof 12. A reviewer who cannot distinguish the palette must still be
  // able to tell an addition from a removal.
  const stripPaint = (fragment: string) =>
    fragment.replace(/\s(?:fill|stroke)="[^"]*"/g, "").replace(/\sdata-rvs-change="[^"]*"/g, "");

  it("gives added, removed and changed distinct glyphs", () => {
    const svg = svgOf(delta());
    const markers = ["cost", "legacy", "core"].map((id) => attr(groupOf(svg, id), "data-rvs-marker"));
    expect(markers).toEqual(["+", "−", "~"]);
    expect(new Set(markers).size).toBe(3);
  });

  it("draws the glyph into the picture, not only into an attribute", () => {
    const drawn = [...groupOf(svgOf(delta()), "cost").matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(drawn).toContain("+");
  });

  it("leaves three changed nodes distinguishable after every colour is removed", () => {
    const svg = svgOf(delta());
    const stripped = ["cost", "legacy", "core"].map((id) => stripPaint(groupOf(svg, id)));
    // Sanity: the strip really did remove the colours it claims to.
    for (const fragment of stripped) expect(fragment).not.toContain('stroke="#');
    const signatures = stripped.map((f) => `${attr(f, "data-rvs-state")}|${attr(f, "data-rvs-marker")}`);
    expect(new Set(signatures).size).toBe(3);
  });

  it("hides the glyph from assistive technology, which already hears the word", () => {
    const group = groupOf(svgOf(delta()), "cost");
    expect(group).toContain('aria-hidden="true"');
    expect(group).toContain("<title>Component cost, added</title>");
  });

  it("keeps the glyph inside the box it annotates", () => {
    const result = renderGrammar({ spec: specFor("architecture", delta()), model: delta() });
    const box = result.boxes.find((b) => b.node_id === "cost")!;
    const group = groupOf(result.svg, "cost");
    const marker = group.match(/<text[^>]*>\+<\/text>/)![0];
    const x = Number(attr(marker, "x"));
    const y = Number(attr(marker, "y"));
    expect(x).toBeGreaterThan(box.rect.x);
    expect(x).toBeLessThanOrEqual(box.rect.x + box.rect.width);
    expect(y).toBeGreaterThan(box.rect.y);
    expect(y).toBeLessThan(box.rect.y + box.rect.height);
  });
});

describe("accessible names say what the thing is", () => {
  // Proof 13. §28: "Component packages/cli, changed, governance review
  // required" -- never "node-42".
  it("composes kind, label and state terms", () => {
    expect(svgOf(delta())).toContain("<title>Component legacy, removed, governance blocking</title>");
  });

  it("names a stand-in as a stand-in before anything else", () => {
    const m = model({
      nodes: [
        node("more", {
          label: "Core",
          placeholder_for: {
            collapsed_group_id: "cg-core",
            entity_count: 12,
            source_entity_ids: ["a", "b"],
          },
        }),
      ],
      edges: [],
    });
    const group = groupOf(svgOf(m), "more");
    expect(group).toContain("<title>Stand-in Core</title>");
    expect(group).toContain("stands in for 12 entities shown elsewhere");
  });

  it("gives every drawn node both a name and a description", () => {
    const svg = svgOf(delta());
    for (const id of ["api", "cost", "legacy", "core", "ghost"]) {
      const group = groupOf(svg, id);
      expect(group, id).toMatch(/<title>[^<]+<\/title>/);
      expect(group, id).toMatch(/<desc>[^<]+<\/desc>/);
    }
  });

  it("never falls back to an internal id as the name", () => {
    const m = model({ nodes: [node("n-42", { label: "Billing", kind: "component" })], edges: [] });
    expect(svgOf(m)).toContain("<title>Component Billing</title>");
  });
});

describe("the static drawing is complete on its own", () => {
  // Proof 26. §25: essential information may not live behind hover.
  it("states every node's governance, resolution and change facts in the static markup", () => {
    const svg = svgOf(delta());
    for (const [id, term] of [
      ["legacy", "governance blocking"],
      ["ghost", "unresolved"],
      ["cost", "added"],
      ["core", "changed"],
    ] as const) {
      expect(groupOf(svg, id), id).toContain(term);
    }
  });

  it("carries no hover-only handler and no script", () => {
    const svg = svgOf(delta());
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/\son(?:mouse|click|load)/i);
  });

  it("renders identically five times over", () => {
    const runs = [1, 2, 3, 4, 5].map(() => svgOf(delta()));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("the default style is the token-derived one", () => {
  // §32: there is one source of truth for the minimum legible size, and a
  // render that names no theme still has to clear it. The 10.2 hand-written
  // neutral style did not -- it declared secondary at 12px and annotation at
  // 11px -- and the explorer and change-review viewer both compose without
  // naming a style, so every one of their diagrams shipped sub-floor text.

  const sizesIn = (svg: string): number[] =>
    [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));

  it("draws no text below the floor the validator enforces", () => {
    const sizes = sizesIn(svgOf(delta()));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
  });

  it("holds across every grammar the fixture can be drawn in", () => {
    for (const grammar of ["architecture", "dependency_graph", "fishbone", "process"] as const) {
      for (const size of sizesIn(svgOf(delta(), grammar))) {
        expect(size, grammar).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
      }
    }
  });

  it("still lets a caller supply its own style", () => {
    // The seam is a default, not a lock. A theme resolved from a checked-in
    // profile has to win, or §4's token pipeline would be decorative.
    const themed = grammarStyleFromTokens(resolveVisualDesignTokens({ polarity: "dark" }).tokens);
    const DEFAULT_TOKEN_STYLE = grammarStyleFromTokens();
    const m = delta();
    const svg = renderGrammar({ spec: specFor("architecture", m), model: m, style: themed }).svg;
    // The node fill, not the canvas: the SVG paints no background of its own,
    // so the page behind it carries `surface.canvas`.
    expect(svg).toContain(themed.surface.node);
    expect(svg).not.toContain(DEFAULT_TOKEN_STYLE.surface.node);
  });
});
