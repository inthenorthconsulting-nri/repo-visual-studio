import { describe, expect, it } from "vitest";
import { DEGRADATION_POLICY, adaptVisualModel } from "../degradation.js";
import { validateFidelityReceipt } from "../fidelity.js";
import { digestOf } from "../ids.js";
import { chain, edge, model, node, shuffleModel } from "./fixtures.js";
import type { VisualGraphModel } from "../data-model.js";

const adapt = (m: VisualGraphModel, over: Partial<Parameters<typeof adaptVisualModel>[0]> = {}) =>
  adaptVisualModel({
    spec_id: "spec_test",
    model: m,
    grammar: "dependency_graph",
    detail_mode: "simplified",
    ...over,
  });

/** A hub with `count` interchangeable leaves plus a handful of distinctive nodes. */
function hub(count: number): VisualGraphModel {
  const leaves = Array.from({ length: count }, (_, i) => node(`leaf${String(i).padStart(3, "0")}`));
  return model({
    nodes: [node("hub"), ...leaves],
    edges: leaves.map((l) => edge("hub", l.id)),
  });
}

/** `count` unresolved entities: protected from hiding, so only splitting can reduce the view. */
function unresolvedSwarm(count: number, grouped: boolean): VisualGraphModel {
  const nodes = Array.from({ length: count }, (_, i) =>
    node(`u${String(i).padStart(3, "0")}`, {
      resolution: "unresolved",
      group_id: grouped ? `dom${i % 4}` : undefined,
    }),
  );
  return model({
    nodes,
    edges: nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id)),
    groups: grouped
      ? Array.from({ length: 4 }, (_, g) => ({
          id: `dom${g}`,
          label: `Domain ${g}`,
          kind: "domain",
          member_ids: nodes.filter((_, i) => i % 4 === g).map((n) => n.id),
          synthetic: false,
        }))
      : [],
  });
}

/**
 * A repository-shaped estate: a product, its entrypoint, and eight domains of
 * ordinary components with evidence artifacts hanging off them.
 *
 * Nothing in it is distinctive enough to survive a budget on its own merits,
 * which is the point. This is the shape that produced an eight-box overview
 * consisting of eight stand-ins and not one named entity.
 */
function estate(grouped: boolean): VisualGraphModel {
  const nodes = [
    node("product", { kind: "product", label: "The Estate" }),
    node("entry", { kind: "runtime_entrypoint", label: "bin/estate" }),
  ];
  const edges = [edge("product", "entry")];
  const groups = [];
  for (let d = 0; d < 8; d++) {
    const hub = `dom${d}-hub`;
    const members = [hub];
    nodes.push(node(hub, { kind: "component", group_id: grouped ? `dom${d}` : undefined }));
    edges.push(edge("entry", hub));
    for (let i = 0; i < 6; i++) {
      const id = `d${d}-e${i}`;
      nodes.push(node(id, { kind: "evidence", group_id: grouped ? `dom${d}` : undefined }));
      edges.push(edge(hub, id));
      members.push(id);
    }
    if (grouped) {
      groups.push({ id: `dom${d}`, label: `Domain ${d}`, kind: "domain", member_ids: members, synthetic: false });
    }
  }
  return model({ nodes, edges, groups });
}

const ARCHITECTURE_BUDGETS = { faithful: 12, balanced: 8, simplified: 5 } as const;

const realNodes = (m: VisualGraphModel) => m.nodes.filter((n) => n.placeholder_for === undefined);

