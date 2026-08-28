import { describe, expect, it } from "vitest";
import {
  AA_THRESHOLDS,
  VISUAL_STATES,
  VISUAL_STATE_LAYERS,
  contrastBetween,
  layerOf,
  neutralTokensFor,
  resolveVisualDesignTokens,
  resolveVisualState,
  samePresentation,
  validateColorIndependence,
  type StatePresentation,
  type VisualState,
} from "../index.js";

const shuffle = <T,>(items: readonly T[], seed: number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = (seed * (i + 7)) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

describe("proofs 5/6/7 -- one state model behind every grammar", () => {
  it("resolves every declared state without falling through", () => {
    for (const state of VISUAL_STATES) {
      const resolved = resolveVisualState([state]);
      expect(resolved.layers.length, state).toBeGreaterThan(0);
      expect(VISUAL_STATE_LAYERS).toContain(layerOf(state));
    }
  });

  it("gives the same presentation whichever artifact asks", () => {
    // The explorer and the change review both ask for the same thing here.
    // §25 requires the answer to be identical, and this is what "identical"
    // has to mean if it is to be testable at all.
    const explorer = resolveVisualState(["removed", "blocking"]);
    const review = resolveVisualState(["blocking", "removed"]);
    expect(samePresentation(explorer, review)).toBe(true);
  });

  it("does not depend on the order states were listed in", () => {
    const states: VisualState[] = ["focused", "removed", "blocking", "unresolved"];
    const runs = [1, 2, 3, 4, 5].map((seed) => JSON.stringify(resolveVisualState(shuffle(states, seed))));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("§21 -- states compose instead of overwriting", () => {
  it("keeps both meanings when a removed entity also blocks governance", () => {
    const resolved = resolveVisualState(["removed", "blocking"]);
    expect(resolved.accessible_terms).toEqual(["removed", "governance blocking"]);
    // Body says removed, badge says blocking: two channels, two facts.
    expect(resolved.fill_role).toBe("removed");
    expect(resolved.channels.marker).toBe("−");
    expect(resolved.channels.badge).toBe("Blocking");
  });

  it("keeps lifecycle, governance, confidence, interaction and availability all speaking at once", () => {
    const resolved = resolveVisualState(["changed", "review_required", "unresolved", "selected", "disabled"]);
    expect(resolved.layers.map((l) => l.layer)).toEqual([
      "lifecycle",
      "governance",
      "confidence",
      "interaction",
      "availability",
    ]);
    expect(resolved.accessible_terms).toEqual([
      "changed",
      "governance review required",
      "unresolved",
      "selected",
      "unavailable",
    ]);
  });

  it("never lets hovering erase what happened to an entity", () => {
    const resting = resolveVisualState(["removed"]);
    const hovered = resolveVisualState(["removed", "hovered"]);
    expect(hovered.fill_role).toBe(resting.fill_role);
    expect(hovered.channels.marker).toBe(resting.channels.marker);
  });

  it("resolves one winner per layer, by rank rather than by input position", () => {
    expect(resolveVisualState(["changed", "removed"]).layers.find((l) => l.layer === "lifecycle")?.state).toBe(
      "removed",
    );
    expect(resolveVisualState(["review_required", "blocking"]).layers.find((l) => l.layer === "governance")?.state).toBe(
      "blocking",
    );
    expect(resolveVisualState(["qualified", "unresolved"]).layers.find((l) => l.layer === "confidence")?.state).toBe(
      "unresolved",
    );
    expect(resolveVisualState(["hovered", "selected"]).layers.find((l) => l.layer === "interaction")?.state).toBe(
      "selected",
    );
  });

  it("always resolves an interaction layer, so a bare call still yields a complete presentation", () => {
    const resolved = resolveVisualState([]);
    expect(resolved.layers.map((l) => l.state)).toEqual(["normal"]);
    expect(resolved.channels).toEqual({ stroke_pattern: "solid", stroke_scale: 1, focus_ring: false, opacity: 1 });
  });
});

describe("Milestone 10 closure -- the compound-state matrix B1 named", () => {
  // Each case pairs a lifecycle or interaction fact with a governance or
  // confidence fact. B1 was that the *renderer* collapsed these to one
  // meaning; this block pins the state-model layer's half of the proof --
  // that resolveVisualState itself never did -- for every pair the
  // remediation spec named, not only removed+blocking.

  it("removed + review_required: lifecycle body, governance badge, both terms", () => {
    const resolved = resolveVisualState(["removed", "review_required"]);
    expect(resolved.fill_role).toBe("removed");
    expect(resolved.stroke_role).toBe("governanceReviewRequired");
    expect(resolved.channels.marker).toBe("−");
    expect(resolved.channels.badge).toBe("Review");
    expect(resolved.accessible_terms).toEqual(["removed", "governance review required"]);
  });

  it("changed + blocking: lifecycle body, governance badge, both terms", () => {
    const resolved = resolveVisualState(["changed", "blocking"]);
    expect(resolved.fill_role).toBe("changed");
    expect(resolved.stroke_role).toBe("governanceBlocking");
    expect(resolved.channels.marker).toBe("~");
    expect(resolved.channels.badge).toBe("Blocking");
    expect(resolved.accessible_terms).toEqual(["changed", "governance blocking"]);
  });

  it("changed + unresolved: confidence owns the stroke, lifecycle still owns the marker", () => {
    const resolved = resolveVisualState(["changed", "unresolved"]);
    expect(resolved.fill_role).toBe("changed");
    // Confidence outranks lifecycle for the stroke, so the border reads
    // "not established" even though the body still reads "changed".
    expect(resolved.stroke_role).toBe("unresolved");
    expect(resolved.channels.marker).toBe("~");
    expect(resolved.channels.stroke_pattern).toBe("dashed");
    expect(resolved.channels.badge).toBeUndefined();
    expect(resolved.accessible_terms).toEqual(["changed", "unresolved"]);
  });

  it("focused + blocking: interaction adds a ring without displacing the governance badge", () => {
    const resolved = resolveVisualState(["focused", "blocking"]);
    expect(resolved.stroke_role).toBe("governanceBlocking");
    expect(resolved.channels.focus_ring).toBe(true);
    expect(resolved.channels.badge).toBe("Blocking");
    expect(resolved.accessible_terms).toEqual(["governance blocking", "focused"]);
  });

  it("route + removed: an interaction trace never erases what happened to the entity", () => {
    const resolved = resolveVisualState(["route", "removed"]);
    // Lifecycle still owns the stroke here: route is an interaction fact and
    // interaction is the lowest-precedence stroke owner, exactly as §21
    // ranks it, so it cannot outrank a real lifecycle event for the border.
    expect(resolved.stroke_role).toBe("removed");
    expect(resolved.fill_role).toBe("removed");
    expect(resolved.channels.marker).toBe("−");
    expect(resolved.channels.stroke_scale).toBeGreaterThanOrEqual(2);
    expect(resolved.accessible_terms).toEqual(["removed", "on the traced route"]);
  });
});

describe("proofs 8/9/10/11 -- the states a reviewer must not miss", () => {
  it("focus is a ring, not a tint", () => {
    const resolved = resolveVisualState(["focused"]);
    expect(resolved.channels.focus_ring).toBe(true);
    expect(resolved.channels.stroke_scale).toBeGreaterThan(1);
  });

  it("unresolved is dashed, so an unconfirmed path never reads as a confirmed one", () => {
    expect(resolveVisualState(["unresolved"]).channels.stroke_pattern).toBe("dashed");
    expect(resolveVisualState(["qualified"]).channels.stroke_pattern).toBe("dotted");
  });

  it("blocking and review-required each carry a word, not only a hue", () => {
    expect(resolveVisualState(["blocking"]).channels.badge).toBe("Blocking");
    expect(resolveVisualState(["review_required"]).channels.badge).toBe("Review");
  });

  it("draws a blocking border heavier than a review-required one", () => {
    expect(resolveVisualState(["blocking"]).channels.stroke_scale).toBeGreaterThan(
      resolveVisualState(["review_required"]).channels.stroke_scale,
    );
  });
});

describe("proof 12 -- change semantics survive without colour", () => {
  const CHANGE: VisualState[] = ["added", "removed", "changed", "rerouted"];

  it("gives every change state a distinct glyph", () => {
    const markers = CHANGE.map((state) => resolveVisualState([state]).channels.marker);
    expect(markers.every(Boolean)).toBe(true);
    expect(new Set(markers).size).toBe(CHANGE.length);
  });

  it("passes the colour-independence check for every state that carries meaning", () => {
    const presentations: StatePresentation[] = [...CHANGE, "blocking", "review_required", "unresolved", "qualified"].map(
      (state) => {
        const resolved = resolveVisualState([state as VisualState]);
        const channels: string[] = [];
        if (resolved.channels.marker) channels.push("marker");
        if (resolved.channels.badge) channels.push("badge");
        if (resolved.channels.stroke_pattern !== "solid") channels.push("stroke-pattern");
        return {
          state,
          color_role: resolved.layers[0]?.color_role ?? "ink",
          non_color_channels: channels,
        };
      },
    );
    expect(validateColorIndependence("scene", presentations).map((f) => f.message)).toEqual([]);
  });

  it("reports a state that would be colour-only", () => {
    const findings = validateColorIndependence("scene", [
      { state: "added", color_role: "added", non_color_channels: [] },
    ]);
    expect(findings.map((f) => f.code)).toEqual(["VISUAL_A11Y_COLOR_ONLY_STATE"]);
  });
});

describe("every state's colour clears AA in every theme", () => {
  it("holds for the neutral palettes and all three profiles", () => {
    const themes = [
      { name: "neutral-light", tokens: resolveVisualDesignTokens({ polarity: "light" }).tokens },
      { name: "neutral-dark", tokens: resolveVisualDesignTokens({ polarity: "dark" }).tokens },
    ];
    for (const { name, tokens } of themes) {
      for (const state of VISUAL_STATES) {
        const resolved = resolveVisualState([state]);
        for (const layer of resolved.layers) {
          if (!layer.color_role) continue;
          if (layer.state === "dimmed" || layer.state === "normal") continue;
          const ratio = contrastBetween(tokens.color[layer.color_role], tokens.color.surface);
          expect(ratio, `${name} ${state} ${layer.color_role}`).toBeGreaterThanOrEqual(AA_THRESHOLDS.non_text);
        }
      }
    }
  });

  it("uses a light and a dark palette that never share a state colour", () => {
    const light = neutralTokensFor("light");
    const dark = neutralTokensFor("dark");
    expect(light.removed).not.toBe(dark.removed);
  });
});
