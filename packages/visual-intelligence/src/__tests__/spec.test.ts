import { describe, expect, it } from "vitest";
import { VISUAL_INTELLIGENCE_SCHEMA_VERSION } from "../contracts.js";
import { budgetFor } from "../budgets.js";
import { buildVisualCommunicationSpec, defaultMotionIntent } from "../spec.js";
import { digestOf } from "../ids.js";
import { validateVisualCommunicationSpec } from "../validation.js";
import { DETAIL_MODES, SEMANTIC_INTENTS, VISUAL_AUDIENCES, VISUAL_FORMATS } from "../vocabulary.js";
import { chain, edge, model, node, shuffleModel } from "./fixtures.js";
import type { VisualGraphModel } from "../data-model.js";

const build = (over: Partial<Parameters<typeof buildVisualCommunicationSpec>[0]> = {}) =>
  buildVisualCommunicationSpec({
    producer: "test",
    subject: "spec",
    semantic_intent: "dependency",
    model: chain(30),
    audience: "engineering",
    detail_mode: "balanced",
    format: "slide",
    ...over,
  });

describe("spec construction", () => {
  it("stamps the schema version and no wall-clock time", () => {
    const { spec } = build();
    expect(spec.schema_version).toBe(VISUAL_INTELLIGENCE_SCHEMA_VERSION);
    // A timestamp would make two builds over identical evidence differ,
    // which is exactly what the determinism gate forbids.
    expect(JSON.stringify(spec)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("carries the budget its own grammar and detail mode authorise", () => {
    for (const detail_mode of DETAIL_MODES) {
      const { spec } = build({ detail_mode });
      const budget = budgetFor(spec.visual_grammar, detail_mode);
      expect(spec.max_nodes).toBe(budget.max_nodes);
      expect(spec.max_edges).toBe(budget.max_edges);
      expect(spec.max_depth).toBe(budget.max_depth);
    }
  });

  it("always attaches a receipt, including when nothing was reduced", () => {
    // "No receipt" must never be ambiguous between "nothing was lost" and
    // "nobody checked".
    const { spec } = build({ model: chain(3) });
    expect(spec.fidelity_receipt).toBeDefined();
    expect(spec.fidelity_receipt!.reason_codes).toEqual(["FIDELITY_NO_REDUCTION"]);
  });

  it("validates clean for every intent, audience, detail mode, and format", () => {
    for (const semantic_intent of SEMANTIC_INTENTS) {
      for (const detail_mode of DETAIL_MODES) {
        for (const format of VISUAL_FORMATS) {
          const { spec } = build({ semantic_intent, detail_mode, format });
          expect(validateVisualCommunicationSpec(spec)).toEqual([]);
        }
      }
    }
    for (const audience of VISUAL_AUDIENCES) {
      expect(validateVisualCommunicationSpec(build({ audience }).spec)).toEqual([]);
    }
  });

  it("contains no geometry, colour, or markup", () => {
    // The layering rule, checked on the artifact rather than asserted in a
    // doc: geometry belongs to layout engines, colour and markup to
    // renderers. A spec that carried them would make this a fourth owner of
    // things it does not own.
    const serialised = JSON.stringify(build().spec);
    for (const forbidden of ["<svg", "<div", "#", "rgb(", '"x":', '"y":', "px", "font-family"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("motion defaults", () => {
  it("is static by default in every format that cannot animate", () => {
    for (const intent of SEMANTIC_INTENTS) {
      for (const format of ["slide", "document", "export"] as const) {
        expect(defaultMotionIntent(intent, format)).toBe("none");
      }
    }
  });

  it("never selects motion from the audience", () => {
    const motions = VISUAL_AUDIENCES.map((audience) => build({ audience, format: "interactive" }).spec.motion_intent);
    expect(new Set(motions).size).toBe(1);
  });

  it("keeps a caller's explicit motion intent verbatim, so an invalid one is caught rather than silently corrected", () => {
    const { spec } = build({ format: "document", motion_intent: "trace" });
    expect(spec.motion_intent).toBe("trace");
    expect(validateVisualCommunicationSpec(spec).map((f) => f.code)).toContain("VISUAL_MOTION_INTENT_INVALID");
  });
});

// Milestone 10.63: the same evidence must produce the same spec, receipt,
// grammar, and entity set across repeated runs and across shuffled inputs.
describe("determinism", () => {
  it("produces an identical spec across five runs", () => {
    const runs = Array.from({ length: 5 }, () => digestOf(build().spec));
    expect(new Set(runs).size).toBe(1);
  });

  it("produces an identical spec from shuffled input arrays", () => {
    const m = chain(30);
    const canonical = digestOf(build({ model: m }).spec);
    for (let seed = 1; seed <= 8; seed++) {
      expect(digestOf(build({ model: shuffleModel(m, seed) }).spec)).toBe(canonical);
    }
  });

  it("keeps the spec id, receipt id, grammar, and entity set stable together", () => {
    const m = chain(30);
    const first = build({ model: m }).spec;
    const second = build({ model: shuffleModel(m, 3) }).spec;
    expect(second.id).toBe(first.id);
    expect(second.fidelity_receipt!.id).toBe(first.fidelity_receipt!.id);
    expect(second.visual_grammar).toBe(first.visual_grammar);
    expect(second.fidelity_receipt!.preserved_entity_ids).toEqual(first.fidelity_receipt!.preserved_entity_ids);
  });

  it("changes the spec id when the evidence changes", () => {
    // The counterweight: a digest that never moves would make every
    // determinism test above pass for the wrong reason.
    expect(build({ model: chain(30) }).spec.id).not.toBe(build({ model: chain(31) }).spec.id);
  });
});

// Milestone 10.64: a fixture large enough that the adaptation path, not the
// happy path, is what gets exercised.
describe("at scale", () => {
  function largeModel(): VisualGraphModel {
    const nodes = [];
    const edges = [];
    const groups = [];
    for (let d = 0; d < 20; d++) {
      const domain = `domain${String(d).padStart(2, "0")}`;
      const members: string[] = [];
      for (let i = 0; i < 100; i++) {
        const id = `${domain}-n${String(i).padStart(3, "0")}`;
        nodes.push(
          node(id, {
            group_id: domain,
            kind: i % 17 === 0 ? "package" : "component",
            resolution: i % 97 === 0 ? "unresolved" : "resolved",
          }),
        );
        members.push(id);
        if (i > 0) edges.push(edge(`${domain}-n${String(i - 1).padStart(3, "0")}`, id));
      }
      // A cross-domain edge, so the graph is not twenty disjoint chains.
      if (d > 0) edges.push(edge(`domain${String(d - 1).padStart(2, "0")}-n099`, `${domain}-n000`));
      groups.push({ id: domain, label: domain, kind: "domain", member_ids: members, synthetic: false });
    }
    return model({ nodes, edges, groups, containment_depth: 1 });
  }

  it("adapts a 2,000-node graph deterministically and accounts for every entity", () => {
    const m = largeModel();
    expect(m.nodes.length).toBe(2000);
    const first = build({ model: m, detail_mode: "simplified" });
    const second = build({ model: shuffleModel(m, 11), detail_mode: "simplified" });
    expect(digestOf(second.spec)).toBe(digestOf(first.spec));

    const receipt = first.spec.fidelity_receipt!;
    const disclosed = new Set([
      ...receipt.preserved_entity_ids,
      ...receipt.collapsed_groups.flatMap((g) => g.source_entity_ids),
      ...receipt.hidden_entity_ids,
    ]);
    expect(disclosed.size).toBe(2000);
    expect(receipt.rendered_node_count).toBeLessThanOrEqual(first.spec.max_nodes);
    expect(validateVisualCommunicationSpec(first.spec)).toEqual([]);
  });

  it("keeps every unresolved entity visible even at 2,000 nodes", () => {
    const m = largeModel();
    const unresolved = m.nodes.filter((n) => n.resolution !== "resolved").map((n) => n.source_entity_id);
    expect(unresolved.length).toBeGreaterThan(0);
    const receipt = build({ model: m, detail_mode: "simplified" }).spec.fidelity_receipt!;
    for (const id of unresolved) expect(receipt.hidden_entity_ids).not.toContain(id);
  });
});
