import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DETAIL_MODES, VISUAL_AUDIENCES, digestOf, type DetailMode, type VisualAudience } from "@rvs/visual-intelligence";
import { composeVisualDocument, type ComposedDocument } from "../compose.js";
import { estateModel, flatModel, shuffleModel } from "./fixtures.js";
import type { VisualGraphModel } from "@rvs/visual-intelligence";

const compose = (audience: VisualAudience, detail: DetailMode, m: VisualGraphModel = estateModel()) =>
  composeVisualDocument({
    producer: "test",
    subject: "estate",
    semantic_intent: "architecture",
    model: m,
    audience,
    detail_mode: detail,
    format: "slide",
    focal_entity_ids: ["n000"],
  });

/**
 * The five facets §63 requires to be stable, digested separately.
 *
 * Separately, not as one blob, because a single digest over the whole
 * document tells you only that *something* moved. Five tell you whether the
 * grammar choice drifted, the receipt drifted, or only the geometry did --
 * and those are three different bugs.
 */
const facets = (doc: ComposedDocument) => ({
  spec: digestOf({ ...doc.spec, id: doc.spec.id }),
  grammar: doc.spec.visual_grammar,
  receipt: digestOf(doc.receipt),
  entities: digestOf(doc.coverage),
  geometry: digestOf([doc.primary, ...doc.details].map((v) => v.render.boxes)),
  html: createHash("sha256")
    .update([doc.primary, ...doc.details].map((v) => v.render.svg).join("\n"))
    .digest("hex"),
});

describe("a composed document is reproducible", () => {
  it("is identical across five runs, for every audience and detail mode", () => {
    for (const audience of VISUAL_AUDIENCES) {
      for (const detail of DETAIL_MODES) {
        const runs = new Set(
          Array.from({ length: 5 }, () => JSON.stringify(facets(compose(audience, detail)))),
        );
        expect(runs.size, `${audience}/${detail}`).toBe(1);
      }
    }
  });

  it("is unaffected by the order the caller happened to hold its arrays in", () => {
    // The bug this catches is not hypothetical: the same estate read from two
    // upstream artifacts, or from one artifact after an unrelated edit, can
    // arrive with its nodes in a different order. If that changed the drawing,
    // every cached artifact and every review diff would be noise.
    for (const audience of VISUAL_AUDIENCES) {
      for (const detail of DETAIL_MODES) {
        const canonical = JSON.stringify(facets(compose(audience, detail)));
        for (let seed = 1; seed <= 5; seed++) {
          const shuffled = JSON.stringify(facets(compose(audience, detail, shuffleModel(estateModel(), seed))));
          expect(shuffled, `${audience}/${detail} seed ${seed}`).toBe(canonical);
        }
      }
    }
  });

  it("emits no timestamp, hostname, or absolute local path anywhere in the document", () => {
    for (const audience of VISUAL_AUDIENCES) {
      const doc = compose(audience, "faithful");
      const text = [doc.primary, ...doc.details].map((v) => v.render.svg).join("\n") + JSON.stringify(doc.receipt);
      expect(text, audience).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
      expect(text, audience).not.toMatch(/\/(Users|home|var\/folders|private\/tmp)\//);
    }
  });
});

describe("split before shrink, at the boundary where shrinking would happen", () => {
  const sizesIn = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1]).sort();

  it("uses the same type sizes for a 4-entity model as for a 400-entity one", () => {
    // The forbidden default, stated as a test: "too dense, so make the text
    // smaller". Density is answered by relocating content, never by making
    // the reader work harder to read what is left.
    const small = new Set(sizesIn(compose("engineering", "faithful", flatModel(4)).primary.render.svg));
    const huge = new Set(sizesIn(compose("engineering", "faithful", flatModel(400)).primary.render.svg));
    expect([...huge].sort()).toEqual([...small].sort());
  });

  it("draws a detail view at exactly the type size of the overview", () => {
    // A detail view exists because content was *relocated*, not demoted. Set
    // in smaller type it would be a downgrade wearing a promotion's name.
    const doc = compose("engineering", "faithful");
    expect(doc.details.length).toBeGreaterThan(0);
    const primary = new Set(sizesIn(doc.primary.render.svg));
    for (const detail of doc.details) {
      for (const size of new Set(sizesIn(detail.render.svg))) {
        expect(primary.has(size), `${detail.id} used ${size}`).toBe(true);
      }
    }
  });

  it("keeps type size constant across detail modes, and changes quantity instead", () => {
    const byMode = DETAIL_MODES.map((d) => compose("engineering", d, flatModel(60)));
    const sizes = byMode.map((doc) => JSON.stringify([...new Set(sizesIn(doc.primary.render.svg))].sort()));
    expect(new Set(sizes).size).toBe(1);
    const counts = byMode.map((doc) => doc.coverage.primary_entity_ids.length);
    expect(counts[0]).toBeGreaterThan(counts[2]);
  });

  it("answers a 400-entity model by naming what it left out, not by cramming", () => {
    const doc = compose("engineering", "faithful", flatModel(400));
    expect(doc.receipt.reason_codes).not.toEqual(["FIDELITY_NO_REDUCTION"]);
    // Every entity is somewhere: drawn, relocated, collapsed, or named as
    // hidden. Nothing falls off the edge of the account.
    expect(doc.coverage.unaccounted_entity_ids).toEqual([]);
    expect(doc.coverage.hidden_entity_ids.length).toBeGreaterThan(0);
    for (const id of doc.coverage.hidden_entity_ids) {
      expect(doc.receipt.hidden_entity_ids).toContain(id);
    }
    // And the boxes it did draw are within the budget it was given, rather
    // than over-budget at a smaller scale.
    expect(doc.primary.render.boxes.length).toBeLessThanOrEqual(12);
  });
});
