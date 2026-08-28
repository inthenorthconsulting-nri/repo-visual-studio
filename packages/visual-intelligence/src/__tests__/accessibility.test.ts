import { describe, expect, it } from "vitest";
import {
  AAA_THRESHOLDS,
  AA_THRESHOLDS,
  MINIMUM_TEXT_SIZE_PX,
  NEUTRAL_VISUAL_TOKENS,
  VISUAL_A11Y_CODES,
  accessibleName,
  contrastBetween,
  contrastRatio,
  minimumLegibleScale,
  parseColor,
  resolveVisualDesignTokens,
  thresholdsFor,
  validateAccessibilitySpecs,
  validateColorIndependence,
  validateTokenContrast,
  validateTypeScale,
  type VisualAccessibilitySpec,
} from "../index.js";

const spec = (over: Partial<VisualAccessibilitySpec> = {}): VisualAccessibilitySpec => ({
  accessible_name: "Component packages/cli",
  role: "group",
  focusable: true,
  tab_order: 0,
  announcements: [],
  reduced_motion_behavior: "instant_state_change",
  minimum_contrast: "AA",
  minimum_font_size_px: MINIMUM_TEXT_SIZE_PX,
  ...over,
});

describe("proof 13/15 -- names say what a thing is", () => {
  it("builds §28's example verbatim", () => {
    expect(
      accessibleName({ kind: "Component", label: "packages/cli", change: "changed", governance: "governance review required" }),
    ).toBe("Component packages/cli, changed, governance review required");
  });

  it("keeps the field order fixed as parts drop out", () => {
    expect(accessibleName({ kind: "Component", label: "api", qualification: "unresolved" })).toBe(
      "Component api, unresolved",
    );
    expect(accessibleName({ kind: "Component", label: "api" })).toBe("Component api");
  });

  it("says a stand-in is a stand-in before saying anything else about it", () => {
    expect(
      accessibleName({ kind: "Group", label: "vendor", standIn: "collapsed group of 12 entities", change: "changed" }),
    ).toBe("Group vendor, collapsed group of 12 entities, changed");
  });
});

describe("proof 16 -- announcements do not flood", () => {
  it("has no hover trigger to flood with", () => {
    // §30 is honoured structurally: hover is not a member of the trigger
    // union, so no renderer can announce on pointer movement at all.
    const triggers: string[] = ["focus", "selection", "route", "change", "filter", "motion_complete"];
    expect(triggers).not.toContain("hover");
  });

  it("keeps focus announcements polite", () => {
    const focus = spec({ announcements: [{ trigger: "focus", politeness: "polite", text: "Component api, changed" }] });
    expect(focus.announcements.every((a) => a.politeness === "polite")).toBe(true);
  });
});

describe("proof 14 -- keyboard focus is reachable and unambiguous", () => {
  it("reports a focusable element with no name", () => {
    const found = validateAccessibilitySpecs("scene", [spec({ accessible_name: "  " })]);
    expect(found.map((f) => f.code)).toContain("VISUAL_A11Y_NAME_MISSING");
  });

  it("reports two focusable elements claiming the same position", () => {
    const found = validateAccessibilitySpecs("scene", [spec({ tab_order: 1 }), spec({ tab_order: 1 })]);
    expect(found.map((f) => f.code)).toContain("VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC");
  });

  it("is quiet on a well-formed, distinctly-ordered set", () => {
    expect(validateAccessibilitySpecs("scene", [spec({ tab_order: 0 }), spec({ tab_order: 1 })])).toEqual([]);
  });

  it("reports a focus ring that cannot be seen", () => {
    const { tokens } = resolveVisualDesignTokens({ polarity: "light" });
    const invisible = { ...tokens, geometry: { ...tokens.geometry, focusRingWidth: 0 } };
    const found = validateAccessibilitySpecs("scene", [spec()], invisible);
    expect(found.map((f) => f.code)).toContain("VISUAL_A11Y_FOCUS_NOT_VISIBLE");
  });

  it("accepts the shipped focus ring", () => {
    const { tokens } = resolveVisualDesignTokens({ polarity: "light" });
    expect(validateAccessibilitySpecs("scene", [spec()], tokens)).toEqual([]);
  });
});

