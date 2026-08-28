import { VISUAL_REPAIR_ACTIONS, type RepairAction } from "./contracts.js";

// What kind of correction could satisfy each invariant.
//
// These are categories, not instructions. "Increase spacing" does not name a
// token, a file or a number, because the validator that raised the finding
// knows the rule and not the fix -- and a receipt that pretended otherwise
// would be handing a person a change to make on this layer's authority rather
// than the owning validator's.
//
// Two entries deserve their reasoning stated. `RENDERED_COLOR_ONLY_STATE`
// maps to `add-non-color-state-cue` because the invariant it protects is
// specifically visual: a sighted reader who cannot distinguish hue has lost a
// state that colour alone was carrying, and an accessible *name* (screen
// reader text) does nothing for them -- they can see the shape, just not the
// colour. The fix is a visible marker, badge, dash pattern or glyph, not a
// naming property. And an overflowing view lists five repairs rather than
// one, because an overflow is a statement about a whole layout: routing,
// label placement, spacing, splitting and detail all genuinely resolve it,
// and the person looking at the drawing is better placed than this table to
// say which.
//
// Some codes map to nothing. That is deliberate: a non-deterministic tab order
// or an infinite animation is a defect whose correction has no category in the
// eleven this layer publishes, and offering a wrong one would be worse than
// offering none. The finding's message carries the invariant in those cases.
//
// `VISUAL_A11Y_NAME_MISSING`, `VISUAL_A11Y_COLOR_ONLY_STATE`,
// `VISUAL_A11Y_FOCUS_NOT_VISIBLE` and `VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC`
// (`@rvs/visual-intelligence`'s `validateAccessibilitySpecs`) carry no entry
// here. That validator has no caller anywhere this layer's delivery path
// reaches -- `validation-profile.ts` explains why -- so none of its codes can
// appear in a real receipt today. A mapping for a code nothing emits is not a
// convenience, it is a claim about a check that never runs; removing it keeps
// this table describing only what the delivery path actually asks.

export const REPAIRS_BY_CODE: Readonly<Record<string, readonly RepairAction[]>> = {
  // --- structure and fidelity (@rvs/visual-intelligence) --------------------
  VISUAL_FIDELITY_ENTITY_LOST: ["restore-anchor", "reduce-detail", "split-view"],
  VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST: ["restore-anchor", "reduce-detail"],
  VISUAL_FIDELITY_CRITICAL_PATH_LOST: ["restore-anchor", "reroute", "split-view"],
  VISUAL_FIDELITY_RECEIPT_INVALID: ["restore-anchor"],
  VISUAL_INTENT_UNSUPPORTED: [],
  VISUAL_GRAMMAR_UNSUPPORTED: [],
  VISUAL_GRAMMAR_INTENT_MISMATCH: [],
  VISUAL_DETAIL_MODE_INVALID: ["reduce-detail"],
  VISUAL_MOTION_INTENT_INVALID: [],
  VISUAL_NONDETERMINISTIC_SELECTION: [],

  // --- reference integrity (@rvs/visual-composition, @rvs/visual-change-review)
  VISUAL_COVERAGE_ENTITY_UNACCOUNTED: ["restore-anchor", "resolve-reference"],
  CHANGE_REVIEW_BASELINE_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_TARGET_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS: ["resolve-reference"],
  CHANGE_REVIEW_DANGLING_CHANGE: ["resolve-reference"],
  CHANGE_REVIEW_BEFORE_ENTITY_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_AFTER_ENTITY_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE: [],
  CHANGE_REVIEW_FIDELITY_LOSS: ["reduce-detail", "split-view"],
  CHANGE_REVIEW_REAL_ANCHOR_LOST: ["restore-anchor"],
  CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_DECISION_REFERENCE_MISSING: ["resolve-reference"],
  CHANGE_REVIEW_NONDETERMINISTIC_ORDER: [],

  // --- accessibility (@rvs/visual-intelligence) ----------------------------
  VISUAL_A11Y_CONTRAST_INSUFFICIENT: ["fix-contrast"],
  VISUAL_A11Y_TEXT_TOO_SMALL: ["increase-font-size", "reduce-detail"],

  // --- motion (@rvs/visual-intelligence) -----------------------------------
  VISUAL_MOTION_UNKNOWN_TARGET: ["resolve-reference"],
  VISUAL_MOTION_INFORMATION_DEPENDENT: ["reduce-detail"],
  VISUAL_MOTION_NONDETERMINISTIC_SEQUENCE: [],
  VISUAL_MOTION_INFINITE: [],
  VISUAL_MOTION_REDUCED_FALLBACK_MISSING: [],

  // --- rendered scene checks (@rvs/validator) ------------------------------
  "rendered:overflow": ["increase-spacing", "move-label", "reroute", "split-view", "reduce-detail"],
  "rendered:node-overlap": ["increase-spacing", "move-label", "reroute", "split-view"],
  "rendered:min-font-size": ["increase-font-size", "reduce-detail"],
  "rendered:contrast": ["fix-contrast"],
  "rendered:missing-evidence": ["resolve-reference"],

  // --- rendered interaction checks (@rvs/validator) ------------------------
  RENDERED_DUPLICATE_ELEMENT_ID: ["resolve-reference"],
  RENDERED_LABELLEDBY_UNRESOLVED: ["resolve-reference"],
  RENDERED_CONTROL_UNNAMED: ["add-accessible-name"],
  RENDERED_CONTROL_UNREACHABLE: [],
  RENDERED_REDUCED_MOTION_MISSING: [],

  // --- rendered color independence (@rvs/validator) ------------------------
  // See the reasoning stated at the top of this file: this is a visual
  // redundancy defect, not a naming defect, so it maps to the visual-cue
  // category rather than to `add-accessible-name`.
  RENDERED_COLOR_ONLY_STATE: ["add-non-color-state-cue"],

  // --- infrastructure ------------------------------------------------------
  VISUAL_VERIFICATION_BROWSER_UNAVAILABLE: ["install-browser-runtime"],
  VISUAL_VERIFICATION_TIMEOUT: ["retry-verification"],
};

export function repairsFor(code: string): RepairAction[] {
  return [...(REPAIRS_BY_CODE[code] ?? [])];
}

/** Every one of the eleven visual repair categories that some code can actually produce. */
export function reachableVisualRepairs(): string[] {
  const reachable = new Set<string>();
  for (const actions of Object.values(REPAIRS_BY_CODE)) {
    for (const action of actions) {
      if ((VISUAL_REPAIR_ACTIONS as readonly string[]).includes(action)) reachable.add(action);
    }
  }
  return [...reachable].sort();
}
