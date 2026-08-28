import { describe, expect, it } from "vitest";
import { buildChangeReviewArtifact } from "../artifact.js";
import { buildReviewAssembly } from "../source.js";
import { REVIEW_RUNTIME } from "../runtime.js";
import { REVIEW_STYLES } from "../styles.js";
import { blockingFinding, componentAdded, componentRemoved, everythingChanged } from "./fixtures.js";

// The change-review viewer's accessibility contract. Milestone 10.5 §26-38.
//
// A delta is the surface where colour-only signalling does the most damage: a
// reviewer who cannot tell the added hue from the removed one is not reading a
// slightly worse diagram, they are reading the opposite of the truth.

const artifact = buildChangeReviewArtifact({
  producer: "test",
  subject: "Change review",
  assembly: buildReviewAssembly(blockingFinding()),
  audience: "engineering",
  detail_mode: "faithful",
});
const html = artifact.html;

const nodeTags = [...html.matchAll(/<g [^>]*data-rvs-node="[^"]*"[^>]*>/g)].map((m) => m[0]);

describe("keyboard reach", () => {
  // Proof 14.
  it("makes every drawn entity a named tab stop", () => {
    expect(nodeTags.length).toBeGreaterThan(2);
    for (const tag of nodeTags) {
      expect(tag, tag).toContain('tabindex="0"');
      expect(tag, tag).toContain('role="button"');
    }
  });

  it("draws a focus ring that survives greyscale and is not clipped", () => {
    expect(REVIEW_STYLES).toContain(":focus-visible");
    expect(REVIEW_STYLES).toContain("outline-offset");
    expect(REVIEW_STYLES).not.toMatch(/outline:\s*(none|0)/);
  });
});

describe("change semantics without colour", () => {
  // Proof 12, at the artifact level rather than the renderer's.
  it("gives added, removed and changed three distinct glyphs", () => {
    const markersIn = (fixture: Parameters<typeof buildReviewAssembly>[0]) =>
      new Set(
        [
          ...buildChangeReviewArtifact({
            producer: "test",
            subject: "Change review",
            assembly: buildReviewAssembly(fixture),
            audience: "engineering",
            detail_mode: "faithful",
          }).html.matchAll(/data-rvs-marker="([^"]*)"/g),
        ].map((m) => m[1]),
      );
    expect(markersIn(componentAdded())).toEqual(new Set(["+"]));
    expect(markersIn(componentRemoved())).toEqual(new Set(["−"]));
    expect(markersIn(everythingChanged())).toEqual(new Set(["~"]));
  });

  it("marks the entity it drew, in the review that reports a blocking finding", () => {
    const markers = new Set([...html.matchAll(/data-rvs-marker="([^"]*)"/g)].map((m) => m[1]));
    expect(markers.size).toBeGreaterThan(0);
    for (const marker of markers) expect(["+", "−", "~", "↷"]).toContain(marker);
  });

  it("declares each entity's states in the markup, so both a stylesheet and a reader can see them", () => {
    expect(html).toMatch(/data-rvs-state="[^"]*(added|removed|changed)[^"]*"/);
  });
});

describe("what a reviewer using a screen reader is told", () => {
  // Proof 17.
  it("has one polite live region and no assertive one", () => {
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("announces a selected change by type, entity, and which panels hold it", () => {
    expect(REVIEW_RUNTIME).toContain('"Selected " + change.type + " change on "');
    expect(REVIEW_RUNTIME).toContain('". Present in before: "');
    expect(REVIEW_RUNTIME).toContain('". Present in after: "');
  });

  it("says explicitly when an entity carries no recorded change", () => {
    // Silence would read as "nothing changed here" in exactly the case where
    // the reviewer most needs to know nobody looked.
    expect(REVIEW_RUNTIME).toContain("No change was recorded against this entity.");
  });

  it("says a lens hid nothing", () => {
    expect(REVIEW_RUNTIME).toContain("Nothing is hidden; entities outside the lens are de-emphasised.");
  });

  it("never speaks on hover", () => {
    expect(REVIEW_RUNTIME).not.toMatch(/addEventListener\(\s*"(mouseover|mouseenter|mousemove|pointerover|pointermove)"/);
  });
});

describe("the file works with the network unplugged", () => {
  // Proof 27.
  it("references no remote origin and embeds no font", () => {
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toContain("@font-face");
  });

  it("makes no request and evaluates nothing at runtime", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "eval(", "new Function", "innerHTML"]) {
      expect(REVIEW_RUNTIME, api).not.toContain(api);
    }
  });

  it("removes motion under a reduced-motion preference rather than speeding it up", () => {
    expect(REVIEW_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(REVIEW_STYLES).toMatch(/animation:\s*none\s*!important/);
  });

  it("runs every animation a finite number of times", () => {
    // §46. An infinite animation is a diagram that never finishes telling the
    // reader something, and there is nothing left to say after the first pass.
    expect(REVIEW_STYLES).not.toContain("infinite");
    expect(REVIEW_STYLES).not.toContain("alternate");
  });
});
