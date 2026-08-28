import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VISUAL_GRAMMARS, sceneContentBox } from "@rvs/visual-intelligence";
import { GRAMMAR_ENGINES, renderGrammar } from "../render.js";
import { NEUTRAL_STYLE } from "../style.js";
import { model, node, edge, richModel, shuffleModel, specFor } from "./fixtures.js";

const render = (grammar: (typeof VISUAL_GRAMMARS)[number], m = richModel()) =>
  renderGrammar({ spec: specFor(grammar, m), model: m });

/** Digested rather than compared whole: a 30KB inequality report is unreadable, and the digest localises nothing less. */
const digest = (svg: string) => createHash("sha256").update(svg).digest("hex").slice(0, 16);

describe("every published grammar renders", () => {
  it("has an engine for all 15 grammars, with no gaps", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      expect(GRAMMAR_ENGINES[grammar]).toBeTruthy();
    }
    expect(Object.keys(GRAMMAR_ENGINES).sort()).toEqual([...VISUAL_GRAMMARS].sort());
  });

  it("produces a well-formed svg root for each", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const result = render(grammar);
      expect(result.svg.startsWith("<svg ")).toBe(true);
      expect(result.svg.endsWith("</svg>")).toBe(true);
      expect(result.svg).toContain(`data-rvs-grammar="${grammar}"`);
    }
  });

  it("draws every node the model contains, in every grammar", () => {
    // The renderer has no ability to omit an entity: whatever survived
    // adaptation is drawn. A grammar that quietly skipped a node would make
    // the fidelity receipt a lie.
    const m = richModel();
    for (const grammar of VISUAL_GRAMMARS) {
      const svg = render(grammar, m).svg;
      for (const n of m.nodes) {
        expect(svg, `${grammar} dropped ${n.id}`).toContain(`data-rvs-node="${n.id}"`);
      }
    }
  });

  it("renders an empty model without throwing and without inventing content", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const result = render(grammar, model());
      expect(result.svg).not.toContain("data-rvs-node=");
      expect(result.boxes).toEqual([]);
    }
  });

  it("survives a cyclic graph rather than dropping a back edge", () => {
    const m = model({
      nodes: [node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c"), edge("c", "a", { in_cycle: true })],
      has_cycles: true,
    });
    const svg = render("dependency_graph", m).svg;
    // Ids are escaped on the way into the attribute, so `c->a` lands as
    // `c-&gt;a` -- an id containing markup characters is data, never markup.
    for (const id of ["a-&gt;b", "b-&gt;c", "c-&gt;a"]) expect(svg).toContain(`data-rvs-edge="${id}"`);
    expect(svg).toContain('data-rvs-in-cycle="1"');
  });
});

describe("rendering is deterministic", () => {
  it("produces byte-identical output across five runs", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const runs = new Set(Array.from({ length: 5 }, () => digest(render(grammar).svg)));
      expect(runs.size, grammar).toBe(1);
    }
  });

  it("is unaffected by the order of the caller's arrays", () => {
    const m = richModel();
    for (const grammar of VISUAL_GRAMMARS) {
      const canonical = digest(render(grammar, m).svg);
      for (let seed = 1; seed <= 5; seed++) {
        expect(digest(render(grammar, shuffleModel(m, seed)).svg), `${grammar} seed ${seed}`).toBe(canonical);
      }
    }
  });

  it("emits no timestamp, hostname, or absolute path", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const svg = render(grammar).svg;
      expect(svg).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(svg).not.toMatch(/\/(Users|home|var|tmp)\//);
    }
  });
});

describe("the canonical coordinate system is the only coordinate system", () => {
  // The scene content box is the frame's floor, not its ceiling.
  //
  // Every drawing is authored in canonical units at the scene's origin, and
  // almost every one fits the scene -- the budgets in @rvs/visual-intelligence
  // exist to keep it that way. A drawing that still comes out larger grows the
  // frame rather than being scaled down into it, because scaling down takes
  // the type below the legibility floor with it, and "reduce content, never
  // shrink type" is the policy. So the invariant here is the origin, the
  // units, and the floor -- not one fixed pair of numbers.
  it("authors in the scene content box, and never emits a frame smaller than it", () => {
    const box = sceneContentBox();
    for (const grammar of VISUAL_GRAMMARS) {
      const result = render(grammar);
      const [x, y, width, height] = result.view_box.split(" ").map(Number);
      expect([x, y], grammar).toEqual([0, 0]);
      expect(width, grammar).toBeGreaterThanOrEqual(box.width);
      expect(height, grammar).toBeGreaterThanOrEqual(box.height);
      expect(result.svg, grammar).toContain(`viewBox="${result.view_box}"`);
      // Sized as well as framed: a viewBox with no intrinsic size is scaled to
      // whatever pane it lands in, which is the same shrink by another route.
      expect(result.svg, grammar).toContain(`width="${width}" height="${height}"`);
    }
  });

  it("emits the scene content box exactly, for a drawing that fits it", () => {
    const box = sceneContentBox();
    const result = render("architecture", model({ nodes: [node("solo")] }));
    expect(result.view_box).toBe(`0 0 ${box.width} ${box.height}`);
    expect(result.scale).toBe(1);
  });

  it("names the coordinate system it authored in", () => {
    expect(render("architecture").svg).toContain('data-rvs-coordinate-system="rvs-stage-16x9-v1"');
  });

  it("never scales a small diagram up to fill the frame", () => {
    const small = model({ nodes: [node("solo")] });
    expect(render("architecture", small).scale).toBe(1);
  });

  it("republishes hit-boxes for exactly the nodes it drew", () => {
    const m = richModel();
    const result = render("dependency_graph", m);
    expect(result.boxes.map((b) => b.node_id).sort()).toEqual(m.nodes.map((n) => n.id).sort());
    for (const box of result.boxes) {
      expect(box.rect.width).toBeGreaterThan(0);
      expect(box.rect.height).toBeGreaterThan(0);
    }
  });
});

describe("density is never resolved by shrinking type", () => {
  it("uses the same font sizes for a dense diagram as for a sparse one", () => {
    const sparse = model({ nodes: [node("a"), node("b")], edges: [edge("a", "b")] });
    const dense = model({
      nodes: Array.from({ length: 40 }, (_, i) => node(`n${String(i).padStart(2, "0")}`)),
      edges: Array.from({ length: 39 }, (_, i) => edge(`n${String(i).padStart(2, "0")}`, `n${String(i + 1).padStart(2, "0")}`)),
    });
    const sizesIn = (svg: string) => new Set([...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1]));
    expect([...sizesIn(render("dependency_graph", dense).svg)].sort()).toEqual(
      [...sizesIn(render("dependency_graph", sparse).svg)].sort(),
    );
  });

  it("exposes no scale, zoom, or font-shrinking control in its result", () => {
    const keys = Object.keys(render("architecture"));
    expect(keys).not.toContain("font_scale");
    // `scale` exists, but only ever fits content into the frame -- it is
    // capped at 1 and applies uniformly to the whole drawing, so it can
    // never be used to squeeze one crowded region.
    expect(render("architecture").scale).toBeLessThanOrEqual(1);
  });
});