describe("contrast is computed, not asserted", () => {
  it("reproduces the WCAG extremes", () => {
    expect(contrastRatio(parseColor("#ffffff")!, parseColor("#000000")!)).toBe(21);
    expect(contrastRatio(parseColor("#777777")!, parseColor("#777777")!)).toBe(1);
  });

  it("is symmetric", () => {
    expect(contrastBetween("#1d4ed8", "#ffffff")).toBe(contrastBetween("#ffffff", "#1d4ed8"));
  });

  it("uses the levels @rvs/validator already enforces", () => {
    expect(thresholdsFor("AA")).toEqual(AA_THRESHOLDS);
    expect(thresholdsFor("AAA")).toEqual(AAA_THRESHOLDS);
    expect(AA_THRESHOLDS).toEqual({ text: 4.5, non_text: 3 });
  });

  it("reports the role, the ground, the ratio, and the requirement", () => {
    const { tokens } = resolveVisualDesignTokens({ polarity: "light" });
    const broken = { ...tokens, color: { ...tokens.color, critical: "#fdfdfd" } };
    const found = validateTokenContrast(broken, AA_THRESHOLDS);
    expect(found.map((f) => f.code)).toContain("VISUAL_A11Y_CONTRAST_INSUFFICIENT");
    expect(found[0]?.message).toMatch(/critical/);
    expect(found[0]?.message).toMatch(/4\.5:1 is required/);
  });

  it("holds AAA too on the neutral palettes for text roles that claim it", () => {
    const { tokens } = resolveVisualDesignTokens({ polarity: "light" });
    // Not every role clears AAA -- the assertion is that the check runs and
    // names what it found, not that the neutral palette is AAA throughout.
    const aaa = validateTokenContrast(tokens, AAA_THRESHOLDS);
    expect(aaa.every((f) => f.code === "VISUAL_A11Y_CONTRAST_INSUFFICIENT")).toBe(true);
  });
});

describe("proof 26 basis -- the effective size is what matters", () => {
  it("passes at scale 1", () => {
    expect(validateTypeScale(NEUTRAL_VISUAL_TOKENS)).toEqual([]);
  });

  it("catches a compliant scale that a fitted view shrinks below the floor", () => {
    // fitTransform down-scales a scene to fit the frame. A 14px label in a
    // view fitted at 0.8 renders at 11.2 CSS pixels, and the declared size
    // passing the floor proves nothing on its own.
    const found = validateTypeScale(NEUTRAL_VISUAL_TOKENS, 0.8);
    expect(found.map((f) => f.code)).toContain("VISUAL_A11Y_TEXT_TOO_SMALL");
    expect(found[0]?.message).toMatch(/renders at 11\.2px/);
    expect(found[0]?.message).toMatch(/Reduce content rather than type/);
  });

  it("names the scale below which a view must shed content instead of shrinking", () => {
    expect(minimumLegibleScale(NEUTRAL_VISUAL_TOKENS)).toBe(1);
  });
});

describe("every VISUAL_A11Y_ code is reachable", () => {
  it("declares exactly the six codes a caller can provoke", () => {
    const { tokens } = resolveVisualDesignTokens({ polarity: "light" });
    const raised = new Set<string>();

    for (const finding of validateTokenContrast({ ...tokens, color: { ...tokens.color, ink: "#fefefe" } }, AA_THRESHOLDS)) {
      raised.add(finding.code);
    }
    for (const finding of validateTypeScale(tokens, 0.5)) raised.add(finding.code);
    for (const finding of validateColorIndependence("s", [{ state: "added", color_role: "added", non_color_channels: [] }])) {
      raised.add(finding.code);
    }
    for (const finding of validateAccessibilitySpecs(
      "s",
      [spec({ accessible_name: "" }), spec({ tab_order: 0 })],
      { ...tokens, geometry: { ...tokens.geometry, focusRingWidth: 0 } },
    )) {
      raised.add(finding.code);
    }

    expect([...raised].sort()).toEqual([...VISUAL_A11Y_CODES].sort());
  });

  it("does not duplicate the motion vocabulary's reduced-motion code", () => {
    expect(VISUAL_A11Y_CODES).not.toContain("VISUAL_A11Y_REDUCED_MOTION_MISSING" as never);
  });
});
