import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOTION,
  FORMAT_MOTION_COMPATIBILITY,
  MAX_TOTAL_MOTION_MS,
  MOTION_INTENTS,
  VISUAL_MOTION_CODES,
  buildMotionPlan,
  motionSupportsFormat,
  validateMotionPlan,
  type MotionPlan,
} from "../index.js";

const KNOWN = ["a", "b", "c", "d"];

const plan = (over: Parameters<typeof buildMotionPlan>[0]) => buildMotionPlan(over);

describe("the existing MotionIntent union is used as it stands", () => {
  it("is exactly the five modes plus none", () => {
    expect([...MOTION_INTENTS].sort()).toEqual(["compare", "impact", "none", "reveal", "step", "trace"]);
  });

  it("still refuses animation in formats that cannot animate", () => {
    expect(FORMAT_MOTION_COMPATIBILITY.document).toEqual(["none"]);
    expect(motionSupportsFormat("export", "reveal")).toBe(false);
  });
});

describe("proofs 19-23 -- one plan shape for all five modes", () => {
  for (const mode of ["reveal", "trace", "step", "compare"] as const) {
    it(`${mode} produces a strictly sequential, terminating plan`, () => {
      const built = plan({ mode, grammar: "architecture", sequence: ["a", "b", "c"] });
      expect(built.steps.map((s) => s.index)).toEqual([0, 1, 2]);
      expect(built.steps.map((s) => s.depends_on)).toEqual([[], [0], [1]]);
      expect(built.iterations).toBe(1);
      expect(Number.isFinite(built.total_duration_ms)).toBe(true);
      expect(validateMotionPlan({ plan: built, known_target_ids: KNOWN })).toEqual([]);
    });
  }

  it("impact animates the rings the graph produced and no others", () => {
    const built = plan({ mode: "impact", grammar: "architecture", rings: [["a"], ["b", "c"]] });
    expect(built.steps.map((s) => s.target_ids)).toEqual([["a"], ["b", "c"]]);
    expect(built.unavailable_depths).toEqual([]);
  });

  it("records an impact depth it could not populate rather than inventing an intermediate", () => {
    // The 10.4 limitation, carried forward honestly: depth can exceed the
    // intermediate entities actually available.
    const built = plan({ mode: "impact", grammar: "architecture", rings: [["a"], [], ["c"]] });
    expect(built.unavailable_depths).toEqual([1]);
    expect(built.steps.flatMap((s) => s.target_ids)).toEqual(["a", "c"]);
  });

  it("produces no motion at all for the none intent", () => {
    const built = plan({ mode: "none", grammar: "architecture", sequence: ["a", "b"] });
    expect(built.steps).toEqual([]);
    expect(built.total_duration_ms).toBe(0);
    expect(built.reduced_motion_fallback.behavior).toBe("unchanged");
  });

  it("does not choose a route -- given none, it traces nothing", () => {
    const built = plan({ mode: "trace", grammar: "architecture" });
    expect(built.steps).toEqual([]);
  });

  it("announces the destination once, at the end", () => {
    const built = plan({
      mode: "trace",
      grammar: "architecture",
      sequence: ["a", "b", "c"],
      destination_announcement: "Reached packages/core.",
    });
    expect(built.steps.filter((s) => s.announcement)).toHaveLength(1);
    expect(built.steps.at(-1)?.announcement).toBe("Reached packages/core.");
  });
});

