// Milestone 10.5.5 -- semantic finite motion.
//
// `MotionIntent` already existed and already said the right things: none,
// reveal, trace, step, compare, impact. §40 asks for the actual current union
// to be verified rather than assumed, and it is exactly those six -- so this
// module extends nothing. It adds the missing half: turning an intent into a
// PLAN, which is data a renderer executes rather than behaviour a renderer
// invents.
//
// Three properties are structural here rather than advisory:
//
//   Finite.      `iterations` is the literal type `1`. There is no value a
//                caller can put there that means "forever", so the §46
//                prohibition on infinite, alternating, pulsing, and glowing
//                motion is not a rule anyone has to remember.
//   Inert.       A step names an effect from a closed vocabulary. §43 forbids
//                embedding arbitrary JS functions in a plan, and the way to
//                honour that is for the plan to have nowhere to put one.
//   Uninformative. Motion may only emphasise what the static document already
//                says. A reader with `prefers-reduced-motion`, a printed page,
//                and a screen reader all get the same facts; motion changes
//                the order they arrive in, never the set.
//
// The last one is the one worth stating plainly: if turning off animation
// loses information, the animation was carrying information, and the diagram
// was incomplete without it.

import type { MotionIntent, VisualGrammar } from "./contracts.js";
import type { VisualMotionTokens } from "./design-tokens.js";
import { DEFAULT_MOTION } from "./design-tokens.js";
import type { ReducedMotionBehavior } from "./accessibility.js";
import { buildFinding, sortFindings, type VisualFinding } from "./findings.js";

export type ReducedMotionPreference = "no-preference" | "reduce";

/**
 * What a step does, as a meaning rather than a CSS property.
 *
 * A renderer maps these onto opacity, stroke-dashoffset, or whatever its
 * medium offers. The plan does not know or care, which is what keeps the same
 * plan valid for SVG, for a slide, and for the change-review viewer.
 */
export type MotionEffect =
  | "appear"
  | "emphasize"
  | "advance"
  | "settle"
  | "contrast";

/** Which timing band an effect draws from. §45's centralised timing. */
const EFFECT_BAND: Readonly<Record<MotionEffect, keyof VisualMotionTokens>> = {
  appear: "standard_ms",
  emphasize: "short_ms",
  advance: "short_ms",
  settle: "standard_ms",
  contrast: "long_ms",
};

/**
 * A single, terminating unit of motion.
 *
 * `depends_on` holds step indices, not references, so a plan serialises to
 * JSON and compares byte-for-byte across runs -- which is what §62 checks.
 */
export interface MotionStep {
  index: number;
  effect: MotionEffect;
  target_ids: string[];
  duration_ms: number;
  depends_on: number[];
  /** Spoken when the step completes. Absent means the step says nothing new. */
  announcement?: string;
}

/**
 * What happens instead when the reader has asked for less motion.
 *
 * §49 requires a fallback to exist for every plan. It is not "play it faster":
 * `static` shows the finished state with no transition, and
 * `instant_state_change` applies each step's end state at once.
 */
export interface ReducedMotionFallback {
  behavior: ReducedMotionBehavior;
  /** Every entity the full sequence would have touched, applied immediately. */
  applied_target_ids: string[];
  announcement?: string;
}

/**
 * A complete, finite, executable-by-data motion sequence.
 *
 * `iterations`, `interruptible`, `skippable`, and `blocks_interaction` are
 * literal types on purpose. They are invariants, not settings, and a type that
 * admits only one value cannot be configured into violating them.
 */
export interface MotionPlan {
  mode: MotionIntent;
  grammar: VisualGrammar;
  iterations: 1;
  interruptible: true;
  skippable: true;
  blocks_interaction: false;
  total_duration_ms: number;
  steps: MotionStep[];
  target_ids: string[];
  reduced_motion_fallback: ReducedMotionFallback;
  /**
   * Impact depths the upstream graph could not populate. Recorded rather than
   * filled: 10.4 found that impact depth can exceed the intermediate entities
   * actually available, and §48 forbids inventing the missing ones.
   */
  unavailable_depths: number[];
}

/**
 * The ceiling on any single sequence.
 *
 * A 200-node reveal at 260ms a node is fifty-two seconds of a reader waiting
 * to be allowed to read. Long sequences compress proportionally instead: the
 * order and the dependency structure survive, the wall-clock does not grow
 * without bound. Compression is uniform so the plan stays deterministic.
 */
export const MAX_TOTAL_MOTION_MS = 4000;

export type VisualMotionCode =
  | "VISUAL_MOTION_UNKNOWN_TARGET"
  | "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE"
  | "VISUAL_MOTION_INFINITE"
  | "VISUAL_MOTION_INFORMATION_DEPENDENT"
  | "VISUAL_MOTION_REDUCED_FALLBACK_MISSING";

