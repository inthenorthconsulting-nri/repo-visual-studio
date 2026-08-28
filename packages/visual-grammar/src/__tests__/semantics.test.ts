import { describe, expect, it } from "vitest";
import { renderGrammar } from "../render.js";
import { NEUTRAL_STYLE } from "../style.js";
import { measureText, truncateToWidth, wrapToLines } from "../text.js";
import { MAX_NODE_WIDTH, sizeNode } from "../sizing.js";
import { model, node, edge, richModel, shuffleModel, specFor } from "./fixtures.js";

const render = (grammar: Parameters<typeof specFor>[0], m = richModel()) =>
  renderGrammar({ spec: specFor(grammar, m), model: m });

describe("before and after share one geometry", () => {
  it("places an unchanged node at the same height in both panels, offset by exactly one panel", () => {
    // The question a change review asks is "what moved?". If each panel were
    // laid out independently, an untouched component could land somewhere
    // else on the right-hand side and read as a change that never happened.
    const result = render("delta");
    const before = new Map(result.boxes.filter((b) => b.instance === "before").map((b) => [b.node_id, b.rect]));
    const after = new Map(result.boxes.filter((b) => b.instance === "after").map((b) => [b.node_id, b.rect]));

    const shared = [...before.keys()].filter((id) => after.has(id)).sort();
    expect(shared.length).toBeGreaterThan(3);

    const offsets = new Set<string>();
    for (const id of shared) {
      const a = before.get(id)!;
      const b = after.get(id)!;
      expect(b.y, `${id} moved vertically`).toBeCloseTo(a.y, 6);
      expect(b.width, `${id} changed width`).toBeCloseTo(a.width, 6);
      offsets.add((b.x - a.x).toFixed(4));
    }
    // One offset for every shared node: the panels are a translation of each
    // other, not two similar drawings.
    expect(offsets.size).toBe(1);
  });

  it("omits an added node from the before panel and a removed node from the after panel", () => {
    const result = render("delta");
    const inPanel = (panel: string) =>
      new Set(result.boxes.filter((b) => b.instance === panel).map((b) => b.node_id));
    // richModel marks `cost` added, `legacy` removed, `core` changed.
    expect(inPanel("before").has("cost")).toBe(false);
    expect(inPanel("after").has("cost")).toBe(true);
    expect(inPanel("before").has("legacy")).toBe(true);
    expect(inPanel("after").has("legacy")).toBe(false);
    for (const panel of ["before", "after"]) expect(inPanel(panel).has("core")).toBe(true);
  });
});