describe("proof 25 -- the finite-motion invariant", () => {
  it("caps a long sequence rather than growing without bound", () => {
    const built = plan({ mode: "reveal", grammar: "architecture", sequence: Array.from({ length: 200 }, (_, i) => `n${i}`) });
    expect(built.total_duration_ms).toBeLessThanOrEqual(MAX_TOTAL_MOTION_MS);
    expect(built.steps).toHaveLength(200);
    expect(built.steps.every((s) => s.duration_ms > 0)).toBe(true);
  });

  it("leaves short sequences at their token duration", () => {
    const built = plan({ mode: "reveal", grammar: "architecture", sequence: ["a", "b"] });
    expect(built.steps[0]?.duration_ms).toBe(DEFAULT_MOTION.standard_ms);
  });

  it("carries interruptibility and non-blocking as invariants, not settings", () => {
    const built = plan({ mode: "reveal", grammar: "architecture", sequence: ["a"] });
    expect(built.interruptible).toBe(true);
    expect(built.skippable).toBe(true);
    expect(built.blocks_interaction).toBe(false);
  });

  it("holds no executable value anywhere", () => {
    const built = plan({ mode: "step", grammar: "architecture", sequence: ["a", "b"] });
    const walk = (value: unknown): void => {
      expect(typeof value).not.toBe("function");
      if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(built);
    expect(JSON.parse(JSON.stringify(built))).toEqual(built);
  });
});

describe("proof 18 -- reduced motion delivers the same information", () => {
  it("produces no steps but keeps every target in the fallback", () => {
    const built = plan({ mode: "reveal", grammar: "architecture", sequence: ["a", "b", "c"], reduced_motion: "reduce" });
    expect(built.steps).toEqual([]);
    expect(built.total_duration_ms).toBe(0);
    expect(built.reduced_motion_fallback.applied_target_ids).toEqual(["a", "b", "c"]);
  });

  it("lands the end state for modes that change it, and stays static for modes that do not", () => {
    const behaviour = (mode: "reveal" | "step" | "compare" | "trace" | "impact") =>
      plan({ mode, grammar: "architecture", sequence: ["a"], rings: [["a"]] }).reduced_motion_fallback.behavior;
    expect(behaviour("reveal")).toBe("instant_state_change");
    expect(behaviour("step")).toBe("instant_state_change");
    expect(behaviour("compare")).toBe("instant_state_change");
    expect(behaviour("trace")).toBe("static");
    expect(behaviour("impact")).toBe("static");
  });
});

describe("every VISUAL_MOTION_ code is reachable", () => {
  const base = plan({ mode: "reveal", grammar: "architecture", sequence: ["a", "b"] });

  it("VISUAL_MOTION_UNKNOWN_TARGET", () => {
    const found = validateMotionPlan({ plan: base, known_target_ids: ["a"] });
    expect(found.map((f) => f.code)).toContain("VISUAL_MOTION_UNKNOWN_TARGET");
  });

  it("VISUAL_MOTION_INFORMATION_DEPENDENT", () => {
    const found = validateMotionPlan({ plan: base, known_target_ids: KNOWN, static_target_ids: ["a"] });
    const entry = found.find((f) => f.code === "VISUAL_MOTION_INFORMATION_DEPENDENT");
    expect(entry?.subject_id).toBe("b");
    expect(entry?.blocking).toBe(true);
  });

  it("is quiet when the static document already contains everything the motion touches", () => {
    expect(validateMotionPlan({ plan: base, known_target_ids: KNOWN, static_target_ids: KNOWN })).toEqual([]);
  });

  it("VISUAL_MOTION_INFINITE", () => {
    const forever: MotionPlan = { ...base, iterations: Number.POSITIVE_INFINITY as unknown as 1 };
    expect(validateMotionPlan({ plan: forever, known_target_ids: KNOWN }).map((f) => f.code)).toContain(
      "VISUAL_MOTION_INFINITE",
    );
    const zero: MotionPlan = { ...base, steps: base.steps.map((s) => ({ ...s, duration_ms: 0 })) };
    expect(validateMotionPlan({ plan: zero, known_target_ids: KNOWN }).map((f) => f.code)).toContain(
      "VISUAL_MOTION_INFINITE",
    );
  });

  it("VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE", () => {
    const forward: MotionPlan = { ...base, steps: [{ ...base.steps[0]!, depends_on: [1] }, base.steps[1]!] };
    expect(validateMotionPlan({ plan: forward, known_target_ids: KNOWN }).map((f) => f.code)).toContain(
      "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE",
    );
    const gapped: MotionPlan = { ...base, steps: [{ ...base.steps[1]!, index: 3, depends_on: [] }] };
    expect(validateMotionPlan({ plan: gapped, known_target_ids: KNOWN }).map((f) => f.code)).toContain(
      "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE",
    );
  });

  it("VISUAL_MOTION_REDUCED_FALLBACK_MISSING", () => {
    const stripped: MotionPlan = {
      ...base,
      reduced_motion_fallback: { ...base.reduced_motion_fallback, applied_target_ids: [] },
    };
    expect(validateMotionPlan({ plan: stripped, known_target_ids: KNOWN }).map((f) => f.code)).toContain(
      "VISUAL_MOTION_REDUCED_FALLBACK_MISSING",
    );
  });

  it("declares no code it cannot raise", () => {
    const raised = new Set<string>();
    const cases: MotionPlan[] = [
      base,
      { ...base, iterations: 2 as unknown as 1 },
      { ...base, steps: [{ ...base.steps[0]!, depends_on: [5] }] },
      { ...base, reduced_motion_fallback: { ...base.reduced_motion_fallback, applied_target_ids: [] } },
    ];
    for (const candidate of cases) {
      for (const finding of validateMotionPlan({ plan: candidate, known_target_ids: [], static_target_ids: [] })) {
        raised.add(finding.code);
      }
    }
    expect([...raised].sort()).toEqual([...VISUAL_MOTION_CODES].sort());
  });
});

describe("proof 28 basis -- plans are byte-identical across runs", () => {
  it("does not vary with the order targets were supplied in", () => {
    const runs = [1, 2, 3, 4, 5].map(() =>
      JSON.stringify(plan({ mode: "impact", grammar: "architecture", rings: [["b", "a"], ["d", "c"]] })),
    );
    expect(new Set(runs).size).toBe(1);
  });
});