export const VISUAL_MOTION_CODES: readonly VisualMotionCode[] = [
  "VISUAL_MOTION_INFINITE",
  "VISUAL_MOTION_INFORMATION_DEPENDENT",
  "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE",
  "VISUAL_MOTION_REDUCED_FALLBACK_MISSING",
  "VISUAL_MOTION_UNKNOWN_TARGET",
] as const;

export type VisualMotionFinding = VisualFinding<VisualMotionCode>;

/**
 * What the caller knows that the motion layer must not decide for itself.
 *
 * `sequence` is the crucial one. §47 says the motion layer does not choose the
 * route -- the Knowledge Graph does -- so a trace plan is built from an
 * ordered list handed in from outside. If nobody hands one in, there is no
 * trace, and the honest plan is an empty one.
 */
export interface MotionPlanInput {
  mode: MotionIntent;
  grammar: VisualGrammar;
  /** Ordered entity or edge ids. For `impact`, use `rings` instead. */
  sequence?: readonly string[];
  /** Impact rings by depth, already resolved upstream. */
  rings?: readonly (readonly string[])[];
  /** Spoken when the whole sequence ends. */
  destination_announcement?: string;
  reduced_motion?: ReducedMotionPreference;
  tokens?: VisualMotionTokens;
}

function effectFor(mode: MotionIntent): MotionEffect {
  switch (mode) {
    case "reveal":
      return "appear";
    case "trace":
      return "advance";
    case "step":
      return "settle";
    case "compare":
      return "contrast";
    case "impact":
      return "emphasize";
    default:
      return "emphasize";
  }
}

/**
 * Build the plan.
 *
 * Every mode produces a strictly sequential chain: step N depends on step
 * N-1. Motion that branches is motion whose finishing order depends on how
 * fast each branch happens to run, and §44 wants a sequence a reviewer can
 * predict from the plan alone.
 */
export function buildMotionPlan(input: MotionPlanInput): MotionPlan {
  const tokens = input.tokens ?? DEFAULT_MOTION;
  const reduce = (input.reduced_motion ?? "no-preference") === "reduce";
  const effect = effectFor(input.mode);

  const groups: string[][] = [];
  const unavailable: number[] = [];

  if (input.mode === "impact" && input.rings) {
    input.rings.forEach((ring, depth) => {
      // Sorted, not preserved. Entities at the same impact depth are peers --
      // the graph established that they are all N hops out, not that one of
      // them comes first -- so whatever order the caller happened to collect
      // them in is incidental, and letting it reach the plan would make the
      // plan differ between two runs over the same graph. Route sequences are
      // unaffected: each of those is a one-member group, so sorting inside a
      // group cannot reorder a route.
      const members = [...ring].sort();
      if (members.length === 0) {
        // The graph reported a depth it could not populate. Skipping it keeps
        // the ring numbering honest; fabricating a placeholder would draw a
        // propagation step nobody established.
        unavailable.push(depth);
        return;
      }
      groups.push(members);
    });
  } else if (input.mode !== "none") {
    for (const id of input.sequence ?? []) groups.push([id]);
  }

  const base = tokens[EFFECT_BAND[effect]];
  const uncompressed = base * groups.length;
  const scale = uncompressed > MAX_TOTAL_MOTION_MS && uncompressed > 0 ? MAX_TOTAL_MOTION_MS / uncompressed : 1;
  const duration = Math.max(1, Math.round(base * scale));

  const steps: MotionStep[] = groups.map((target_ids, index) => ({
    index,
    effect,
    target_ids,
    duration_ms: duration,
    depends_on: index === 0 ? [] : [index - 1],
    ...(index === groups.length - 1 && input.destination_announcement
      ? { announcement: input.destination_announcement }
      : {}),
  }));

  const target_ids = [...new Set(groups.flat())].sort();

  return {
    mode: input.mode,
    grammar: input.grammar,
    iterations: 1,
    interruptible: true,
    skippable: true,
    blocks_interaction: false,
    total_duration_ms: reduce ? 0 : steps.length * duration,
    steps: reduce ? [] : steps,
    target_ids,
    reduced_motion_fallback: {
      // Which fallback is right depends on the mode, not on whether reduced
      // motion happened to be requested at build time. `reveal`, `step`, and
      // `compare` leave the view in a different state than they found it, so
      // that state has to land instantly. `trace` and `impact` are emphasis
      // that returns to where it started, so there is nothing to land and the
      // static view is already correct.
      behavior:
        input.mode === "none"
          ? "unchanged"
          : input.mode === "trace" || input.mode === "impact"
            ? "static"
            : "instant_state_change",
      applied_target_ids: target_ids,
      ...(input.destination_announcement ? { announcement: input.destination_announcement } : {}),
    },
    unavailable_depths: unavailable,
  };
}

