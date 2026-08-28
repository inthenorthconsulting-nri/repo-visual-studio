import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AA_THRESHOLDS,
  COLOR_ROLE_CONTRAST_TIER,
  DEFAULT_TYPE_SCALE,
  MINIMUM_TEXT_SIZE_PX,
  NEUTRAL_VISUAL_TOKENS,
  VISUAL_COLOR_ROLES,
  VISUAL_TYPE_ROLES,
  contrastBetween,
  isSafeDurationMs,
  isSafeThemeColor,
  neutralTokensFor,
  parseColor,
  parseFontStack,
  resolveVisualDesignTokens,
  serializeFontStack,
  validateTokenContrast,
  validateTypeScale,
  type ExistingDesignSystem,
} from "../index.js";

const DESIGN_SYSTEMS = fileURLToPath(new URL("../../../../design-systems/", import.meta.url));

function profiles(): { name: string; source: ExistingDesignSystem }[] {
  return readdirSync(DESIGN_SYSTEMS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      source: JSON.parse(readFileSync(`${DESIGN_SYSTEMS}${entry.name}/tokens.json`, "utf8")) as ExistingDesignSystem,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe("proof 1/2 -- token resolution for light and dark", () => {
  it("resolves a complete role set in both polarities", () => {
    for (const polarity of ["light", "dark"] as const) {
      const { tokens } = resolveVisualDesignTokens({ polarity });
      for (const role of VISUAL_COLOR_ROLES) {
        expect(parseColor(tokens.color[role]), `${polarity} ${role}`).toBeDefined();
      }
      for (const role of VISUAL_TYPE_ROLES) {
        expect(tokens.type[role].size_px, `${polarity} ${role}`).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
      }
    }
  });

  it("gives the two polarities genuinely different palettes", () => {
    const light = neutralTokensFor("light");
    const dark = neutralTokensFor("dark");
    const shared = VISUAL_COLOR_ROLES.filter((role) => light[role] === dark[role]);
    expect(shared).toEqual([]);
  });

  it("clears AA for every non-decorative role against both grounds, in both polarities", () => {
    for (const polarity of ["light", "dark"] as const) {
      const { tokens } = resolveVisualDesignTokens({ polarity });
      expect(validateTokenContrast(tokens, AA_THRESHOLDS).map((f) => f.message), polarity).toEqual([]);
    }
  });
});

describe("proof 3 -- theme fallback", () => {
  it("records a fallback for every role the theme did not speak for, and never a silent substitution", () => {
    const { tokens, findings } = resolveVisualDesignTokens({
      id: "sparse",
      source: { colors: { background: "#ffffff", text_primary: "#111111" } },
      polarity: "light",
    });
    const fallbacks = findings.filter((f) => f.code === "VISUAL_THEME_TOKEN_FALLBACK");
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const finding of fallbacks) {
      expect(tokens.color_provenance[finding.subject_id as keyof typeof tokens.color_provenance]).not.toBe("theme");
    }
  });

  it("does not read the theme's success colour as the colour for an added entity", () => {
    const { tokens } = resolveVisualDesignTokens({
      source: { colors: { background: "#ffffff", text_primary: "#111111", success: "#00ff00" } },
      polarity: "light",
    });
    expect(tokens.color.added).not.toBe("#00ff00");
    expect(tokens.color_provenance.added).toBe("fallback");
  });

  it("falls back rather than throwing on an unusable value", () => {
    const { tokens, findings } = resolveVisualDesignTokens({
      source: { colors: { background: "not-a-colour", text_primary: "#111111" } },
      polarity: "light",
    });
    expect(findings.some((f) => f.code === "VISUAL_THEME_VALUE_INVALID")).toBe(true);
    expect(parseColor(tokens.color.paper)).toBeDefined();
  });
});

describe("proof 4 -- a theme cannot inject CSS", () => {
  const attacks = [
    "red; background: url(https://evil.example/x)",
    "#fff; } body { display: none",
    "url(javascript:alert(1))",
    "expression(alert(1))",
    "var(--x)",
    "#fff/*",
  ];

  it("rejects every declaration-shaped colour value", () => {
    for (const attack of attacks) expect(isSafeThemeColor(attack), attack).toBe(false);
  });

  it("keeps rejected values out of the resolved tokens entirely", () => {
    for (const attack of attacks) {
      const { tokens } = resolveVisualDesignTokens({
        source: { colors: { accent: attack, background: "#ffffff", text_primary: "#111111" } },
        polarity: "light",
      });
      expect(JSON.stringify(tokens)).not.toContain(attack);
    }
  });

  it("rebuilds a font stack from parsed names rather than forwarding the approved string", () => {
    // The property that matters: nothing the caller wrote survives into the
    // output verbatim. A sanitiser that forwards what it approved is one
    // clever escape away from forwarding an injection.
    const parsed = parseFontStack(`'Fraunces', Georgia, serif`);
    expect(parsed).toEqual(["Fraunces", "Georgia", "serif"]);
    expect(serializeFontStack(parsed!)).toBe("Fraunces, Georgia, serif");
  });

  it("refuses a font stack carrying a declaration, a url, or a script scheme", () => {
    for (const attack of [
      `Inter; } * { display: none`,
      `url(https://evil.example/f.woff)`,
      `javascript:alert(1)`,
      `Inter, ${"x".repeat(200)}`,
      `a, b, c, d, e, f, g, h, i`,
    ]) {
      expect(parseFontStack(attack), attack).toBeUndefined();
    }
  });

  it("bounds numeric theme values", () => {
    expect(isSafeDurationMs(260)).toBe(true);
    expect(isSafeDurationMs(-1)).toBe(false);
    expect(isSafeDurationMs(1e9)).toBe(false);
    expect(isSafeDurationMs(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isSafeDurationMs(Number.NaN)).toBe(false);
    expect(isSafeDurationMs("260")).toBe(false);
  });

  it("never lets a theme lower the type floor", () => {
    const { tokens } = resolveVisualDesignTokens({
      source: { typography: { body: "Inter" } },
      polarity: "light",
    });
    for (const role of VISUAL_TYPE_ROLES) {
      expect(tokens.type[role].size_px).toBeGreaterThanOrEqual(MINIMUM_TEXT_SIZE_PX);
    }
  });
});

describe("proof 29 basis -- every checked-in design-system profile resolves cleanly", () => {
  const all = profiles();

  it("finds at least the three profiles the repository ships", () => {
    expect(all.map((p) => p.name)).toEqual(["editorial-light", "executive-dark", "technical-grid"]);
  });

  for (const { name, source } of all) {
    it(`${name} produces no invalid value and no contrast failure`, () => {
      const polarity = name.includes("dark") ? "dark" : "light";
      const { tokens, findings } = resolveVisualDesignTokens({ id: name, source, polarity });

      expect(
        findings.filter((f) => f.code === "VISUAL_THEME_VALUE_INVALID").map((f) => f.message),
        `${name} invalid values`,
      ).toEqual([]);

      expect(validateTokenContrast(tokens, AA_THRESHOLDS).map((f) => f.message), `${name} contrast`).toEqual([]);
      expect(validateTypeScale(tokens).map((f) => f.message), `${name} type`).toEqual([]);
    });

    it(`${name} takes its stated colours from the theme and nothing else`, () => {
      const polarity = name.includes("dark") ? "dark" : "light";
      const { tokens } = resolveVisualDesignTokens({ id: name, source, polarity });
      if (source.colors?.background) expect(tokens.color.paper).toBe(source.colors.background);
      if (source.colors?.accent) expect(tokens.color.accent).toBe(source.colors.accent);
      // Governance severity is never something a brand palette gets to decide.
      expect(tokens.color_provenance.governanceBlocking).toBe("fallback");
    });
  }
});

describe("derivation never produces the failing value", () => {
  it("keeps every derived role above its own floor on all three profiles", () => {
    for (const { name, source } of profiles()) {
      const polarity = name.includes("dark") ? "dark" : "light";
      const { tokens } = resolveVisualDesignTokens({ id: name, source, polarity });
      for (const role of VISUAL_COLOR_ROLES) {
        if (tokens.color_provenance[role] !== "derived") continue;
        const tier = COLOR_ROLE_CONTRAST_TIER[role];
        if (tier === "decoration") continue;
        const floor = tier === "text" ? AA_THRESHOLDS.text : AA_THRESHOLDS.non_text;
        for (const ground of [tokens.color.surface, tokens.color.paper]) {
          expect(contrastBetween(tokens.color[role], ground), `${name} ${role}`).toBeGreaterThanOrEqual(floor);
        }
      }
    }
  });
});

describe("the minimum text size has exactly one definition", () => {
  it("is the value the default type scale is built against", () => {
    const smallest = Math.min(...VISUAL_TYPE_ROLES.map((role) => DEFAULT_TYPE_SCALE[role].size_px));
    expect(smallest).toBe(MINIMUM_TEXT_SIZE_PX);
  });

  it("is what the neutral token set publishes", () => {
    expect(validateTypeScale(NEUTRAL_VISUAL_TOKENS).map((f) => f.code)).toEqual([]);
  });
});