describe("the delta panel is the same drawing, filtered", () => {
  const panelOf = (result: ReturnType<typeof render>, panel: string) =>
    new Map(result.boxes.filter((b) => b.instance === panel).map((b) => [b.node_id, b.rect]));

  it("holds every changed entity and nothing that did not change", () => {
    // The middle panel answers "what changed", so anything else standing in it
    // is a reader being told something changed that did not.
    const delta = panelOf(render("delta"), "delta");
    expect([...delta.keys()].sort()).toEqual(["core", "cost", "legacy"]);
  });

  it("sits a changed entity at the same height as its own before and after", () => {
    // This is what makes the three panels readable as one row per entity: the
    // eye travels left to right across a single line and sees one component in
    // all three states, rather than hunting for it three times.
    const result = render("delta");
    const [before, delta, after] = ["before", "delta", "after"].map((p) => panelOf(result, p));
    expect(delta.get("core")!.y).toBeCloseTo(before.get("core")!.y, 6);
    expect(delta.get("core")!.y).toBeCloseTo(after.get("core")!.y, 6);
    expect(delta.get("legacy")!.y).toBeCloseTo(before.get("legacy")!.y, 6);
    expect(delta.get("cost")!.y).toBeCloseTo(after.get("cost")!.y, 6);
    // And it sits exactly one panel to the right of the before state.
    const step = delta.get("core")!.x - before.get("core")!.x;
    expect(after.get("core")!.x - delta.get("core")!.x).toBeCloseTo(step, 6);
  });

  it("draws both ends of a changed relationship, so no arrow floats", () => {
    // A rerouted dependency drawn with nothing at either end tells the reader
    // that *something* moved and not what it moved between.
    const m = richModel();
    const rerouted = model({
      ...m,
      changes: [
        {
          id: "e1",
          kind: "changed",
          subject_id: "core->store",
          subject_type: "edge",
          detail: "rerouted",
          evidence_refs: [],
        },
      ],
    });
    const delta = panelOf(renderGrammar({ spec: specFor("delta", rerouted), model: rerouted }), "delta");
    expect([...delta.keys()].sort()).toEqual(["core", "store"]);
  });

  it("serialises before, then delta, then after", () => {
    // Reading order is the order the story is told in, and the order a screen
    // reader follows. Alphabetically "after" sorts first, which is the wrong
    // story, so the panels are ordered by index rather than by name.
    const result = render("delta");
    const panels = result.boxes.map((b) => b.instance);
    expect([...new Set(panels)]).toEqual(["before", "delta", "after"]);
    const captions = [...result.svg.matchAll(/>(Before|Delta|After)</g)].map((m2) => m2[1]);
    expect(captions).toEqual(["Before", "Delta", "After"]);
  });

  it("draws a container on a panel only where that panel holds something inside it", () => {
    // An empty container on the delta panel would read as "this subsystem
    // changed and everything in it is hidden" -- a claim about the
    // architecture that a layout has no business making.
    const groups = [...render("delta").svg.matchAll(/data-rvs-group="([^"]+)"/g)].map((m2) => m2[1]).sort();
    // `edge` holds api and auth, neither of which changed.
    expect(groups).not.toContain("edge@delta");
    expect(groups).toContain("edge@before");
    expect(groups).toContain("edge@after");
    // `core` and `governance` each hold a changed entity.
    expect(groups).toContain("core@delta");
    expect(groups).toContain("governance@delta");
  });

  it("draws nothing at all when nothing changed, rather than an empty middle panel", () => {
    const m = richModel();
    const unchanged = model({ ...m, changes: [] });
    const result = renderGrammar({ spec: specFor("delta", unchanged), model: unchanged });
    expect(result.boxes.filter((b) => b.instance === "delta")).toEqual([]);
    // The two outer panels are still a faithful drawing of a state that did
    // not move, so both remain complete.
    for (const panel of ["before", "after"]) {
      expect(result.boxes.filter((b) => b.instance === panel)).toHaveLength(m.nodes.length);
    }
  });

  it("lays the three panels out identically however the input was ordered", () => {
    const m = richModel();
    const digests = [0, 1, 2, 3, 4].map((seed) => {
      const shuffled = shuffleModel(m, seed);
      const result = renderGrammar({ spec: specFor("delta", shuffled), model: shuffled });
      return JSON.stringify(result.boxes);
    });
    expect(new Set(digests).size).toBe(1);
  });
});

