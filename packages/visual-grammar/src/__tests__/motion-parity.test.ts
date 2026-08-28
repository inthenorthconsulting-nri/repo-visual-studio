import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildMotionPlan,
  DEFAULT_MOTION,
  MAX_TOTAL_MOTION_MS,
  MOTION_INTENTS,
  motionRingsFromDepths,
  type MotionPlan,
  type MotionPlanInput,
} from "@rvs/visual-intelligence";
import { MOTION_ALGORITHMS, MOTION_PLAYER } from "../motion-runtime.js";

// The motion parity proof.
//
// A trace plan cannot be built when the artifact is written: it depends on
// which route the reader asks for, and the reader has not asked yet. So the
// plan builder exists twice -- once in @rvs/visual-intelligence where the
// tests hold it to account, and once as browser text, which is the copy that
// actually runs. The second copy is the one that would drift unwatched.
//
// This runs the browser copy in a context with nothing in it -- no `document`,
// no `window`, no `require`, not even `Object` from this realm -- and requires
// it to produce the same plan as the tested builder, field for field.

/** The algorithms, loaded into a context with nothing else in it. */
function loadAlgorithms(): (fn: string, input: unknown) => unknown {
  const context = createContext(Object.create(null));
  runInContext(MOTION_ALGORITHMS, context);
  return (fn: string, input: unknown) => {
    // The input crosses as JSON, not as a live object. A host object reaching
    // into the VM would let the browser copy read something the browser will
    // never have, and the parity claim would be weaker than it looks.
    (context as Record<string, unknown>).__input = JSON.stringify(input);
    return JSON.parse(
      runInContext(`JSON.stringify(${fn}(JSON.parse(__input)))`, context) as string,
    ) as unknown;
  };
}

const call = loadAlgorithms();
const browserPlan = (input: unknown): MotionPlan => call("rvsBuildMotionPlan", input) as MotionPlan;
const browserRings = (input: unknown): string[][] => call("rvsMotionRingsFromDepths", input) as string[][];

/** Two plans agree when their JSON does. `undefined` fields drop on both sides alike. */
const agree = (input: MotionPlanInput) =>
  expect(JSON.parse(JSON.stringify(browserPlan(input)))).toEqual(
    JSON.parse(JSON.stringify(buildMotionPlan(input))),
  );

describe("the browser plan builder agrees with the tested one", () => {
  it("on every mode in the union", () => {
    for (const mode of MOTION_INTENTS) {
      agree({ mode, grammar: "dependency_graph", sequence: ["edge-c", "edge-a", "edge-b"] });
    }
  });

  it("on a trace, whose sequence is a route and must not be reordered", () => {
    agree({
      mode: "trace",
      grammar: "dependency_graph",
      sequence: ["edge-z", "edge-m", "edge-a"],
      destination_announcement: "Route to Billing found across 3 relationships.",
    });
  });

  it("on an impact fan, whose rings sort within each depth", () => {
    agree({
      mode: "impact",
      grammar: "architecture",
      rings: [["api"], ["shipping", "billing", "audit"], ["reporting"]],
    });
  });

  it("on an impact fan carrying a depth the graph could not populate", () => {
    // §48: the empty ring is recorded, never filled. Both copies have to
    // record it the same way, or the browser would silently draw a
    // propagation step nobody established.
    const plan = browserPlan({ mode: "impact", grammar: "architecture", rings: [["api"], [], ["billing"]] });
    expect(plan.unavailable_depths).toEqual([1]);
    agree({ mode: "impact", grammar: "architecture", rings: [["api"], [], ["billing"]] });
  });

  it("on a sequence long enough to be compressed against the ceiling", () => {
    const sequence = Array.from({ length: 120 }, (_, i) => `edge-${String(i).padStart(3, "0")}`);
    agree({ mode: "reveal", grammar: "architecture", sequence });
    expect(browserPlan({ mode: "reveal", grammar: "architecture", sequence }).total_duration_ms)
      .toBeLessThanOrEqual(MAX_TOTAL_MOTION_MS);
  });

  it("on an empty sequence, where the honest plan is an empty one", () => {
    agree({ mode: "trace", grammar: "dependency_graph", sequence: [] });
  });

  it("under a reduced-motion preference", () => {
    agree({
      mode: "compare",
      grammar: "delta",
      sequence: ["chg-1", "chg-2"],
      reduced_motion: "reduce",
      destination_announcement: "2 changes.",
    });
  });

  it("under a non-default timing token set", () => {
    agree({
      mode: "step",
      grammar: "process",
      sequence: ["s1", "s2", "s3"],
      tokens: { short_ms: 90, standard_ms: 300, long_ms: 700 },
    });
  });

  it("defaults to the same timing tokens", () => {
    const plan = browserPlan({ mode: "reveal", grammar: "architecture", sequence: ["a"] });
    expect(plan.steps[0]?.duration_ms).toBe(DEFAULT_MOTION.standard_ms);
  });
});

