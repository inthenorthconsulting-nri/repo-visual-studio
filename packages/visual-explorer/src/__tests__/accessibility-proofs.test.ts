import { describe, expect, it } from "vitest";
import { buildExplorerArtifact } from "../artifact.js";
import { buildExplorerModel } from "../source.js";
import { EXPLORER_RUNTIME } from "../runtime.js";
import { EXPLORER_STYLES } from "../styles.js";
import { estateSource } from "./fixtures.js";

// The explorer's accessibility contract, proved against the file that ships.
//
// Milestone 10.5 §26-38. The earlier suites establish that the explorer's
// semantics are right; these establish that a reader who cannot use a mouse,
// cannot distinguish the palette, or cannot see the screen at all can still
// reach and understand what was drawn.

const html = buildExplorerArtifact({
  producer: "test",
  subject: "estate",
  model: buildExplorerModel(estateSource()),
  audience: "engineering",
  detail_mode: "faithful",
  focal_entity_ids: ["alpha-api"],
}).html;

/** Opening tags of every drawn entity group. */
const nodeTags = [...html.matchAll(/<g [^>]*data-rvs-node="[^"]*"[^>]*>/g)].map((m) => m[0]);

describe("keyboard reach", () => {
  // Proof 14. The keyboard help promises "Tab / Shift+Tab: move between every
  // control, result, and entity". An entity that only a click can reach makes
  // that sentence false.
  it("draws at least one entity, so the rest of this suite is not vacuous", () => {
    expect(nodeTags.length).toBeGreaterThan(3);
  });

  it("makes every drawn entity a tab stop that announces itself as a control", () => {
    for (const tag of nodeTags) {
      expect(tag, tag).toContain('tabindex="0"');
      expect(tag, tag).toContain('role="button"');
    }
  });

  it("gives every tab stop a name before the reader arrives at it", () => {
    // `<title>` is the first child of the group, so the name is available at
    // the moment focus lands rather than after the reader explores inside.
    const groups = [...html.matchAll(/<g [^>]*data-rvs-node="[^"]*"[^>]*>(<title>[^<]+<\/title>)/g)];
    expect(groups.length).toBe(nodeTags.length);
  });

  it("draws the focus ring by existence and offset, not by colour alone", () => {
    // A ring that only changes hue is invisible in greyscale; a ring with no
    // offset is drawn on top of the border it is meant to surround.
    expect(EXPLORER_STYLES).toContain(":focus-visible");
    expect(EXPLORER_STYLES).toMatch(/outline:\s*var\(--rvs-geo-focus-ring-width\)\s+solid/);
    expect(EXPLORER_STYLES).toContain("outline-offset");
  });

  it("never removes the ring the browser would have drawn", () => {
    expect(EXPLORER_STYLES).not.toMatch(/outline:\s*(none|0)/);
  });

  it("clips nothing that could hide a ring on the stage", () => {
    expect(html).not.toMatch(/overflow:\s*hidden[^}]*}\s*$/);
    expect(html).not.toContain("clip-path");
  });
});

describe("what a screen reader is told", () => {
  // Proofs 15 and 16.
  it("has one polite live region and no assertive one", () => {
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("names the destination when a route is traced, not only the hop count", () => {
    // "Route found across 3 relationship(s)" tells a reader nothing about
    // where they ended up. §36 asks for the destination.
    expect(EXPLORER_RUNTIME).toContain('"Route to " + destination + " found across "');
    expect(EXPLORER_RUNTIME).toContain('"No route to " + destination + " exists in this direction."');
  });

  it("announces focus as one sentence carrying the reach it produced", () => {
    expect(EXPLORER_RUNTIME).toContain('"Focused " + nodeById[state.focus].label');
    expect(EXPLORER_RUNTIME).toContain('" entities within "');
  });

  it("says when a lens is applied that nothing was hidden", () => {
    expect(EXPLORER_RUNTIME).toContain("Nothing is hidden; entities outside the lens are de-emphasised.");
  });

  it("never speaks on hover", () => {
    // §30: assistive technology must not be flooded as a pointer crosses the
    // diagram. There is no debounce here because there is no hover listener --
    // the state is unreachable rather than throttled.
    expect(EXPLORER_RUNTIME).not.toMatch(/addEventListener\(\s*"(mouseover|mouseenter|mousemove|pointerover|pointermove)"/);
  });
});

describe("the file works with the network unplugged", () => {
  // Proof 27.
  it("references no remote origin", () => {
    expect(html).not.toMatch(/(?:src|href)="https?:/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it("loads no font from anywhere", () => {
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("makes no request at runtime", () => {
    for (const api of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "navigator.sendBeacon", "import("]) {
      expect(EXPLORER_RUNTIME, api).not.toContain(api);
    }
  });

  it("evaluates nothing", () => {
    for (const api of ["eval(", "new Function", "setTimeout(\"", "innerHTML"]) {
      expect(EXPLORER_RUNTIME, api).not.toContain(api);
    }
  });

  it("honours a reduced-motion preference by removing motion, not shortening it", () => {
    expect(EXPLORER_STYLES).toContain("@media (prefers-reduced-motion: reduce)");
    expect(EXPLORER_STYLES).toMatch(/animation:\s*none\s*!important/);
    expect(EXPLORER_STYLES).toMatch(/transition:\s*none\s*!important/);
  });
});