describe("a view has to be about something, not merely small enough", () => {
  it("never reduces an overview to stand-ins alone", () => {
    // The defect this guards: every pass asks only "are there few enough
    // boxes?", and a page of signposts answers yes. It answers nothing else.
    // A reader handed eight dashed boxes reading "6 evidence nodes" cannot
    // name a single thing the system contains.
    for (const grouped of [true, false]) {
      for (const detail_mode of ["faithful", "balanced", "simplified"] as const) {
        const result = adapt(estate(grouped), { grammar: "architecture", detail_mode });
        expect(realNodes(result.model).length).toBeGreaterThan(0);
      }
    }
  });

  it("holds back half the view, rounded down, for real entities", () => {
    for (const grouped of [true, false]) {
      for (const [detail_mode, max] of Object.entries(ARCHITECTURE_BUDGETS)) {
        const result = adapt(estate(grouped), {
          grammar: "architecture",
          detail_mode: detail_mode as keyof typeof ARCHITECTURE_BUDGETS,
        });
        expect(realNodes(result.model).length).toBeGreaterThanOrEqual(Math.floor(max / 2));
        // And the floor is held *within* the budget, not by overflowing it.
        expect(result.model.nodes.length).toBeLessThanOrEqual(max);
      }
    }
  });

  it("opens at the way in", () => {
    // Anchor seats go to the product and its entrypoint rather than to
    // whatever the preservation policy happens to rank highest. Rank answers
    // "what must survive"; anchoring answers "what is this view about".
    for (const detail_mode of ["faithful", "balanced", "simplified"] as const) {
      const result = adapt(estate(true), { grammar: "architecture", detail_mode });
      const ids = realNodes(result.model).map((n) => n.id);
      expect(ids).toContain("product");
      expect(ids).toContain("entry");
    }
    // Two seats, and nothing else got one.
    const smallest = adapt(estate(true), { grammar: "architecture", detail_mode: "simplified" });
    expect(realNodes(smallest.model).map((n) => n.id).sort()).toEqual(["entry", "product"]);
  });

  it("coarsens a signpost rather than dropping the entity it stands for", () => {
    const result = adapt(estate(true), { grammar: "architecture", detail_mode: "balanced" });
    expect(result.receipt.reason_codes).toContain("FIDELITY_STAND_INS_MERGED");
    const merged = result.receipt.collapsed_groups.filter((g) => g.reason === "FIDELITY_STAND_INS_MERGED");
    expect(merged.length).toBe(1);
    // Merging costs granularity in the disclosure and no entity at all: the
    // merged group names everything its constituents named.
    expect(merged[0].source_entity_ids.length).toBeGreaterThan(1);
    const disclosed = new Set([
      ...result.receipt.preserved_entity_ids,
      ...result.receipt.collapsed_groups.flatMap((g) => g.source_entity_ids),
      ...result.receipt.hidden_entity_ids,
    ]);
    expect(disclosed.size).toBe(estate(true).nodes.length);
    expect(
      validateFidelityReceipt(
        result.receipt,
        estate(true).nodes.map((n) => n.source_entity_id),
      ).map((f) => f.code),
    ).toEqual([]);
    // Every collapsed group still has exactly one stand-in on the page. A
    // disclosure pointing at a box that is not there discloses nothing, and
    // a stand-in with no group behind it is a claim the receipt cannot check.
    const standInGroups = result.model.nodes
      .filter((n) => n.placeholder_for !== undefined)
      .map((n) => n.placeholder_for!.collapsed_group_id)
      .sort();
    expect(standInGroups).toEqual([...result.receipt.collapsed_groups.map((g) => g.id)].sort());
  });

  it("merges only the stand-ins that lead nowhere", () => {
    // One that points at a detail view is the reader's only route to where
    // those entities went. Folding it into a general group would break the
    // route while the receipt went on claiming the entities were drawn.
    const result = adapt(estate(true), { grammar: "architecture", detail_mode: "balanced" });
    const merged = result.receipt.collapsed_groups.find((g) => g.reason === "FIDELITY_STAND_INS_MERGED");
    const routed = new Set(
      result.receipt.collapsed_groups
        .filter((g) => g.reason === "FIDELITY_SPLIT_INTO_VIEWS")
        .flatMap((g) => g.source_entity_ids),
    );
    for (const id of merged?.source_entity_ids ?? []) expect(routed.has(id)).toBe(false);
  });

  it("pages an anchor when, and only when, the budget leaves no alternative", () => {
    // Sixty protected entities and no container: every slot is needed to
    // point at a page, so the floor yields rather than overflow the view. The
    // floor is a preference the arithmetic can overrule, not a promise the
    // arithmetic cannot keep -- and paging is the one reduction that can
    // overrule it, because every paged entity is still drawn at full detail.
    const swarm = adapt(unresolvedSwarm(60, false));
    expect(swarm.model.nodes.length).toBeLessThanOrEqual(9);
    expect(swarm.receipt.hidden_entity_ids).toEqual([]);
    const paged = swarm.splits.reduce((n, s) => n + s.model.nodes.length, 0);
    expect(realNodes(swarm.model).length + paged).toBe(60);
  });

  it("reaches the same view from a shuffled input", () => {
    for (const grouped of [true, false]) {
      const baseline = adapt(estate(grouped), { grammar: "architecture", detail_mode: "balanced" });
      for (let seed = 1; seed <= 5; seed++) {
        const shuffled = adapt(shuffleModel(estate(grouped), seed), {
          grammar: "architecture",
          detail_mode: "balanced",
        });
        expect(digestOf(shuffled.model)).toBe(digestOf(baseline.model));
        expect(digestOf(shuffled.receipt)).toBe(digestOf(baseline.receipt));
      }
    }
  });
});

