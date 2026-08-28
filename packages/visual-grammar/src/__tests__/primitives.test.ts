import { describe, expect, it } from "vitest";
import {
  MINIMUM_TEXT_SIZE_PX,
  VISUAL_COLOR_ROLES,
  contrastBetween,
  resolveVisualDesignTokens,
  resolveVisualState,
  validateAccessibilitySpecs,
  type VisualState,
} from "@rvs/visual-intelligence";
import {
  MAX_PRIMARY_ENTITIES,
  focalBudgetRespected,
  grammarStyleFromTokens,
  nameFromState,
  paintFor,
  rankEntities,
  visualConnector,
  visualFocusRing,
  visualLegend,
  visualNode,
  visualStandIn,
  visualStylesheet,
  visualStylesheetDualPolarity,
} from "../index.js";
import { NEUTRAL_STYLE } from "../style.js";

const LIGHT = resolveVisualDesignTokens({ polarity: "light" }).tokens;
const DARK = resolveVisualDesignTokens({ polarity: "dark" }).tokens;

describe("proof 5/6 -- one style surface, fed from tokens", () => {
  it("fills every field of the injected style contract", () => {
    const style = grammarStyleFromTokens(LIGHT);
    expect(Object.keys(style).sort()).toEqual(Object.keys(NEUTRAL_STYLE).sort());
    expect(Object.keys(style.state).sort()).toEqual(Object.keys(NEUTRAL_STYLE.state).sort());
  });

  it("fixes the sub-floor type sizes the hand-written neutral style shipped", () => {
    // A pre-existing defect this milestone closes by construction: the
    // 10.2 neutral style declared secondary at 12px and annotation at 11px,
    // both below the size @rvs/validator enforces on rendered text.
    expect(NEUTRAL_STYLE.font_size.secondary).toBeLessThan(MINIMUM_TEXT_SIZE_PX);
    const style = grammarStyleFromTokens(LIGHT);
    for (const size of Object.values(style.font_size)) {
      expect(size).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
    }
  });

  it("gives a dark theme a genuinely dark canvas without any renderer changing", () => {
    expect(grammarStyleFromTokens(DARK).surface.canvas).toBe(DARK.color.paper);
    expect(grammarStyleFromTokens(LIGHT).surface.canvas).not.toBe(grammarStyleFromTokens(DARK).surface.canvas);
  });

  it("does not let a theme's success colour become the colour for an added entity", () => {
    const { tokens } = resolveVisualDesignTokens({
      source: { colors: { background: "#ffffff", text_primary: "#111111", success: "#00ff00" } },
      polarity: "light",
    });
    expect(grammarStyleFromTokens(tokens).state.added).not.toBe("#00ff00");
  });
});

describe("proof 7 -- change-state styling is computed once", () => {
  it("paints the same removed node the same way for every caller", () => {
    const a = visualNode(LIGHT, { id: "billing", label: "billing", states: ["removed"] });
    const b = visualNode(LIGHT, { id: "billing", label: "billing", states: ["removed"] });
    expect(a.paint).toEqual(b.paint);
    expect(a.marker).toBe("−");
    expect(a.paint.stroke_dasharray).toBe("6 4");
  });

  it("keeps both a removal and a blocking finding visible on one node", () => {
    const node = visualNode(LIGHT, { id: "billing", label: "billing", states: ["removed", "blocking"] });
    expect(node.marker).toBe("−");
    expect(node.badge).toBe("Blocking");
    expect(node.accessibility.accessible_name).toBe("Component billing, removed, governance blocking");
  });

  it("resolves paint from roles the theme owns, never from literals", () => {
    const node = visualNode(DARK, { id: "a", label: "a", states: ["added"] });
    expect(VISUAL_COLOR_ROLES).toContain(node.paint.fill_role);
    expect(node.paint.fill).toBe(DARK.color.added);
  });
});