describe("a truncated box still carries its whole name", () => {
  const longLabel =
    "PaymentSettlementReconciliationOrchestrator for cross-border card transactions, EU region";

  it("shortens the drawn text but keeps the full label in <title>", () => {
    const m = model({ nodes: [node("a", { label: longLabel })] });
    const svg = renderGrammar({ spec: specFor("architecture", m), model: m }).svg;

    // The whole label, inside the composed accessible name -- §28 puts the
    // entity kind in front of it, so this asserts containment rather than
    // equality. What must not happen is the label being abbreviated here.
    expect(svg).toContain(`<title>Component ${longLabel}</title>`);
    // The visible text is shorter than the label it stands for -- otherwise
    // this test would be asserting nothing.
    const drawn = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m2) => m2[1]);
    expect(drawn.some((t) => t.includes("…"))).toBe(true);
    expect(drawn.join(" ")).not.toContain(longLabel);
  });

  it("truncates rather than widening the box past the maximum", () => {
    const sized = sizeNode(node("a", { label: longLabel }), NEUTRAL_STYLE, true);
    expect(sized.width).toBeLessThanOrEqual(MAX_NODE_WIDTH);
  });

  it("never reports truncation as a fidelity reduction", () => {
    // Shortening a *label* loses no entity: the node is drawn, the receipt
    // is unaffected, and the full string is one hover away. Conflating the
    // two would make receipts noisy enough to stop being read.
    const m = model({ nodes: [node("a", { label: longLabel }), node("b")], edges: [edge("a", "b")] });
    const result = renderGrammar({ spec: specFor("architecture", m), model: m });
    expect(result.boxes.map((b) => b.node_id).sort()).toEqual(["a", "b"]);
  });
});

describe("text measurement is a pure function of the string", () => {
  it("returns the same width for the same input, every time", () => {
    const samples = [longString(), "a", "", "WWWWWW", "iiiiii", "ürlaub — naïve", "日本語テキスト"];
    for (const s of samples) {
      const runs = new Set(Array.from({ length: 5 }, () => measureText(s, 14)));
      expect(runs.size, JSON.stringify(s)).toBe(1);
    }
  });

  it("scales linearly with font size, so a layout cannot depend on a rounding accident", () => {
    const s = "architecture overview";
    expect(measureText(s, 28)).toBeCloseTo(measureText(s, 14) * 2, 6);
  });

  it("distinguishes narrow from wide characters", () => {
    expect(measureText("iiiiiiiiii", 14)).toBeLessThan(measureText("WWWWWWWWWW", 14));
  });

  it("truncates and wraps deterministically", () => {
    const s = longString();
    expect(new Set(Array.from({ length: 5 }, () => truncateToWidth(s, 120, 14))).size).toBe(1);
    expect(
      new Set(Array.from({ length: 5 }, () => JSON.stringify(wrapToLines(s, 120, 14, 2)))).size,
    ).toBe(1);
    expect(wrapToLines(s, 120, 14, 2).length).toBeLessThanOrEqual(2);
  });

  function longString() {
    return "PaymentSettlementReconciliationOrchestrator for cross-border card transactions";
  }
});

describe("two diagrams can share one document", () => {
  it("gives every generated id a spec-derived prefix, so nothing collides", () => {
    const a = render("architecture");
    const b = render("dependency_graph");
    const idsOf = (svg: string) => new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m2) => m2[1]));
    const idsA = idsOf(a.svg);
    const idsB = idsOf(b.svg);
    expect(idsA.size).toBeGreaterThan(5);
    for (const id of idsA) expect(idsB.has(id), `id "${id}" appears in both diagrams`).toBe(false);
  });

  it("points every marker reference at a marker the same document defines", () => {
    const svg = render("architecture").svg;
    const defined = new Set([...svg.matchAll(/<marker id="([^"]+)"/g)].map((m2) => m2[1]));
    const referenced = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m2) => m2[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const ref of referenced) expect(defined.has(ref), `dangling marker ${ref}`).toBe(true);
  });
});

