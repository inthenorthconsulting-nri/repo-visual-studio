import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { EXPLORER_ALGORITHMS } from "@rvs/visual-explorer";
import { buildChangeReviewArtifact } from "../artifact.js";
import { buildReviewAssembly, type ChangeReviewSourceInput } from "../source.js";
import { REVIEW_ALGORITHMS, REVIEW_RUNTIME, REVIEW_RUNTIME_WIRING } from "../runtime.js";
import { REVIEW_LENS_IDS, applyReviewLens, changeMatchesLens, lensEntityIds } from "../lenses.js";
import { FIXTURES, blockingFinding, causalChain, componentRemoved, unknownConsumer } from "./fixtures.js";

// The parity proof.
//
// The review's semantics exist twice: once in TypeScript, which the tests
// hold to account, and once as browser text, which is what a reviewer
// actually runs. Two implementations of one behaviour drift, and the copy
// that drifts is the one nobody would notice -- so the browser copy runs here
// in an isolated VM, over the very JSON the artifact embeds, and has to agree.

const build = (input: ChangeReviewSourceInput) =>
  buildChangeReviewArtifact({
    producer: "rvs-test",
    subject: "Estate",
    assembly: buildReviewAssembly(input),
    audience: "engineering",
    detail_mode: "faithful",
  });

