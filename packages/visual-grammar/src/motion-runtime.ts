// The browser half of Milestone 10.5.5, authored as text.
//
// `buildMotionPlan` in @rvs/visual-intelligence turns an intent into a plan.
// That is where the semantics live and where they are tested. But a trace
// plan cannot be built when the file is written: it depends on the route the
// reader asks for, which the reader has not asked for yet. So the plan
// builder exists a second time, here, in the language the page runs.
//
// Two copies of one behaviour drift, and the copy that drifts is always the
// one nobody watches. `motion-parity.test.ts` runs this text in an isolated
// VM with no host objects in it and requires it to agree with the TypeScript
// builder, field for field, on every mode -- the same arrangement the
// explorer and change-review runtimes already use for their own algorithms.
//
// `MOTION_ALGORITHMS` is pure: no `document`, no `window`, no timers.
// `MOTION_PLAYER` is the half that touches the page, and it is deliberately
// small, because every interesting decision was already made in the plan.
//
// §43 forbids embedding arbitrary JS in a plan and the plan has nowhere to
// put any: a step names an effect from a closed vocabulary and a list of
// ids. The player maps the effect onto one attribute. There is no `eval`, no
// `new Function`, no string that becomes code.
//
// §50's invariants are enforced by the player rather than promised by it.
// Playback never disables a control, never moves focus, and never waits for
// anything: it is a chain of timeouts each of which checks whether the
// generation it belongs to is still current, so any new interaction -- a
// search, a lens change, a second route, a keypress -- abandons the sequence
// mid-flight by making its generation stale.

export const MOTION_ALGORITHMS = String.raw`
"use strict";

/* Mirrors EFFECT_BAND and effectFor in @rvs/visual-intelligence's motion.ts. */
function rvsMotionEffect(mode) {
  if (mode === "reveal") return "appear";
  if (mode === "trace") return "advance";
  if (mode === "step") return "settle";
  if (mode === "compare") return "contrast";
  if (mode === "impact") return "emphasize";
  return "emphasize";
}

function rvsMotionBand(effect) {
  if (effect === "appear") return "standard_ms";
  if (effect === "emphasize") return "short_ms";
  if (effect === "advance") return "short_ms";
  if (effect === "settle") return "standard_ms";
  return "long_ms";
}

var RVS_MAX_TOTAL_MOTION_MS = 4000;
var RVS_DEFAULT_MOTION = { short_ms: 140, standard_ms: 260, long_ms: 460 };

/* Mirrors motionRingsFromDepths in @rvs/visual-intelligence's motion.ts. */
function rvsMotionRingsFromDepths(depthOf) {
  var ids = Object.keys(depthOf);
  if (ids.length === 0) return [];
  var deepest = 0;
  var i;
  for (i = 0; i < ids.length; i++) {
    var value = depthOf[ids[i]];
    if (typeof value === "number" && value > deepest) deepest = value;
  }
  var rings = [];
  for (var depth = 0; depth <= deepest; depth++) {
    var ring = [];
    for (i = 0; i < ids.length; i++) {
      if (depthOf[ids[i]] === depth) ring.push(ids[i]);
    }
    rings.push(ring.sort());
  }
  return rings;
}

/**
 * Build a finite motion plan. The same function as buildMotionPlan, in the
 * language the page runs.
 *
 * input: { mode, grammar, sequence, rings, destination_announcement,
 *          reduced_motion, tokens }
 */
function rvsBuildMotionPlan(input) {
  var tokens = input.tokens || RVS_DEFAULT_MOTION;
  var reduce = (input.reduced_motion || "no-preference") === "reduce";
  var effect = rvsMotionEffect(input.mode);

  var groups = [];
  var unavailable = [];
  var i;

  if (input.mode === "impact" && input.rings) {
    for (i = 0; i < input.rings.length; i++) {
      /* Sorted, not preserved: peers at one depth have no order of their own,
         and letting collection order reach the plan would make two runs over
         the same graph disagree. */
      var members = input.rings[i].slice().sort();
      if (members.length === 0) unavailable.push(i);
      else groups.push(members);
    }
  } else if (input.mode !== "none") {
    var sequence = input.sequence || [];
    for (i = 0; i < sequence.length; i++) groups.push([sequence[i]]);
  }

  var base = tokens[rvsMotionBand(effect)];
  var uncompressed = base * groups.length;
  var scale = uncompressed > RVS_MAX_TOTAL_MOTION_MS && uncompressed > 0
    ? RVS_MAX_TOTAL_MOTION_MS / uncompressed
    : 1;
  var duration = Math.max(1, Math.round(base * scale));

  var steps = [];
  for (i = 0; i < groups.length; i++) {
    var step = {
      index: i,
      effect: effect,
      target_ids: groups[i],
      duration_ms: duration,
      depends_on: i === 0 ? [] : [i - 1]
    };
    if (i === groups.length - 1 && input.destination_announcement) {
      step.announcement = input.destination_announcement;
    }
    steps.push(step);
  }

  var seen = {};
  var targets = [];
  for (i = 0; i < groups.length; i++) {
    for (var j = 0; j < groups[i].length; j++) {
      var id = groups[i][j];
      if (!Object.prototype.hasOwnProperty.call(seen, id)) {
        seen[id] = true;
        targets.push(id);
      }
    }
  }
  targets.sort();

  var behavior = input.mode === "none"
    ? "unchanged"
    : (input.mode === "trace" || input.mode === "impact") ? "static" : "instant_state_change";

  var fallback = { behavior: behavior, applied_target_ids: targets };
  if (input.destination_announcement) fallback.announcement = input.destination_announcement;

  return {
    mode: input.mode,
    grammar: input.grammar,
    iterations: 1,
    interruptible: true,
    skippable: true,
    blocks_interaction: false,
    total_duration_ms: reduce ? 0 : steps.length * duration,
    steps: reduce ? [] : steps,
    target_ids: targets,
    reduced_motion_fallback: fallback,
    unavailable_depths: unavailable
  };
}
`;