describe("the browser ring helper agrees with the tested one", () => {
  const cases: Record<string, number>[] = [
    {},
    { api: 0 },
    { api: 0, billing: 1, shipping: 1, reporting: 2 },
    // Deliberately not in depth order, and not in id order: the incidental
    // order a traversal produced must not reach the rings.
    { reporting: 2, shipping: 1, api: 0, audit: 1, ledger: 3 },
  ];

  it("groups the same entities into the same rings", () => {
    for (const depthOf of cases) {
      expect(browserRings(depthOf), JSON.stringify(depthOf)).toEqual(motionRingsFromDepths(depthOf));
    }
  });

  it("puts the origin in ring zero, so the numbering means hops", () => {
    expect(browserRings({ api: 0, billing: 1 })[0]).toEqual(["api"]);
  });

  it("feeds an impact plan whose depths match the graph's", () => {
    const depthOf = { api: 0, billing: 1, shipping: 1, reporting: 2 };
    const plan = browserPlan({ mode: "impact", grammar: "architecture", rings: browserRings(depthOf) });
    expect(plan.steps.map((s) => s.target_ids)).toEqual([["api"], ["billing", "shipping"], ["reporting"]]);
    expect(plan.unavailable_depths).toEqual([]);
  });
});

describe("the invariants survive the crossing", () => {
  it("never produces a repeating sequence", () => {
    // §46. `iterations` is a literal `1` in TypeScript, which the browser copy
    // cannot inherit -- so it is asserted here instead of trusted.
    for (const mode of MOTION_INTENTS) {
      const plan = browserPlan({ mode, grammar: "architecture", sequence: ["a", "b"] });
      expect(plan.iterations, mode).toBe(1);
      expect(plan.interruptible, mode).toBe(true);
      expect(plan.skippable, mode).toBe(true);
      expect(plan.blocks_interaction, mode).toBe(false);
    }
  });

  it("always carries a reduced-motion fallback", () => {
    for (const mode of MOTION_INTENTS) {
      const plan = browserPlan({ mode, grammar: "architecture", sequence: ["a", "b"] });
      expect(plan.reduced_motion_fallback.behavior, mode).toBeTruthy();
    }
  });

  it("produces the same plan five times from shuffled impact rings", () => {
    // §62. Peers at one depth have no order of their own; two runs over one
    // graph must not disagree because a set iterated differently.
    const shuffles = [
      [["a"], ["c", "b", "d"]],
      [["a"], ["d", "c", "b"]],
      [["a"], ["b", "d", "c"]],
      [["a"], ["c", "d", "b"]],
      [["a"], ["d", "b", "c"]],
    ];
    const runs = shuffles.map((rings) =>
      JSON.stringify(browserPlan({ mode: "impact", grammar: "architecture", rings })),
    );
    expect(new Set(runs).size).toBe(1);
  });
});

describe("neither half of the motion layer can execute data", () => {
  // §58. The player maps a closed vocabulary onto one attribute; there is no
  // string in a plan that becomes code.
  const source = `${MOTION_ALGORITHMS}\n${MOTION_PLAYER}`;

  it("contains no dynamic evaluation, no network, and no markup construction", () => {
    for (const forbidden of [
      "eval(",
      "new Function",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "import(",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("sets exactly one attribute, to one value", () => {
    const sets = [...MOTION_PLAYER.matchAll(/setAttribute\("([^"]+)",\s*"([^"]+)"\)/g)];
    expect(sets.map((m) => [m[1], m[2]])).toEqual([["data-rvs-motion", "emphasis"]]);
  });

  it("declares no infinite or alternating animation", () => {
    for (const forbidden of ["infinite", "alternate", "setInterval", "requestAnimationFrame"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("touches no host object in the algorithms half", () => {
    for (const host of ["document", "window", "setTimeout", "matchMedia"]) {
      expect(MOTION_ALGORITHMS, host).not.toContain(host);
    }
  });
});