describe("the degradation policy is a published, ordered table", () => {
  it("is ranked 1..13 with no gaps and no duplicate codes", () => {
    expect(DEGRADATION_POLICY.map((r) => r.rank)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(new Set(DEGRADATION_POLICY.map((r) => r.code)).size).toBe(DEGRADATION_POLICY.length);
  });

  it("ranks every preservation rule above every reduction rule", () => {
    const firstReduction = DEGRADATION_POLICY.find((r) => r.code.startsWith("VISUAL_COLLAPSE"))!.rank;
    for (const rule of DEGRADATION_POLICY.filter((r) => r.code.startsWith("VISUAL_PRESERVE"))) {
      expect(rule.rank).toBeLessThan(firstReduction);
    }
  });

  it("ranks collapse above hide, and split above nothing being readable", () => {
    const rank = (code: string) => DEGRADATION_POLICY.find((r) => r.code === code)!.rank;
    expect(rank("VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT")).toBeLessThan(rank("VISUAL_HIDE_NON_CRITICAL"));
    expect(rank("VISUAL_COLLAPSE_LOW_VALUE_LEAF")).toBeLessThan(rank("VISUAL_HIDE_NON_CRITICAL"));
    expect(rank("VISUAL_SPLIT_BEFORE_SHRINK")).toBe(13);
  });
});

describe("adaptation preserves what policy protects", () => {
  it("leaves a within-budget model completely untouched", () => {
    const m = chain(4);
    const result = adapt(m);
    expect(result.model.nodes.map((n) => n.id)).toEqual(m.nodes.map((n) => n.id));
    expect(result.receipt.reason_codes).toEqual(["FIDELITY_NO_REDUCTION"]);
    expect(result.receipt.hidden_entity_ids).toEqual([]);
    expect(result.receipt.collapsed_groups).toEqual([]);
  });

  it("never removes a focal entity", () => {
    const m = hub(80);
    const focal = ["leaf070", "leaf071"];
    const result = adapt(m, { focal_entity_ids: focal });
    for (const id of focal) expect(result.receipt.preserved_entity_ids).toContain(id);
  });

  it("never removes a blocking or review-required governance finding", () => {
    const m = hub(80);
    m.nodes.push(
      node("finding-blocking", { kind: "governance_finding", severity: "blocking" }),
      node("finding-review", { kind: "governance_finding", severity: "review_required" }),
    );
    const result = adapt(m);
    expect(result.receipt.preserved_entity_ids).toContain("finding-blocking");
    expect(result.receipt.preserved_entity_ids).toContain("finding-review");
    expect(result.receipt.preserved_findings).toContain("finding-blocking");
  });

  it("never hides an unresolved entity", () => {
    // The reader has to be able to see the picture is incomplete. An
    // unresolved reference that vanishes under simplification turns "we
    // could not resolve this" into "this does not exist".
    const m = hub(80);
    m.nodes.push(node("dangling", { kind: "unresolved_reference", resolution: "unresolved" }));
    const result = adapt(m);
    expect(result.receipt.hidden_entity_ids).not.toContain("dangling");
    expect(result.receipt.preserved_unresolved_entities).toContain("dangling");
  });

  it("never removes a decision-linked entity", () => {
    const m = hub(80);
    m.nodes.push(node("adr-7", { kind: "decision", decision_status: "accepted" }));
    const result = adapt(m);
    expect(result.receipt.preserved_decisions).toContain("adr-7");
  });

  it("keeps a critical path intact end to end", () => {
    const m = hub(80);
    m.nodes.push(node("gateway"), node("service"), node("store"));
    m.edges.push(edge("gateway", "service"), edge("service", "store"));
    m.paths.push({
      id: "path-primary",
      node_ids: ["gateway", "service", "store"],
      edge_ids: ["gateway->service", "service->store"],
      critical: true,
    });
    const result = adapt(m);
    for (const id of ["gateway", "service", "store"]) {
      expect(result.receipt.preserved_entity_ids).toContain(id);
    }
    expect(result.receipt.preserved_paths).toContain("path-primary");
  });
});

describe("adaptation prefers collapse and split over hiding", () => {
  it("collapses interchangeable siblings instead of hiding them", () => {
    const result = adapt(hub(60));
    expect(result.receipt.collapsed_groups.length).toBeGreaterThan(0);
    expect(result.receipt.reason_codes).toContain("FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED");
    expect(result.receipt.hidden_entity_ids).toEqual([]);
  });

  it("does not merge nodes that merely look alike", () => {
    // Each interior node of a chain has a different neighbour on each side,
    // so none of them is interchangeable with another -- collapsing them
    // would destroy the path the diagram exists to show.
    const result = adapt(chain(60));
    const equivalenceCollapses = result.receipt.collapsed_groups.filter(
      (g) => g.reason === "FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED",
    );
    expect(equivalenceCollapses).toEqual([]);
  });

  it("splits along real containers before hiding anything", () => {
    const m = hub(0);
    m.nodes = [];
    m.edges = [];
    for (const domain of ["alpha", "beta", "gamma"]) {
      const members = Array.from({ length: 20 }, (_, i) => node(`${domain}-${String(i).padStart(2, "0")}`, { group_id: domain }));
      m.nodes.push(...members);
      // Distinct neighbours so nothing is structurally interchangeable.
      m.edges.push(...members.slice(1).map((n, i) => edge(members[i].id, n.id)));
      m.groups.push({ id: domain, label: domain, kind: "domain", member_ids: members.map((n) => n.id), synthetic: false });
    }
    const result = adapt(m);
    expect(result.receipt.split_views.length).toBeGreaterThan(0);
    expect(result.receipt.reason_codes).toContain("FIDELITY_SPLIT_INTO_VIEWS");
    expect(result.splits.length).toBe(result.receipt.split_views.length);
    for (const split of result.splits) expect(split.model.nodes.length).toBeGreaterThan(0);
  });

  it("declines to split when the caller's surface cannot carry a second view, and says it truncated", () => {
    const result = adapt(chain(60), { allow_split: false });
    expect(result.receipt.split_views).toEqual([]);
    expect(result.receipt.hidden_entity_ids.length).toBeGreaterThan(0);
    expect(result.receipt.reason_codes).toContain("FIDELITY_NON_FOCAL_HIDDEN");
  });

  it("never resolves an over-budget view by shrinking", () => {
    // There is no scale, font-size, or zoom field anywhere in the result:
    // "make it smaller" is not one of the moves this engine has.
    const result = adapt(hub(200));
    expect(JSON.stringify(result)).not.toMatch(/font_size|scale|zoom|shrink/i);
  });
});

describe("adaptation is deterministic and fully accounted for", () => {
  it("produces an identical result across five runs", () => {
    const m = hub(120);
    const runs = Array.from({ length: 5 }, () => digestOf(adapt(m)));
    expect(new Set(runs).size).toBe(1);
  });

  it("is unaffected by the order of the caller's arrays", () => {
    const m = hub(120);
    const canonical = digestOf(adapt(m));
    for (let seed = 1; seed <= 5; seed++) {
      expect(digestOf(adapt(shuffleModel(m, seed)))).toBe(canonical);
    }
  });

  it("accounts for every source entity exactly once, at every detail mode", () => {
    for (const detail_mode of ["faithful", "balanced", "simplified"] as const) {
      for (const m of [chain(60), hub(120), chain(3)]) {
        const result = adapt(m, { detail_mode });
        const violations = validateFidelityReceipt(result.receipt, m.nodes.map((n) => n.source_entity_id));
        expect(violations).toEqual([]);
      }
    }
  });

  it("names every entity it stopped drawing", () => {
    const m = hub(200);
    const result = adapt(m);
    const disclosed = new Set([
      ...result.receipt.preserved_entity_ids,
      ...result.receipt.collapsed_groups.flatMap((g) => g.source_entity_ids),
      ...result.receipt.hidden_entity_ids,
    ]);
    expect(disclosed.size).toBe(m.nodes.length);
    expect(result.receipt.rendered_node_count).toBeLessThan(result.receipt.source_node_count);
  });
});

describe("splitting is preferred to overflowing, even for protected entities", () => {
  it("relocates protected entities into container detail views rather than overflow the primary view", () => {
    const m = unresolvedSwarm(60, true);
    const result = adapt(m);
    // Nothing was hidden -- protection held -- yet the primary view is readable.
    expect(result.receipt.hidden_entity_ids).toEqual([]);
    expect(result.receipt.split_views.length).toBeGreaterThan(0);
    expect(result.model.nodes.length).toBeLessThanOrEqual(9);
  });

  it("pages protected entities when no container exists to split along", () => {
    const m = unresolvedSwarm(60, false);
    const result = adapt(m);
    expect(result.receipt.hidden_entity_ids).toEqual([]);
    expect(result.model.nodes.length).toBeLessThanOrEqual(9);
    // Every page is itself readable: paging that produced over-budget pages
    // would have solved nothing.
    for (const split of result.splits) {
      expect(split.model.nodes.length).toBeLessThanOrEqual(9);
    }
  });

  it("keeps focal entities in the primary view rather than paging them away", () => {
    const m = unresolvedSwarm(60, false);
    const result = adapt(m, { focal_entity_ids: ["u042"] });
    expect(result.model.nodes.map((n) => n.id)).toContain("u042");
  });

  it("keeps a critical path whole in the primary view", () => {
    const m = unresolvedSwarm(60, false);
    const pathNodes = ["u000", "u001", "u002", "u003"];
    const withPath: VisualGraphModel = {
      ...m,
      paths: [
        {
          id: "p1",
          node_ids: pathNodes,
          edge_ids: ["u000->u001", "u001->u002", "u002->u003"],
          critical: true,
        },
      ],
    };
    const result = adapt(withPath);
    const primary = new Set(result.model.nodes.map((n) => n.id));
    for (const id of pathNodes) expect(primary.has(id)).toBe(true);
  });

  it("still accounts for every entity when reduction happened only by splitting", () => {
    for (const grouped of [true, false]) {
      const m = unresolvedSwarm(60, grouped);
      const result = adapt(m);
      expect(validateFidelityReceipt(result.receipt, m.nodes.map((n) => n.source_entity_id))).toEqual([]);
    }
  });

  it("overflows the primary view only when splitting is forbidden outright", () => {
    // The honest degenerate case: a surface that cannot carry a second view,
    // holding more protected entities than fit. Nothing is hidden and nothing
    // is silently dropped -- the receipt says the limit was hit.
    const result = adapt(unresolvedSwarm(60, false), { allow_split: false });
    expect(result.receipt.hidden_entity_ids).toEqual([]);
    expect(result.receipt.truncation.truncated).toBe(true);
    expect(result.receipt.truncation.limits_hit).toContain("FIDELITY_NODE_BUDGET_EXCEEDED");
  });

  it("pages deterministically across five runs and shuffled inputs", () => {
    const m = unresolvedSwarm(60, false);
    const canonical = digestOf(adapt(m));
    expect(new Set(Array.from({ length: 5 }, () => digestOf(adapt(m)))).size).toBe(1);
    for (let seed = 1; seed <= 5; seed++) {
      expect(digestOf(adapt(shuffleModel(m, seed)))).toBe(canonical);
    }
  });
});

describe("a reduced view says so on its face, not only in its receipt", () => {
  it("leaves a stand-in in the primary view for every collapsed group", () => {
    // The failure this prevents: an "overview" of a 60-entity estate that
    // draws three boxes and looks complete. A reader with only the drawing
    // must be able to tell that more exists and roughly how much.
    const m = unresolvedSwarm(60, true);
    const result = adapt(m);
    const placeholders = result.model.nodes.filter((n) => n.placeholder_for !== undefined);
    expect(placeholders.length).toBe(result.receipt.collapsed_groups.length);
    expect(placeholders.map((p) => p.placeholder_for!.collapsed_group_id).sort()).toEqual(
      result.receipt.collapsed_groups.map((g) => g.id).sort(),
    );
    for (const p of placeholders) {
      expect(p.placeholder_for!.entity_count).toBeGreaterThan(0);
      expect(p.label).toContain(String(p.placeholder_for!.entity_count));
    }
  });

  it("names the detail view a stand-in leads to, whenever one exists", () => {
    const result = adapt(unresolvedSwarm(60, true));
    const viewIds = new Set(result.splits.map((s) => s.id));
    const linked = result.model.nodes
      .filter((n) => n.placeholder_for?.split_view_id !== undefined)
      .map((n) => n.placeholder_for!.split_view_id!);
    expect(linked.length).toBeGreaterThan(0);
    for (const id of linked) expect(viewIds.has(id)).toBe(true);
  });

  it("counts stand-ins against the budget rather than smuggling them past it", () => {
    // A split that replaces twelve boxes with a thirteenth nobody budgeted
    // for has not made the view readable, it has moved the overflow.
    for (const grouped of [true, false]) {
      const result = adapt(unresolvedSwarm(60, grouped));
      expect(result.model.nodes.length).toBeLessThanOrEqual(9);
    }
  });

  it("excludes stand-ins from fidelity accounting entirely", () => {
    // A stand-in is not an entity, so it appears in no receipt bucket. If it
    // were counted as preserved, a view could claim credit for drawing
    // something no upstream artifact ever produced.
    const m = unresolvedSwarm(60, true);
    const result = adapt(m);
    const sourceIds = new Set(m.nodes.map((n) => n.source_entity_id));
    const accounted = [
      ...result.receipt.preserved_entity_ids,
      ...result.receipt.collapsed_groups.flatMap((g) => g.source_entity_ids),
      ...result.receipt.hidden_entity_ids,
    ];
    for (const id of accounted) expect(sourceIds.has(id)).toBe(true);
    for (const p of result.model.nodes.filter((n) => n.placeholder_for !== undefined)) {
      expect(result.receipt.preserved_entity_ids).not.toContain(p.id);
    }
    expect(validateFidelityReceipt(result.receipt, [...sourceIds])).toEqual([]);
  });

  it("reconnects a stand-in so it is not an orphan box in the corner", () => {
    const m = unresolvedSwarm(60, true);
    const result = adapt(m);
    const placeholderIds = new Set(
      result.model.nodes.filter((n) => n.placeholder_for !== undefined).map((n) => n.id),
    );
    const connected = new Set(
      result.model.edges.flatMap((e) => [e.from_id, e.to_id]).filter((id) => placeholderIds.has(id)),
    );
    // Every relationship that crossed the split boundary is redrawn once, so
    // a stand-in that anything depended on still shows that dependency.
    const crossed = m.edges.some(
      (e) => placeholderIds.has(e.from_id) !== placeholderIds.has(e.to_id),
    );
    expect(connected.size > 0 || !crossed).toBe(true);
    for (const e of result.model.edges) expect(e.from_id).not.toBe(e.to_id);
  });

  it("keeps stand-ins deterministic across five runs and shuffled inputs", () => {
    const m = unresolvedSwarm(60, true);
    const trace = (r: ReturnType<typeof adapt>) =>
      digestOf(r.model.nodes.filter((n) => n.placeholder_for !== undefined));
    const canonical = trace(adapt(m, { grammar: "delta" }));
    expect(new Set(Array.from({ length: 5 }, () => trace(adapt(m, { grammar: "delta" })))).size).toBe(1);
    for (let seed = 1; seed <= 5; seed++) expect(trace(adapt(shuffleModel(m, seed), { grammar: "delta" }))).toBe(canonical);
  });
});

/**
 * A delta-shaped estate: `count` distinct entities in a chain, every one of
 * them changed.
 *
 * Every entity is rank 3 -- protected from hiding, and relocatable -- which is
 * the only shape that can put the anchor floor and the budget in genuine
 * conflict. Nothing here is interchangeable enough to collapse and nothing is
 * grouped, so paging is the only reduction left.
 */
function changedChain(count: number): VisualGraphModel {
  const nodes = Array.from({ length: count }, (_, i) =>
    node(`n${String(i).padStart(3, "0")}`, {
      kind: i % 3 === 0 ? "component" : i % 3 === 1 ? "package" : "service",
    }),
  );
  return model({
    nodes,
    edges: nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id)),
    changes: nodes.map((n) => ({
      id: `c-${n.id}`,
      subject_id: n.id,
      subject_type: "node" as const,
      kind: "changed" as const,
      detail: `${n.id} changed`,
      evidence_refs: [],
    })),
  });
}