describe("proof 8 -- the focus ring", () => {
  it("draws at the token width, outside the shape, in the focus role", () => {
    const ring = visualFocusRing(LIGHT, { subject_id: "api", subject_name: "Component api" });
    expect(ring.width).toBe(LIGHT.geometry.focusRingWidth);
    expect(ring.offset).toBeGreaterThan(0);
    expect(ring.paint.stroke).toBe(LIGHT.color.focus);
  });

  it("clears 3:1 against both grounds in both polarities", () => {
    for (const tokens of [LIGHT, DARK]) {
      for (const ground of [tokens.color.surface, tokens.color.paper]) {
        expect(contrastBetween(tokens.color.focus, ground)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("proof 9 -- unresolved never reads as confirmed", () => {
  it("dashes an unresolved connector even when the caller forgot to say so", () => {
    const connector = visualConnector(LIGHT, {
      id: "e1",
      from_id: "a",
      to_id: "b",
      from_label: "packages/cli",
      to_label: "packages/core",
      connector_kind: "unresolved",
    });
    expect(connector.paint.stroke_dasharray).toBe("6 4");
    expect(connector.accessibility.accessible_name).toBe("packages/cli may relate to packages/core, unresolved");
  });

  it("names a relationship rather than announcing that a line exists", () => {
    const connector = visualConnector(LIGHT, {
      id: "e1",
      from_id: "a",
      to_id: "b",
      from_label: "packages/cli",
      to_label: "packages/core",
      connector_kind: "dependency",
    });
    expect(connector.accessibility.accessible_name).toBe("packages/cli depends on packages/core");
    expect(connector.accessibility.accessible_name).not.toMatch(/e1|edge|node-/);
  });

  it("emphasises a routed connector without changing what it asserts", () => {
    const plain = visualConnector(LIGHT, {
      id: "e", from_id: "a", to_id: "b", from_label: "a", to_label: "b", connector_kind: "dependency",
    });
    const routed = visualConnector(LIGHT, {
      id: "e", from_id: "a", to_id: "b", from_label: "a", to_label: "b", connector_kind: "dependency", on_route: true,
    });
    expect(routed.paint.stroke_width).toBeGreaterThan(plain.paint.stroke_width);
    expect(routed.connector_kind).toBe(plain.connector_kind);
    expect(routed.accessibility.accessible_name).toBe("a depends on b, on the traced route");
  });
});

describe("§19 -- a stand-in cannot pretend to be a real entity", () => {
  const standIn = visualStandIn(LIGHT, {
    id: "grp:vendor",
    group_label: "vendor",
    entity_count: 12,
    fidelity_reason: "Collapsed to stay within the balanced detail budget.",
    navigable_to: "the vendor split view",
    has_split_view: true,
  });

  it("states the count, the group, the reason, and the way back", () => {
    expect(standIn.accessibility.accessible_name).toBe("12 collapsed entities in vendor");
    expect(standIn.accessibility.accessible_description).toContain("balanced detail budget");
    expect(standIn.accessibility.accessible_description).toContain("the vendor split view");
    expect(standIn.entity_count).toBe(12);
    expect(standIn.has_split_view).toBe(true);
  });

  it("is reachable by keyboard, because it is the route to what was collapsed", () => {
    expect(standIn.accessibility.focusable).toBe(true);
    expect(standIn.accessibility.role).toBe("button");
  });

  it("is drawn unlike a real node", () => {
    const real = visualNode(LIGHT, { id: "api", label: "api" });
    expect(standIn.paint.stroke_dasharray).toBeDefined();
    expect(real.paint.stroke_dasharray).toBeUndefined();
  });
});

describe("the legend proves the diagram reads without colour", () => {
  const legend = visualLegend(LIGHT, "legend", ["added", "removed", "changed", "rerouted", "unresolved"]);

  it("carries a non-colour channel on every entry", () => {
    for (const entry of legend.entries) {
      expect(Boolean(entry.marker) || entry.stroke_pattern !== "solid", entry.label).toBe(true);
    }
  });

  it("labels entries with words, never with colour names", () => {
    for (const entry of legend.entries) {
      expect(entry.label).not.toMatch(/red|green|blue|orange|purple|gray|grey/i);
    }
  });
});

describe("§11/§12 -- focal discipline", () => {
  it("caps primary entities however many were flagged focal", () => {
    const ranks = rankEntities(
      Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, focal: true, on_primary_path: true })),
    );
    expect([...ranks.values()].filter((r) => r === "primary")).toHaveLength(MAX_PRIMARY_ENTITIES);
    expect(focalBudgetRespected(ranks)).toBe(true);
  });

  it("ranks from upstream facts, not from input order", () => {
    const entities = [
      { id: "gateway", focal: true },
      { id: "billing", governance_significant: true },
      { id: "docs", preservation_rank: 12 },
      { id: "vendor" },
    ];
    const forward = rankEntities(entities);
    const backward = rankEntities([...entities].reverse());
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
    expect(forward.get("gateway")).toBe("primary");
    expect(forward.get("billing")).toBe("secondary");
    expect(forward.get("vendor")).toBe("context");
  });

  it("degrades an over-flagged scene to a real hierarchy rather than to a flat one", () => {
    const ranks = rankEntities(Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, focal: true })));
    expect(new Set(ranks.values()).size).toBeGreaterThan(1);
  });
});

describe("§59/§60 -- the generated stylesheet cannot carry an injection", () => {
  it("publishes a custom property for every colour role", () => {
    const sheet = visualStylesheet(LIGHT);
    for (const role of VISUAL_COLOR_ROLES) {
      expect(sheet, role).toContain(`--rvs-color-`);
    }
    expect(sheet).toContain("--rvs-color-governance-blocking:");
    expect(sheet).toContain("--rvs-color-paper:");
  });

  it("drops a value that could close a declaration instead of escaping it", () => {
    const hostile = {
      ...LIGHT,
      color: { ...LIGHT.color, accent: "#fff; } body { display: none } .x {" },
      font_stack: { ...LIGHT.font_stack, body: "Inter; } * { color: red" },
    };
    const sheet = visualStylesheet(hostile);
    expect(sheet).not.toContain("display: none");
    expect(sheet).not.toContain("--rvs-color-accent:");
    expect(sheet).not.toContain("--rvs-font-body:");
  });

  it("contains no remote reference of any kind", () => {
    const sheet = visualStylesheetDualPolarity(LIGHT, DARK);
    expect(sheet).not.toMatch(/@import|url\(|https?:|\/\/fonts\./);
  });

  it("declares exactly one keyframe, running once", () => {
    const sheet = visualStylesheet(LIGHT);
    expect(sheet.match(/@keyframes/g)).toHaveLength(1);
    expect(sheet).not.toMatch(/infinite|alternate/);
    expect(sheet).toMatch(/animation: rvs-emphasis var\(--rvs-motion-standard\) ease-out 1 both/);
  });

  it("turns motion off entirely under prefers-reduced-motion", () => {
    const sheet = visualStylesheet(LIGHT);
    expect(sheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(sheet).toMatch(/animation: none !important/);
    expect(sheet).toMatch(/transition: none !important/);
  });

  it("restores dimmed content for print, so a printed diagram loses nothing", () => {
    expect(visualStylesheet(LIGHT)).toMatch(/@media print[\s\S]*dimmed"\] \{ opacity: 1; \}/);
  });
});

describe("primitives carry accessibility that validates", () => {
  it("produces a nameable, distinctly-ordered set", () => {
    const specs = [
      visualNode(LIGHT, { id: "a", label: "packages/cli", states: ["changed"], tab_order: 0 }),
      visualNode(LIGHT, { id: "b", label: "packages/core", tab_order: 1 }),
      visualStandIn(LIGHT, {
        id: "g", group_label: "vendor", entity_count: 3, fidelity_reason: "Budget.", navigable_to: "the vendor view", tab_order: 2,
      }),
    ].map((primitive) => primitive.accessibility);
    expect(validateAccessibilitySpecs("scene", specs, LIGHT)).toEqual([]);
  });

  it("names a state through the same words the state model uses", () => {
    const state = resolveVisualState(["changed", "review_required"] as VisualState[]);
    expect(nameFromState("Component", "packages/cli", state)).toBe(
      "Component packages/cli, changed, governance review required",
    );
  });

  it("never lets paint disagree with the resolved state", () => {
    const state = resolveVisualState(["removed", "blocking"]);
    expect(paintFor(LIGHT, state).fill).toBe(LIGHT.color[state.fill_role]);
    expect(paintFor(LIGHT, state).opacity).toBe(state.channels.opacity);
  });
});
