import { describe, expect, it } from "vitest";
import { allBudgets, budgetFor, geometricNodeCapacity, layoutProfileFor } from "../budgets.js";
import type { GrammarLayoutProfile } from "../budgets.js";
import { sceneContentBox } from "../coordinate-system.js";
import { DETAIL_MODES, VISUAL_AUDIENCES, VISUAL_GRAMMARS } from "../vocabulary.js";

/**
 * The grid a grammar's nodes are laid out on, re-derived here from the stage
 * geometry alone.
 *
 * The across-axis extent is the usable box for every grammar whose secondary
 * unit *partitions* the content -- a node in one lane is not also in another,
 * so the lanes share the width between them. A `panel` does not partition:
 * before, delta and after draw the same entities three times side by side, so
 * a node's width is one panel's, not the scene's.
 */
function grid(profile: GrammarLayoutProfile): { cols: number; rows: number } {
  const box = sceneContentBox();
  const linear = Math.sqrt(1 - profile.routing_reserve);
  const width = box.width * linear;
  const breadth = profile.group?.unit === "panel" ? Math.min(width, profile.group.pitch) : width;
  return {
    cols: Math.floor(breadth / profile.cell.width),
    rows: Math.floor((box.height * linear) / profile.cell.height),
  };
}

describe("density budgets are derived, not asserted", () => {
  it("re-derives every grammar's faithful node budget from the stage geometry", () => {
    // Milestone 10.60 published example density budgets and asked for them to
    // be validated empirically rather than trusted. They are not constants
    // here at all: each one is the number of legible cells that fit the
    // content box, so this test re-runs the derivation instead of restating
    // an answer.
    for (const grammar of VISUAL_GRAMMARS) {
      const { cols, rows } = grid(layoutProfileFor(grammar));
      expect(geometricNodeCapacity(grammar), grammar).toBe(Math.max(1, cols * rows));
      expect(budgetFor(grammar, "faithful").max_nodes, grammar).toBe(geometricNodeCapacity(grammar));
    }
  });

  it("keeps every cell at or above the legibility floor", () => {
    // A budget that fits more boxes by making them smaller than a readable
    // label is not a budget, it is a shrink. Nothing in this package is
    // allowed to buy capacity that way.
    for (const grammar of VISUAL_GRAMMARS) {
      const { cell } = layoutProfileFor(grammar);
      expect(cell.width).toBeGreaterThanOrEqual(96);
      expect(cell.height).toBeGreaterThanOrEqual(40);
    }
  });

  it("never exceeds the content box with a full grid at faithful detail", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const profile = layoutProfileFor(grammar);
      const box = sceneContentBox();
      const cols = Math.max(1, grid(profile).cols);
      const rows = Math.ceil(geometricNodeCapacity(grammar) / cols);
      // A delta's grid is a panel wide and is drawn three times across, so the
      // width it has to fit inside is the whole box either way.
      const across = profile.group?.unit === "panel" ? cols * profile.cell.width * 3 : cols * profile.cell.width;
      expect(across, grammar).toBeLessThanOrEqual(box.width);
      expect(rows * profile.cell.height, grammar).toBeLessThanOrEqual(box.height);
    }
  });

  it("decreases monotonically from faithful to balanced to simplified", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      const faithful = budgetFor(grammar, "faithful");
      const balanced = budgetFor(grammar, "balanced");
      const simplified = budgetFor(grammar, "simplified");
      expect(balanced.max_nodes).toBeLessThanOrEqual(faithful.max_nodes);
      expect(simplified.max_nodes).toBeLessThanOrEqual(balanced.max_nodes);
      expect(simplified.max_edges).toBeLessThanOrEqual(balanced.max_edges);
      expect(balanced.max_edges).toBeLessThanOrEqual(faithful.max_edges);
    }
  });

  it("never yields an unusable budget", () => {
    for (const mode of DETAIL_MODES) {
      for (const budget of allBudgets(mode)) {
        expect(budget.max_nodes).toBeGreaterThanOrEqual(1);
        expect(budget.max_edges).toBeGreaterThanOrEqual(0);
        expect(budget.max_depth).toBeGreaterThanOrEqual(1);
        if (budget.max_groups !== undefined) expect(budget.max_groups).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("covers every grammar exactly once", () => {
    const budgets = allBudgets("faithful");
    expect(budgets.map((b) => b.grammar)).toEqual([...VISUAL_GRAMMARS]);
  });

  it("holds depth constant across detail modes", () => {
    // Depth is a comprehension limit, not a density one. Simplifying a view
    // must not smuggle in a shallower traversal than the caller asked for.
    for (const grammar of VISUAL_GRAMMARS) {
      const depths = DETAIL_MODES.map((mode) => budgetFor(grammar, mode).max_depth);
      expect(new Set(depths).size).toBe(1);
    }
  });
});

describe("budgets are a function of grammar and detail only", () => {
  it("takes no audience parameter and cannot vary by one", () => {
    // The orthogonality rule, checked structurally: `budgetFor` has arity 2,
    // so there is no signature through which an audience could reach a
    // budget. `executive => fewer nodes` is not expressible here.
    expect(budgetFor.length).toBe(2);
    expect(VISUAL_AUDIENCES.length).toBeGreaterThan(1);
  });
});