/**
 * The player.
 *
 * `resolve(id)` maps a plan target id onto the elements that address it, and
 * `say(message)` is the host page's existing polite announcement channel.
 * Both are passed in rather than looked up, so the player adds no second way
 * to find an element and no second live region -- and so this half can be
 * exercised without a document.
 */
export const MOTION_PLAYER = String.raw`
/** Quotes an id for an attribute selector without ever building markup from it. */
function rvsMotionEscape(value) {
  try {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
  } catch (error) {
    /* fall through */
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

var rvsMotionGeneration = 0;
var rvsMotionTimers = [];

/**
 * Abandon whatever is playing.
 *
 * Every interaction calls this before doing its own work, which is what makes
 * §50's "interruptible" true rather than promised: a reader who searches,
 * switches lens, or picks a second route during a sequence has invalidated
 * it, and the timers still queued find their generation stale and do nothing.
 */
function rvsMotionStop() {
  rvsMotionGeneration += 1;
  for (var i = 0; i < rvsMotionTimers.length; i++) clearTimeout(rvsMotionTimers[i]);
  rvsMotionTimers = [];
  var marked = document.querySelectorAll("[data-rvs-motion]");
  for (var j = 0; j < marked.length; j++) marked[j].removeAttribute("data-rvs-motion");
}

function rvsMotionPrefersReduce() {
  try {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (error) {
    return false;
  }
}

/**
 * Play a plan.
 *
 * Returns immediately. Nothing here waits, disables a control, or moves
 * focus: the sequence is a chain of timeouts, each of which checks that the
 * generation it was scheduled under is still current before touching
 * anything.
 *
 * Under a reduced-motion preference the plan is not played faster -- it is
 * not played. The fallback's announcement is spoken and the static document
 * is left as it already was, which is the whole claim of §26: nothing here
 * was information.
 */
function rvsMotionPlay(plan, resolve, say) {
  rvsMotionStop();
  if (!plan || plan.mode === "none") return;

  var generation = rvsMotionGeneration;
  var announce = typeof say === "function" ? say : function () {};

  if (rvsMotionPrefersReduce() || plan.steps.length === 0) {
    if (plan.reduced_motion_fallback && plan.reduced_motion_fallback.announcement) {
      announce(plan.reduced_motion_fallback.announcement);
    }
    return;
  }

  var elapsed = 0;
  for (var i = 0; i < plan.steps.length; i++) {
    (function (step, at) {
      rvsMotionTimers.push(setTimeout(function () {
        if (generation !== rvsMotionGeneration) return;
        for (var t = 0; t < step.target_ids.length; t++) {
          var elements = resolve(step.target_ids[t]) || [];
          for (var e = 0; e < elements.length; e++) {
            /* One attribute, one closed vocabulary of values. The stylesheet
               owns what "emphasis" looks like; this owns only when. */
            elements[e].setAttribute("data-rvs-motion", "emphasis");
          }
        }
        if (step.announcement) announce(step.announcement);
      }, at));
    })(plan.steps[i], elapsed);
    elapsed += plan.steps[i].duration_ms;
  }

  rvsMotionTimers.push(setTimeout(function () {
    if (generation !== rvsMotionGeneration) return;
    var marked = document.querySelectorAll("[data-rvs-motion]");
    for (var k = 0; k < marked.length; k++) marked[k].removeAttribute("data-rvs-motion");
    rvsMotionTimers = [];
  }, elapsed + 40));
}
`;