/** The runtime model exactly as the page hands it to the script: parsed out of the island. */
function embeddedModel(html: string): Record<string, any> {
  const open = html.indexOf('<script type="application/json" id="rvs-review">');
  const start = html.indexOf(">", open) + 1;
  const body = html.slice(start, html.indexOf("</script>", start));
  return JSON.parse(body.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
}

/**
 * The algorithms, loaded into a context with nothing else in it.
 *
 * No `document`, no `window`, no `fetch`, no `require`, no `process`. A
 * browser half that reached for a host object would not find one here, and
 * that is the point: the pure half has to stay pure, or this proves nothing
 * about the half that ships.
 */
function loadAlgorithms(): (expression: string, model: unknown, ...args: unknown[]) => unknown {
  const context = createContext(Object.create(null));
  runInContext(EXPLORER_ALGORITHMS, context, { filename: "explorer-algorithms.js" });
  runInContext(REVIEW_ALGORITHMS, context, { filename: "review-algorithms.js" });
  return (expression, model, ...args) => {
    context.__model = model;
    context.__args = args;
    return JSON.parse(JSON.stringify(runInContext(expression, context)));
  };
}

const call = loadAlgorithms();

describe("the pure half is pure", () => {
  it("loads with no host object in scope at all", () => {
    const context = createContext(Object.create(null));
    runInContext(EXPLORER_ALGORITHMS, context);
    runInContext(REVIEW_ALGORITHMS, context);
    for (const host of ["document", "window", "fetch", "require", "process", "XMLHttpRequest", "localStorage"]) {
      expect(runInContext(`typeof ${host}`, context)).toBe("undefined");
    }
  });

  it("keeps every DOM reference in the wiring half", () => {
    // Prose is allowed to say "the document"; code is not allowed to touch it.
    expect(REVIEW_ALGORITHMS).not.toMatch(/\bdocument\s*[.[]/);
    expect(REVIEW_ALGORITHMS).not.toMatch(/\bwindow\s*[.[]/);
    expect(REVIEW_RUNTIME_WIRING).toMatch(/\bdocument\s*\./);
  });

  it("ships both halves, in that order", () => {
    expect(REVIEW_RUNTIME.indexOf(REVIEW_ALGORITHMS)).toBeGreaterThan(-1);
    expect(REVIEW_RUNTIME.indexOf(REVIEW_RUNTIME_WIRING)).toBeGreaterThan(
      REVIEW_RUNTIME.indexOf(REVIEW_ALGORITHMS),
    );
  });

  it("reaches for no network primitive anywhere in the shipped runtime", () => {
    expect(REVIEW_RUNTIME).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
    expect(REVIEW_RUNTIME).not.toMatch(/\beval\(|new Function/);
    // The viewer writes text; it never parses source data as markup.
    expect(REVIEW_RUNTIME).not.toContain("innerHTML");
    expect(REVIEW_RUNTIME).not.toContain("outerHTML");
    expect(REVIEW_RUNTIME).not.toContain("insertAdjacentHTML");
  });
});

describe("lens parity", () => {
  it("agrees with changeMatchesLens for every change of every fixture, under every lens", () => {
    for (const [name, fixture] of FIXTURES) {
      const artifact = build(fixture());
      const runtime = embeddedModel(artifact.html);
      for (const lens of REVIEW_LENS_IDS) {
        for (const change of artifact.model.changes) {
          const embedded = runtime.changes.find((c: any) => c.id === change.id);
          expect(embedded, `${name} / ${change.id}`).toBeDefined();
          const browser = call(`rvsChangeMatchesLens(__args[0], __args[1])`, runtime, embedded, lens);
          expect(browser, `${name} / ${lens} / ${change.id}`).toBe(changeMatchesLens(change, lens));
        }
      }
    }
  });

  it("brings forward the same entity ids as lensEntityIds, for every fixture and lens", () => {
    for (const [name, fixture] of FIXTURES) {
      const artifact = build(fixture());
      const runtime = embeddedModel(artifact.html);
      for (const lens of REVIEW_LENS_IDS) {
        expect(call(`rvsLensEntityIds(__model, __args[0])`, runtime, lens), `${name} / ${lens}`).toEqual(
          lensEntityIds(artifact.model, lens),
        );
      }
    }
  });

  it("mutes exactly the entities applyReviewLens mutes", () => {
    for (const [name, fixture] of [
      ["causal chain", causalChain],
      ["governance finding", blockingFinding],
      ["component removed", componentRemoved],
    ] as const) {
      const artifact = build(fixture());
      const runtime = embeddedModel(artifact.html);
      const drawn = artifact.document.primary.audience.model;
      for (const lens of REVIEW_LENS_IDS) {
        const browser = call(`rvsReviewMutedIds(__model, __args[0], __args[1])`, runtime, lens, null) as string[];
        const typescript = applyReviewLens(drawn, artifact.model, lens)
          .nodes.filter((n) => n.emphasis === "muted")
          .map((n) => n.source_entity_id)
          .sort();
        // The runtime works over every node the page holds, the drawn model
        // over the ones this view drew, so the comparison is on the drawn set.
        const drawnIds = new Set(drawn.nodes.map((n) => n.source_entity_id));
        expect(browser.filter((id) => drawnIds.has(id)), `${name} / ${lens}`).toEqual([...new Set(typescript)]);
      }
    }
  });

  it("never mutes the entity the reader is looking at", () => {
    const artifact = build(causalChain());
    const runtime = embeddedModel(artifact.html);
    for (const lens of REVIEW_LENS_IDS) {
      for (const node of runtime.nodes) {
        const muted = call(`rvsReviewMutedIds(__model, __args[0], __args[1])`, runtime, lens, node.entity) as string[];
        expect(muted, `${lens} / ${node.entity}`).not.toContain(node.entity);
      }
    }
  });

  it("changes what is emphasised and never what the review contains", () => {
    const artifact = build(blockingFinding());
    const runtime = embeddedModel(artifact.html);
    const before = JSON.stringify(runtime);
    for (const lens of REVIEW_LENS_IDS) call(`rvsLensEntityIds(__model, __args[0])`, runtime, lens);
    expect(JSON.stringify(runtime)).toBe(before);
  });
});

describe("selection parity", () => {
  const artifact = build(causalChain());
  const runtime = embeddedModel(artifact.html);

  it("returns every change recorded against an entity, in id order", () => {
    for (const node of runtime.nodes) {
      const browser = call(`rvsChangesForEntity(__model, __args[0])`, runtime, node.entity) as any[];
      const expected = artifact.model.changes
        .filter((c) => c.entity_id === node.entity)
        .map((c) => c.id)
        .sort();
      expect(browser.map((c) => c.id)).toEqual(expected);
    }
  });

  it("orders routes strongest evidence first, so a coincidence never leads", () => {
    for (const change of artifact.model.changes) {
      const browser = call(`rvsRoutesForChange(__model, __args[0])`, runtime, change.id) as any[];
      const kinds = browser.map((p) => p.kind);
      const rank = { confirmed: 0, related: 1, unresolved: 2 } as Record<string, number>;
      for (let i = 1; i < kinds.length; i++) expect(rank[kinds[i - 1]]).toBeLessThanOrEqual(rank[kinds[i]]);
      expect(browser.map((p) => p.id).sort()).toEqual(
        artifact.model.confirmed_paths.filter((p) => p.from_change_id === change.id).map((p) => p.id).sort(),
      );
    }
  });

  it("hands back every unresolved statement verbatim, and never rephrases one", () => {
    const artifact_ = build(unknownConsumer());
    const runtime_ = embeddedModel(artifact_.html);
    for (const change of artifact_.model.changes) {
      const browser = call(`rvsUnresolvedForChange(__model, __args[0])`, runtime_, change.id) as any[];
      const expected = artifact_.model.unresolved_impacts.filter((u) => u.change_id === change.id);
      expect(browser.map((u) => u.statement)).toEqual(expected.map((u) => u.statement));
      expect(browser.map((u) => u.id)).toEqual(expected.map((u) => u.id));
    }
  });
});

describe("panel presence parity", () => {
  it("reports a missing side as missing rather than inferring it from the change type", () => {
    const removed = build(componentRemoved());
    const runtime = embeddedModel(removed.html);
    expect(call(`rvsPanelPresence(__model, __args[0])`, runtime, "billing")).toEqual({
      before: true,
      delta: true,
      after: false,
    });
    expect(call(`rvsPanelPresence(__model, __args[0])`, runtime, "api")).toEqual({
      before: true,
      delta: false,
      after: true,
    });
  });

  it("agrees with the model about which side every entity of every fixture was on", () => {
    for (const [name, fixture] of FIXTURES) {
      const artifact = build(fixture());
      const runtime = embeddedModel(artifact.html);
      const before = new Set(artifact.model.before_entity_ids);
      const after = new Set(artifact.model.after_entity_ids);
      const changed = new Set(artifact.model.changes.map((c) => c.entity_id));
      for (const id of Object.keys(runtime.entities)) {
        expect(call(`rvsPanelPresence(__model, __args[0])`, runtime, id), `${name} / ${id}`).toEqual({
          before: before.has(id),
          delta: changed.has(id),
          after: after.has(id),
        });
      }
    }
  });

  it("invents no counterpart for an entity that exists on one side only", () => {
    const runtime = embeddedModel(build(componentRemoved()).html);
    const presence = call(`rvsPanelPresence(__model, __args[0])`, runtime, "nothing-by-this-name");
    expect(presence).toEqual({ before: false, delta: false, after: false });
  });
});
