import { describe, expect, it } from "vitest";
import {
  DETAIL_MODES,
  VISUAL_AUDIENCES,
  validateFidelityReceipt,
  type DetailMode,
  type VisualAudience,
  type VisualGraphModel,
} from "@rvs/visual-intelligence";
import { composeVisualDocument } from "../compose.js";
import { estateModel, flatModel, tinyModel } from "./fixtures.js";

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

describe("a composed document accounts for every entity it was given", () => {
  it("leaves nothing unaccounted, for every audience and detail mode", () => {
    for (const audience of VISUAL_AUDIENCES) {
      for (const detail of DETAIL_MODES) {
        const doc = compose(audience, detail);
        expect(doc.coverage.unaccounted_entity_ids, `${audience}/${detail}`).toEqual([]);
      }
    }
  });

  it("partitions the source set: an entity is in exactly one bucket", () => {
    for (const detail of DETAIL_MODES) {
      const doc = compose("engineering", detail);
      const buckets = [
        doc.coverage.primary_entity_ids,
        doc.coverage.detail_entity_ids,
        doc.coverage.collapsed_entity_ids,
        doc.coverage.hidden_entity_ids,
      ];
      const all = buckets.flat();
      expect(new Set(all).size, detail).toBe(all.length);
      expect([...all].sort(), detail).toEqual([...doc.coverage.source_entity_ids].sort());
    }
  });

  it("agrees with the receipt it publishes", () => {
    for (const detail of DETAIL_MODES) {
      const doc = compose("engineering", detail);
      expect(validateFidelityReceipt(doc.receipt, doc.coverage.source_entity_ids), detail).toEqual([]);
    }
  });

  it("refuses to describe an unreduced view as reduced, or the reverse", () => {
    const untouched = composeVisualDocument({
      producer: "test",
      subject: "tiny",
      semantic_intent: "architecture",
      model: tinyModel(),
      audience: "engineering",
      detail_mode: "faithful",
      format: "slide",
    });
    expect(untouched.receipt_required).toBe(false);
    expect(compose("engineering", "simplified", flatModel(60)).receipt_required).toBe(true);
  });
});

describe("a detail view is a destination, not a promise in a label", () => {
  it("resolves every split view named in the receipt to a rendered document", () => {
    const doc = compose("engineering", "faithful");
    const rendered = new Set(doc.details.map((d) => d.id));
    expect(doc.receipt.split_views.length).toBeGreaterThan(0);
    for (const view of doc.receipt.split_views) {
      expect(rendered.has(view.id), `${view.id} was announced but never drawn`).toBe(true);
    }
  });

  it("draws in a detail view exactly the entities that view claims", () => {
    const doc = compose("engineering", "faithful");
    for (const view of doc.receipt.split_views) {
      const drawn = doc.details.find((d) => d.id === view.id)!.render.boxes.map((b) => b.source_entity_id);
      expect([...drawn].sort(), view.id).toEqual([...view.entity_ids].sort());
    }
  });

  it("gives the overview a stand-in that leads to each detail view", () => {
    // The link the reader actually uses. Without it the detail views exist
    // but nothing on the page says so.
    const doc = compose("engineering", "faithful");
    const linked = new Set(
      doc.primary.audience.model.nodes
        .map((n) => n.placeholder_for?.split_view_id)
        .filter((id): id is string => id !== undefined),
    );
    for (const view of doc.receipt.split_views) {
      expect(linked.has(view.id), `${view.id} is unreachable from the overview`).toBe(true);
    }
  });

  it("renders detail views at the same grammar as the overview", () => {
    const doc = compose("engineering", "faithful");
    for (const detail of doc.details) {
      expect(detail.render.svg).toContain(`data-rvs-grammar="${doc.spec.visual_grammar}"`);
    }
  });
});
