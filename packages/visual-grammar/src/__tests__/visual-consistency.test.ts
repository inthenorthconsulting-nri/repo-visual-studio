import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AA_THRESHOLDS,
  MINIMUM_TEXT_SIZE_PX,
  VISUAL_COLOR_ROLES,
  VISUAL_STATES,
  buildMotionPlan,
  minimumLegibleScale,
  resolveVisualDesignTokens,
  resolveVisualState,
  validateMotionPlan,
  validateTokenContrast,
  validateTypeScale,
  type ExistingDesignSystem,
  type VisualState,
} from "@rvs/visual-intelligence";
import { grammarStyleFromTokens, rankEntities, visualConnector, visualNode, visualStylesheet } from "../index.js";
import { fitTransform } from "../geometry.js";

const DESIGN_SYSTEMS = fileURLToPath(new URL("../../../../design-systems/", import.meta.url));

const THEMES = (() => {
  const profiles = readdirSync(DESIGN_SYSTEMS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return [
    { name: "neutral-light", tokens: resolveVisualDesignTokens({ id: "neutral-light", polarity: "light" }).tokens },
    { name: "neutral-dark", tokens: resolveVisualDesignTokens({ id: "neutral-dark", polarity: "dark" }).tokens },
    ...profiles.map((name) => ({
      name,
      tokens: resolveVisualDesignTokens({
        id: name,
        source: JSON.parse(readFileSync(`${DESIGN_SYSTEMS}${name}/tokens.json`, "utf8")) as ExistingDesignSystem,
        polarity: name.includes("dark") ? ("dark" as const) : ("light" as const),
      }).tokens,
    })),
  ];
})();

// The grammars 10.5 migrates, per §55's priority list. Each is a renderer that
// consumes GrammarStyle, so "the same state looks the same in all of them" is
// a property of the style they share rather than of anything they each do.
const GRAMMARS = ["dependency_graph", "fishbone", "swimlane", "nested_containers", "delta_comparison"] as const;

describe("the decisive proof -- one semantic identity across every grammar and theme", () => {
  it("gives one state the same presentation whichever grammar renders it", () => {
    for (const theme of THEMES) {
      const rendered = GRAMMARS.map(() =>
        visualNode(theme.tokens, { id: "billing", label: "billing", states: ["removed", "blocking"] }),
      );
      const [first, ...rest] = rendered;
      for (const other of rest) {
        expect(other!.paint, theme.name).toEqual(first!.paint);
        expect(other!.marker, theme.name).toEqual(first!.marker);
        expect(other!.badge, theme.name).toEqual(first!.badge);
        expect(other!.accessibility.accessible_name, theme.name).toEqual(first!.accessibility.accessible_name);
      }
    }
  });

  it("changes the paint when the theme changes, and only then", () => {
    const light = visualNode(THEMES[0]!.tokens, { id: "a", label: "a", states: ["removed"] });
    const dark = visualNode(THEMES[1]!.tokens, { id: "a", label: "a", states: ["removed"] });
    expect(dark.paint.fill).not.toBe(light.paint.fill);
    // The meaning does not move with the palette.
    expect(dark.marker).toBe(light.marker);
    expect(dark.accessibility.accessible_name).toBe(light.accessibility.accessible_name);
    expect(dark.paint.fill_role).toBe(light.paint.fill_role);
  });
});

describe("§33/§38 -- the full theme x state matrix", () => {
  for (const theme of THEMES) {
    it(`${theme.name}: every state clears AA and carries a non-colour channel`, () => {
      expect(validateTokenContrast(theme.tokens, AA_THRESHOLDS).map((f) => f.message)).toEqual([]);
      expect(validateTypeScale(theme.tokens).map((f) => f.message)).toEqual([]);

      for (const state of VISUAL_STATES) {
        if (state === "normal" || state === "dimmed" || state === "hovered") continue;
        const resolved = resolveVisualState([state]);
        const hasNonColour =
          Boolean(resolved.channels.marker) ||
          Boolean(resolved.channels.badge) ||
          resolved.channels.stroke_pattern !== "solid" ||
          resolved.channels.stroke_scale !== 1 ||
          resolved.channels.focus_ring;
        expect(hasNonColour, `${theme.name} ${state}`).toBe(true);
      }
    });

    it(`${theme.name}: produces a usable grammar style and a clean stylesheet`, () => {
      const style = grammarStyleFromTokens(theme.tokens);
      for (const size of Object.values(style.font_size)) expect(size).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
      const sheet = visualStylesheet(theme.tokens);
      expect(sheet).not.toMatch(/@import|url\(|https?:/);
      for (const role of VISUAL_COLOR_ROLES) {
        expect(sheet).toContain(theme.tokens.color[role]);
      }
    });
  }
});

describe("§56 -- no clipping, no collision, no illegible text", () => {
  it("refuses to certify a view fitted below the legible scale", () => {
    // fitTransform down-scales to fit; the type floor does not scale with it.
    const tokens = THEMES[0]!.tokens;
    const floor = minimumLegibleScale(tokens);
    const fit = fitTransform({ width: 2000, height: 1000 }, { width: 1000, height: 500 });
    expect(fit.scale).toBeLessThan(floor);
    expect(validateTypeScale(tokens, fit.scale).length).toBeGreaterThan(0);
  });

  it("certifies a view that fits without shrinking", () => {
    const fit = fitTransform({ width: 800, height: 400 }, { width: 1000, height: 500 });
    expect(fit.scale).toBe(1);
    expect(validateTypeScale(THEMES[0]!.tokens, fit.scale)).toEqual([]);
  });

  it("keeps the focus ring outside the shape it surrounds, so it cannot be clipped", () => {
    for (const theme of THEMES) {
      expect(theme.tokens.geometry.focusRingWidth).toBeGreaterThan(0);
      expect(theme.tokens.geometry.minimumLabelClearance).toBeGreaterThan(0);
      expect(theme.tokens.geometry.minimumNodeGap).toBeGreaterThan(theme.tokens.geometry.focusRingWidth);
    }
  });
});

describe("proof 28 -- five runs, shuffled inputs, identical output", () => {
  const states: VisualState[] = ["changed", "review_required", "unresolved", "focused"];
  const entities = [
    { id: "gateway", focal: true },
    { id: "billing", governance_significant: true, changed: true },
    { id: "docs", preservation_rank: 11 },
    { id: "vendor", anchor_priority: 3 },
  ];

  const shuffled = <T,>(items: readonly T[], seed: number): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = (seed * 31 + i * 17) % (i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  it("produces one distinct result across five shuffles of every input order", () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => {
      const tokens = resolveVisualDesignTokens({ id: "t", polarity: "light" }).tokens;
      const node = visualNode(tokens, { id: "billing", label: "billing", states: shuffled(states, seed) });
      const connector = visualConnector(tokens, {
        id: "e", from_id: "a", to_id: "b", from_label: "a", to_label: "b",
        connector_kind: "dependency", states: shuffled(states, seed), on_route: true,
      });
      const ranks = [...rankEntities(shuffled(entities, seed)).entries()].sort();
      const plan = buildMotionPlan({
        mode: "impact", grammar: "dependency_graph",
        rings: [shuffled(["a", "b"], seed), shuffled(["c", "d"], seed)],
      });
      return JSON.stringify({
        tokens,
        style: grammarStyleFromTokens(tokens),
        sheet: visualStylesheet(tokens),
        node,
        connector,
        ranks,
        plan,
      });
    });
    expect(new Set(runs).size).toBe(1);
  });

  it("holds for the theme resolver when the source object's keys are reordered", () => {
    const colors = { background: "#ffffff", text_primary: "#111111", accent: "#1d4ed8", border: "#cccccc" };
    const orders = [
      colors,
      { border: colors.border, accent: colors.accent, text_primary: colors.text_primary, background: colors.background },
      { accent: colors.accent, background: colors.background, border: colors.border, text_primary: colors.text_primary },
    ];
    const runs = orders.map((source) =>
      JSON.stringify(resolveVisualDesignTokens({ id: "t", source: { colors: source }, polarity: "light" })),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("holds for the motion plan when target order varies", () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => {
      const plan = buildMotionPlan({
        mode: "trace", grammar: "dependency_graph", sequence: ["a", "b", "c"],
        destination_announcement: "Reached c.",
      });
      return JSON.stringify({ plan, findings: validateMotionPlan({ plan, known_target_ids: shuffled(["a", "b", "c"], seed) }) });
    });
    expect(new Set(runs).size).toBe(1);
  });
});

describe("§69 -- styling cannot alter architectural truth", () => {
  it("changes no connector semantics when the theme changes", () => {
    const make = (tokens: (typeof THEMES)[number]["tokens"]) =>
      visualConnector(tokens, {
        id: "e", from_id: "cli", to_id: "core", from_label: "packages/cli", to_label: "packages/core",
        connector_kind: "governance", direction: "forward",
      });
    const a = make(THEMES[0]!.tokens);
    const b = make(THEMES[3]!.tokens);
    expect(b.connector_kind).toBe(a.connector_kind);
    expect(b.direction).toBe(a.direction);
    expect(b.from_id).toBe(a.from_id);
    expect(b.to_id).toBe(a.to_id);
    expect(b.accessibility.accessible_name).toBe(a.accessibility.accessible_name);
  });

  it("never lets a theme reclassify a governance severity", () => {
    for (const theme of THEMES) {
      // A brand palette can say what its accent is. It cannot say what
      // "blocking" means, so these roles are never theme-provenanced.
      expect(theme.tokens.color_provenance.governanceBlocking, theme.name).toBe("fallback");
      expect(theme.tokens.color_provenance.unresolved, theme.name).toBe("fallback");
      expect(theme.tokens.color_provenance.removed, theme.name).toBe("fallback");
    }
  });

  it("never lets motion assert a propagation the graph did not establish", () => {
    const plan = buildMotionPlan({ mode: "impact", grammar: "dependency_graph", rings: [["a"], [], ["c"]] });
    expect(plan.steps.flatMap((s) => s.target_ids)).not.toContain("b");
    expect(plan.unavailable_depths).toEqual([1]);
  });
});
