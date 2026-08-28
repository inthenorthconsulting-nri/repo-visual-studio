import { describe, expect, it } from "vitest";
import { chromium } from "playwright";
import {
  buildVisualCommunicationSpec,
  emptyVisualGraphModel,
  type VisualGraphModel,
  type VisualNode,
} from "@rvs/visual-intelligence";
import { renderGrammar } from "@rvs/visual-grammar";
import { reviewStylesheet } from "../styles.js";

// Milestone 10 closure remediation, §31: the change-review runtime paints a
// traced route by setting `data-rvs-route="confirmed"` directly on a node's
// own `<g data-rvs-node="...">` (`runtime.ts`'s `paint()`), and
// `[data-rvs-route="confirmed"] { stroke-dasharray: none; }` (`styles.ts`)
// targets that same element. A removed/unresolved/qualified node's border is
// drawn dashed by the shared state model, and the dash lives on the child
// `<rect>` as its own explicit `stroke-dasharray` attribute (`render.ts`'s
// `nodeAccent`/box). The open question this test answers empirically -- not
// by reasoning about the CSS spec, which is exactly how B1 went unnoticed --
// is whether the ancestor rule's `none` cascades down through SVG property
// inheritance and silently erases the rect's own dash once a route is
// traced through a removed node, which would repeat B1's failure mode
// (a real fact drawn, then overwritten) one layer up, in the interactive
// surface rather than the static renderer.

function removedNodeModel(): VisualGraphModel {
  const node: VisualNode = {
    id: "legacy",
    source_entity_id: "legacy",
    label: "legacy",
    kind: "component",
    emphasis: "normal",
    resolution: "resolved",
    confidence: "confirmed",
    evidence_refs: [],
  };
  return {
    ...emptyVisualGraphModel(),
    nodes: [node],
    changes: [{ id: "c1", kind: "removed", subject_id: "legacy", subject_type: "node", detail: "retired", evidence_refs: [] }],
  };
}

function pageHtml(): string {
  const m = removedNodeModel();
  const built = buildVisualCommunicationSpec({
    producer: "test",
    subject: "route-vs-dash",
    semantic_intent: "architecture",
    model: m,
    audience: "engineering",
    detail_mode: "faithful",
    format: "slide",
  });
  const { svg } = renderGrammar({ spec: built.spec, model: built.model });
  const css = reviewStylesheet();
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="rvs-stage">${svg}</div></body></html>`;
}

describe("§31 -- a traced route must not silently undash a removed node's border", () => {
  it("leaves the rect's own dash pattern in place after data-rvs-route is set on its node group, in a real browser", async () => {
    let chromiumAvailable = true;
    let browser;
    try {
      browser = await chromium.launch();
    } catch {
      chromiumAvailable = false;
    }
    if (!chromiumAvailable || browser === undefined) {
      // Chromium is not installed in every environment this suite runs in
      // (see `rvs doctor`'s own guard for the same condition); the assertion
      // this test exists to make cannot be made without a real browser, so it
      // is skipped rather than faked with a DOM emulator whose CSS-cascade
      // fidelity for SVG presentation attributes is exactly the kind of thing
      // this test does not trust secondhand.
      return;
    }
    try {
      const page = await browser.newPage();
      await page.setContent(pageHtml());

      // This package's own tsconfig deliberately excludes the "DOM" lib --
      // its `src` is authored as text and never executed in-package (see
      // tsconfig.json's comment). These callbacks only ever run inside a
      // real Chromium page via Playwright, never compiled against this
      // package's own type-check, so they are passed as source text rather
      // than as typed closures, matching that same boundary.
      type DashWidth = { dasharray: string; width: string } | null;
      const before = (await page.evaluate(`(() => {
        const rect = document.querySelector('[data-rvs-node="legacy"] rect');
        return rect
          ? { dasharray: getComputedStyle(rect).strokeDasharray, width: getComputedStyle(rect).strokeWidth }
          : null;
      })()`)) as DashWidth;
      expect(before).not.toBeNull();
      expect(before?.dasharray).not.toBe("none");

      await page.evaluate(`(() => {
        document.querySelector('[data-rvs-node="legacy"]')?.setAttribute("data-rvs-route", "confirmed");
      })()`);

      type AfterState = {
        groupDasharray: string | null;
        groupWidth: string | null;
        rectDasharray: string | null;
        rectWidth: string | null;
        rectOwnDasharray: string | null;
        rectOwnWidth: string | null;
      };
      const after = (await page.evaluate(`(() => {
        const group = document.querySelector('[data-rvs-node="legacy"]');
        const rect = group ? group.querySelector("rect") : null;
        return {
          groupDasharray: group ? getComputedStyle(group).strokeDasharray : null,
          groupWidth: group ? getComputedStyle(group).strokeWidth : null,
          rectDasharray: rect ? getComputedStyle(rect).strokeDasharray : null,
          rectWidth: rect ? getComputedStyle(rect).strokeWidth : null,
          rectOwnDasharray: rect ? rect.getAttribute("stroke-dasharray") : null,
          rectOwnWidth: rect ? rect.getAttribute("stroke-width") : null,
        };
      })()`)) as AfterState;

      // The CSS rule does reach the group -- inheritance is not broken in
      // general, only overridden where the descendant has its own specified
      // value.
      expect(after.groupDasharray).toBe("none");
      expect(after.groupWidth).toBe("4px");
      // The rect's own attributes are untouched...
      expect(after.rectOwnDasharray).toBe("6 4");
      expect(after.rectOwnWidth).not.toBeNull();
      // ...and its computed style -- what the reader actually sees -- still
      // reflects those attributes rather than the ancestor's route-overlay
      // values. This is the §31 dash-survival proof this test exists for.
      expect(after.rectDasharray).toBe(before?.dasharray);
      expect(after.rectDasharray).not.toBe("none");
      // Adjacent finding, not fixed here (out of B1/B2 scope per the closure
      // spec's §32 exclusion boundary): the SAME mechanism that protects the
      // dash also means the route overlay's intended stroke-width
      // intensification on `[data-rvs-route="confirmed"]` never reaches the
      // rect either -- the rect keeps its own pre-existing stroke-width
      // rather than adopting the overlay's 4px. Recorded here as a factual
      // regression pin, not asserted as a bug to fix.
      expect(after.rectWidth).toBe(before?.width);

      await page.close();
    } finally {
      await browser.close();
    }
  }, 30_000);
});