/**
 * Impact rings from a breadth-first depth map.
 *
 * The graph already establishes how far each entity sits from the origin;
 * `impact` motion wants the same fact grouped by depth. Doing the grouping
 * here rather than at each call site is what stops two callers from
 * disagreeing about whether the origin is ring 0 or ring 1 -- and §48 turns
 * on that numbering being honest, since an empty ring is recorded as
 * unavailable rather than filled in.
 *
 * Members are sorted within a ring for the same reason `buildMotionPlan`
 * sorts them: peers at one depth have no order of their own, so whatever
 * order a traversal happened to visit them in must not reach the plan.
 */
export function motionRingsFromDepths(depthOf: Readonly<Record<string, number>>): string[][] {
  const ids = Object.keys(depthOf);
  if (ids.length === 0) return [];
  const deepest = ids.reduce((max, id) => Math.max(max, depthOf[id] ?? 0), 0);
  const rings: string[][] = [];
  for (let depth = 0; depth <= deepest; depth += 1) {
    rings.push(ids.filter((id) => depthOf[id] === depth).sort());
  }
  return rings;
}

export interface ValidateMotionInput {
  plan: MotionPlan;
  /** Every id the renderer can actually address. */
  known_target_ids: readonly string[];
  /**
   * Ids present in the document without any motion at all.
   *
   * A target outside this set is one the reader only learns about by watching,
   * which §26 forbids.
   */
  static_target_ids?: readonly string[];
}

/**
 * Check a plan against the four things that make motion untrustworthy.
 *
 * Every code below is raised by a branch reachable from an input a caller can
 * construct; §66 audits that claim across all of 10.1-10.5.
 */
export function validateMotionPlan(input: ValidateMotionInput): VisualMotionFinding[] {
  const { plan } = input;
  const findings: VisualMotionFinding[] = [];
  const subject = `${plan.grammar}:${plan.mode}`;
  const known = new Set(input.known_target_ids);

  for (const id of plan.target_ids) {
    if (!known.has(id)) {
      findings.push(
        buildFinding(
          "VISUAL_MOTION_UNKNOWN_TARGET",
          id,
          `Motion plan for ${subject} animates "${id}", which is not an entity the renderer can address. A step aimed at nothing is a step the reader waits through for no reason.`,
          true,
        ),
      );
    }
  }

  if (input.static_target_ids) {
    const staticIds = new Set(input.static_target_ids);
    for (const id of plan.target_ids) {
      if (!staticIds.has(id)) {
        findings.push(
          buildFinding(
            "VISUAL_MOTION_INFORMATION_DEPENDENT",
            id,
            `"${id}" appears in the ${subject} motion sequence but not in the static document. Anyone reading with reduced motion, on paper, or with a screen reader would never learn it exists.`,
            true,
          ),
        );
      }
    }
  }

  if ((plan.iterations as number) !== 1 || !Number.isFinite(plan.total_duration_ms) || plan.total_duration_ms < 0) {
    findings.push(
      buildFinding(
        "VISUAL_MOTION_INFINITE",
        subject,
        `Motion plan for ${subject} does not terminate. Continuous motion competes with reading for attention and never stops competing.`,
        true,
      ),
    );
  }

  for (const step of plan.steps) {
    if (!Number.isFinite(step.duration_ms) || step.duration_ms <= 0) {
      findings.push(
        buildFinding(
          "VISUAL_MOTION_INFINITE",
          `${subject}#${step.index}`,
          `Step ${step.index} of ${subject} has no finite positive duration.`,
          true,
        ),
      );
    }
    for (const dependency of step.depends_on) {
      if (dependency >= step.index || dependency < 0) {
        findings.push(
          buildFinding(
            "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE",
            `${subject}#${step.index}`,
            `Step ${step.index} of ${subject} depends on step ${dependency}, so the order it runs in is not fixed by the plan.`,
            true,
          ),
        );
      }
    }
  }

  const indices = plan.steps.map((step) => step.index);
  if (indices.some((index, position) => index !== position)) {
    findings.push(
      buildFinding(
        "VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE",
        subject,
        `Step indices for ${subject} are not consecutive from zero, so two runs can order them differently.`,
        true,
      ),
    );
  }

  if (plan.mode !== "none" && plan.steps.length > 0 && plan.reduced_motion_fallback.applied_target_ids.length === 0) {
    findings.push(
      buildFinding(
        "VISUAL_MOTION_REDUCED_FALLBACK_MISSING",
        subject,
        `Motion plan for ${subject} animates ${plan.steps.length} step(s) but its reduced-motion fallback applies nothing, so a reader who asked for less motion gets less information.`,
        true,
      ),
    );
  }

  return sortFindings(findings);
}