describe("each grammar draws its own claim, not a generic box-and-line", () => {
  it("obeys the spec's grammar rather than re-deriving one from the intent", () => {
    // All of these specs carry semantic_intent "architecture". If the
    // renderer inferred the grammar it would draw the same picture eight
    // times, and grammar selection upstream would be decoration.
    const m = richModel();
    const shapes = new Set(
      (["architecture", "swimlane", "sequence", "matrix", "fishbone", "timeline"] as const).map(
        (g) => JSON.stringify(render(g, m).boxes.map((b) => [b.node_id, b.rect.x, b.rect.y])),
      ),
    );
    expect(shapes.size).toBe(6);
  });

  it("puts same-order nodes in the same swimlane column, so concurrency reads as concurrency", () => {
    const m = model({
      nodes: [
        node("a", { order: 0 }),
        node("b", { order: 0 }),
        node("c", { order: 1 }),
      ],
      edges: [edge("a", "c")],
      lanes: [
        { id: "l1", label: "Service", order: 0, member_ids: ["a", "c"] },
        { id: "l2", label: "Worker", order: 1, member_ids: ["b"] },
      ],
    });
    const boxes = new Map(renderGrammar({ spec: specFor("swimlane", m), model: m }).boxes.map((b) => [b.node_id, b.rect]));
    expect(boxes.get("b")!.x).toBeCloseTo(boxes.get("a")!.x, 6);
    expect(boxes.get("b")!.y).not.toBeCloseTo(boxes.get("a")!.y, 6);
    expect(boxes.get("c")!.x).toBeGreaterThan(boxes.get("a")!.x);
  });

  it("draws a matrix as cells with no connectors, because a matrix asserts membership rather than flow", () => {
    const svg = render("matrix").svg;
    expect(svg).toContain('data-rvs-layer="nodes"');
    expect(svg).not.toMatch(/data-rvs-edge=/);
  });

  it("puts the focal node at the head of a fishbone, since that is the effect being explained", () => {
    const m = richModel();
    const boxes = renderGrammar({ spec: specFor("fishbone", m), model: m }).boxes;
    const effect = boxes.find((b) => b.node_id === "api")!; // richModel's focal node
    for (const other of boxes.filter((b) => b.node_id !== "api")) {
      expect(other.rect.x, `${other.node_id} sits right of the effect`).toBeLessThanOrEqual(effect.rect.x);
    }
  });

  it("keeps stage order in a timeline, whatever order the stages arrived in", () => {
    const m = model({
      nodes: [node("x"), node("y")],
      stages: [
        { id: "s2", label: "Then", order: 1, member_ids: ["x"] },
        { id: "s1", label: "First", order: 0, member_ids: ["y"] },
      ],
    });
    const boxes = new Map(renderGrammar({ spec: specFor("timeline", m), model: m }).boxes.map((b) => [b.node_id, b.rect]));
    expect(boxes.get("y")!.x).toBeLessThan(boxes.get("x")!.x);
  });
});

describe("a stand-in is drawn as a stand-in", () => {
  const standIn = () =>
    model({
      nodes: [
        node("api", { kind: "runtime_entrypoint" }),
        node("cluster-core", {
          kind: "cluster",
          emphasis: "supporting",
          label: "Core (12 in a detail view)",
          placeholder_for: {
            collapsed_group_id: "cg-core",
            split_view_id: "sv-core",
            entity_count: 12,
            source_entity_ids: ["a", "b"],
          },
        }),
      ],
      edges: [edge("api", "cluster-core")],
    });

  it("marks it, counts it, and names where its entities went", () => {
    const svg = renderGrammar({ spec: specFor("architecture", standIn()), model: standIn() }).svg;
    expect(svg).toContain('data-rvs-placeholder="1"');
    expect(svg).toContain('data-rvs-placeholder-count="12"');
    expect(svg).toContain('data-rvs-collapsed-group="cg-core"');
    expect(svg).toContain('data-rvs-split-view="sv-core"');
    // An ordinary node carries none of it, so the attribute means what it says.
    expect(svg.match(/data-rvs-placeholder="1"/g)!.length).toBe(1);
  });

  it("draws it open, and describes it as standing in rather than as a component", () => {
    const svg = renderGrammar({ spec: specFor("architecture", standIn()), model: standIn() }).svg;
    // Resolution is "resolved", so a solid border is what an ordinary node
    // would get here: the dash is the placeholder's own treatment.
    expect(svg).toContain('stroke-dasharray="5 3"');
    expect(svg).toContain("stands in for 12 entities shown elsewhere");
    expect(svg).toContain(">12 entities<");
  });
});