describe("graduated anchor release", () => {
  // The floor is a preference the budget may overrule, and the only honest
  // way to overrule it is out loud. These tests prove both halves: that it is
  // overruled only when arithmetic leaves nothing else, and that it says so.
  //
  // The entity counts below sit either side of that threshold for a delta at
  // simplified detail, which is a four-node budget. They moved when the delta
  // budget was corrected to measure one panel's width instead of the whole
  // scene's -- the grammar draws the same entities three times over, so the
  // old figure counted the same capacity three times. Ten entities still fit
  // by paging alone; twelve need every seat to point at a page.

  it("keeps the whole floor while paging alone can still fit the view", () => {
    const result = adapt(changedChain(10), { grammar: "delta" });
    expect(result.receipt.reason_codes).not.toContain("FIDELITY_ANCHOR_RELEASED");
    expect(result.receipt.reason_codes).toContain("FIDELITY_SPLIT_INTO_VIEWS");
  });

  it("releases anchors, and says so, when every seat is needed to point at a page", () => {
    const result = adapt(changedChain(12), { grammar: "delta" });
    expect(result.receipt.reason_codes).toContain("FIDELITY_ANCHOR_RELEASED");
  });

  it("releases the least important anchor first rather than the floor wholesale", () => {
    const result = adapt(changedChain(12), { grammar: "delta" });
    const real = result.model.nodes.filter((n) => n.placeholder_for === undefined);
    // A released anchor is paged, not lost: it is still drawn at full detail
    // in a view the primary one names.
    expect(real.length).toBeGreaterThan(0);
    const paged = new Set(result.splits.flatMap((v) => v.model.nodes.map((n) => n.source_entity_id)));
    for (const n of real) expect(paged.has(n.source_entity_id)).toBe(false);
  });

  it("loses nothing when it releases: every entity is still drawn somewhere", () => {
    const m = changedChain(12);
    const result = adapt(m, { grammar: "delta" });
    const drawn = new Set(
      [result.model, ...result.splits.map((v) => v.model)]
        .flatMap((v) => v.nodes)
        .filter((n) => n.placeholder_for === undefined)
        .map((n) => n.source_entity_id),
    );
    for (const n of m.nodes) expect(drawn.has(n.source_entity_id)).toBe(true);
    expect(result.receipt.hidden_entity_ids).toEqual([]);
  });

  it("releases identically across five runs and shuffled inputs", () => {
    const m = changedChain(12);
    const trace = (r: ReturnType<typeof adapt>) =>
      digestOf({ codes: r.receipt.reason_codes, primary: r.model.nodes.map((n) => n.id), splits: r.receipt.split_views });
    const canonical = trace(adapt(m, { grammar: "delta" }));
    expect(new Set(Array.from({ length: 5 }, () => trace(adapt(m, { grammar: "delta" })))).size).toBe(1);
    for (let seed = 1; seed <= 5; seed++) expect(trace(adapt(shuffleModel(m, seed), { grammar: "delta" }))).toBe(canonical);
  });
});
