import { describe, expect, it } from "vitest";
import { composeVisualDocument } from "../compose.js";
import { estateModel } from "./fixtures.js";

// A composed document can carry several drawings of one spec: an overview
// plus a detail view per split. They all land in the same HTML page.
//
// The renderer minted its element and marker ids from the spec id, which made
// them unique per spec and identical across every view of it. Marker
// definitions collided harmlessly -- they were the same markers -- but
// `<title>` and `<desc>` did not: `aria-labelledby` resolves to the first
// matching id in the document, so every detail view was announced with the
// overview's name and description, and its own were unreachable by any reader
// using them.
//
// The fix scopes ids to the view rather than the spec. This is the test that
// keeps them scoped.

function idsIn(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

const composeSplit = () =>
  composeVisualDocument({
    producer: "test",
    subject: "estate",
    semantic_intent: "architecture",
    model: estateModel(),
    audience: "executive",
    detail_mode: "simplified",
    format: "interactive",
    focal_entity_ids: ["n000"],
    allow_split: true,
  });

describe("element ids are unique across every view in one document", () => {
  it("mints no id twice, however many views a spec produced", () => {
    const doc = composeSplit();
    const views = [doc.primary, ...doc.details];
    expect(views.length, "this fixture no longer splits, so it proves nothing").toBeGreaterThan(1);

    const seen = new Map<string, number>();
    for (const view of views) {
      for (const id of idsIn(view.render.svg)) seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id} × ${count}`).sort();
    expect(duplicated).toEqual([]);
  });

  it("gives every view its own accessible name and description to point at", () => {
    const doc = composeSplit();
    const views = [doc.primary, ...doc.details];
    const labelled = views.map((view) => {
      const attribute = view.render.svg.match(/aria-labelledby="([^"]+)"/);
      const title = view.render.svg.match(/<title id="([^"]+)"/);
      const desc = view.render.svg.match(/<desc id="([^"]+)"/);
      return { labelledBy: attribute?.[1] ?? "", title: title?.[1] ?? "", desc: desc?.[1] ?? "" };
    });

    for (const view of labelled) {
      // The reference resolves to this view's own elements, not to another's.
      expect(view.labelledBy).toEqual(`${view.title} ${view.desc}`);
    }
    expect(new Set(labelled.map((view) => view.title)).size).toEqual(labelled.length);
    expect(new Set(labelled.map((view) => view.desc)).size).toEqual(labelled.length);
  });

  it("keeps those ids deterministic across runs", () => {
    const ids = () => {
      const doc = composeSplit();
      return [doc.primary, ...doc.details].map((view) => idsIn(view.render.svg));
    };
    expect(ids()).toEqual(ids());
  });
});
