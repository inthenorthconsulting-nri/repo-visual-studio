import { MINIMUM_TEXT_SIZE_PX } from "@rvs/visual-intelligence";
import type { ValidatorFamily, VerificationProfileIdentity } from "./contracts.js";
import { digestOf } from "./ids.js";

// Verification profiles.
//
// A profile is a named, versioned, closed set of validator families plus the
// configuration they run under. Closed is the important word: a caller picks a
// profile by name and cannot supply validator code, a rule expression, or a
// threshold of their own. A gate whose strictness the thing being gated can
// choose is not a gate.
//
// The version is part of the identity, and changing what a profile checks
// means minting the next version rather than editing this one. A verified
// artifact records the profile id it passed, so "verified" always answers
// "verified against what".

export interface ProfileConfig {
  /** The legible floor, taken from @rvs/visual-intelligence rather than restated. */
  minimum_font_size_px: number;
  contrast_level: "AA" | "AAA";
  /** Which polarities of the dual-polarity stylesheet are measured. */
  color_schemes: ("light" | "dark")[];
  /** The fit scale the type check is evaluated at. 1 means "as declared". */
  render_scale: number;
}

export interface VerificationProfile {
  id: string;
  name: string;
  version: string;
  description: string;
  families: ValidatorFamily[];
  /**
   * True when at least one required family can only be answered by a real
   * browser. A profile that requires the browser and cannot get one reports
   * `incomplete`; it never quietly runs the subset it can.
   */
  requires_browser: boolean;
  /**
   * Whether a non-blocking finding still passes.
   *
   * Every profile here allows warnings, because the validators this layer
   * orchestrates already decided which of their findings block. Turning a
   * warning into a rejection at this level would be the delivery gate
   * disagreeing with the validator that owns the rule.
   */
  allow_warnings: boolean;
  config: ProfileConfig;
}

/**
 * The versions the verification digest is computed over.
 *
 * These are the *semantic* versions of each check as this layer orchestrates
 * it, not the package versions -- every workspace package reads 0.1.0, which
 * would make the digest blind to exactly the change it exists to notice.
 * Bumping an entry here is the deliberate act that invalidates every
 * verification made under the old behaviour, which is what turns those
 * verifications into `stale` rather than silently leaving them current.
 */
export const VALIDATOR_VERSIONS: Readonly<Record<string, string>> = {
  "@rvs/visual-intelligence:validateVisualCommunicationSpec": "1",
  "@rvs/visual-intelligence:validateTokenContrast": "1",
  "@rvs/visual-intelligence:validateTypeScale": "1",
  "@rvs/visual-intelligence:validateMotionPlan": "1",
  "@rvs/visual-composition:entityCoverage": "1",
  "@rvs/visual-change-review:validateChangeReview": "1",
  "@rvs/validator:validateHtmlFile": "1",
  "@rvs/validator:validateInteractionHtmlFile": "1",
  "@rvs/validator:validateColorIndependenceHtmlFile": "1",
};

// `validateColorIndependence` and `validateAccessibilitySpecs` are
// deliberately absent from both maps below -- see `runAccessibilityFamily`
// in `verification.ts` for why (Milestone 10 closure remediation, B2):
// neither validator was reachable from this module's only caller, and each
// was traced to an authoritative replacement that already runs against real
// production data. Removing them here, rather than wiring fabricated input
// to make them run, is what stops the "accessibility" family's reported
// validator set from naming two checks that had never once executed.
//
// `@rvs/validator:validateColorIndependenceHtmlFile`, added below, is not a
// reinstatement of `validateColorIndependence` under a new name. The retired
// function checked a state's *presentation* -- `resolveVisualState`'s output,
// a pure function of the closed state vocabulary -- which is already proven
// exhaustively by `visual-state.test.ts` on every test run. This validator
// checks the *rendered artifact*: whether the marker, badge or dashed stroke
// that presentation asked for actually reached a real browser's DOM. Same
// invariant, a layer further downstream, where a rendering regression (the
// kind B1 was) is the only thing that could break it.

/** Which module answers each family, and therefore which version the digest carries. */
export const FAMILY_VALIDATORS: Readonly<Record<ValidatorFamily, readonly string[]>> = {
  schema: ["@rvs/visual-intelligence:validateVisualCommunicationSpec"],
  fidelity: ["@rvs/visual-intelligence:validateVisualCommunicationSpec"],
  reference: ["@rvs/visual-composition:entityCoverage", "@rvs/visual-change-review:validateChangeReview"],
  layout: ["@rvs/validator:validateHtmlFile"],
  typography: ["@rvs/visual-intelligence:validateTypeScale", "@rvs/validator:validateHtmlFile"],
  contrast: ["@rvs/visual-intelligence:validateTokenContrast", "@rvs/validator:validateHtmlFile"],
  accessibility: [
    "@rvs/visual-intelligence:validateTokenContrast",
    "@rvs/visual-intelligence:validateTypeScale",
    "@rvs/validator:validateHtmlFile",
    "@rvs/validator:validateColorIndependenceHtmlFile",
  ],
  interaction: ["@rvs/validator:validateInteractionHtmlFile"],
  motion: ["@rvs/visual-intelligence:validateMotionPlan"],
};

/** Families that cannot be answered without starting a browser. */
export const BROWSER_FAMILIES: ReadonlySet<ValidatorFamily> = new Set<ValidatorFamily>([
  "layout",
  "interaction",
]);

const BASE_CONFIG: ProfileConfig = {
  minimum_font_size_px: MINIMUM_TEXT_SIZE_PX,
  contrast_level: "AA",
  color_schemes: ["light", "dark"],
  render_scale: 1,
};

function profile(
  name: string,
  version: string,
  description: string,
  families: ValidatorFamily[],
  config: ProfileConfig = BASE_CONFIG,
): VerificationProfile {
  return {
    id: `visual-${name}-${version}`,
    name,
    version,
    description,
    families,
    requires_browser: families.some((family) => BROWSER_FAMILIES.has(family)),
    allow_warnings: true,
    config,
  };
}

/**
 * The four current profiles.
 *
 * `standard` exists so a machine with no browser can still verify everything a
 * browser is not needed for, and say plainly that it did not verify the rest.
 * `interactive` and `change-review` differ in identity rather than in family
 * list: a change review carries governance and decision overlays and a
 * comparison motion mode, and a reader looking at a verified record needs to
 * know which surface it was measured on. `print` drops interaction and motion,
 * which do not exist on a page nobody can click.
 *
 * `interactive` and `change-review` are at `v2`, not `v1`. Milestone 10
 * closure added `@rvs/validator:validateColorIndependenceHtmlFile` to the
 * `accessibility` family both require -- a materially different, blocking set
 * of checks than `v1` ever claimed to run, per this file's own rule above.
 * `standard` and `print` do not require the `layout`/`interaction` browser
 * families' sibling browser check and were not touched by that change, so
 * they stay at `v1`.
 *
 * `visual-interactive-v1` and `visual-change-review-v1` are deliberately
 * absent from this array now, not merely renamed. `FAMILY_VALIDATORS` and
 * `VALIDATOR_VERSIONS` above are shared, unversioned wiring -- there is no
 * per-profile-version validator table, and building one is exactly the "large
 * migration framework" this closure was told not to build. That means there
 * is no way to keep a `v1` profile object *selectable* here that would
 * actually still run `v1`'s behaviour: asking for it today would silently run
 * today's wiring under yesterday's label, which is the identity lie this
 * whole reconciliation exists to close. Removing it is the honest choice.
 *
 * This does not touch history. A `VerifiedVisualArtifact` already on disk
 * with `profile_id: "visual-interactive-v1"` is a plain string field --
 * `readVerifiedHistory` parses it, `verificationIsStale` compares it, and
 * `receipts.ts` prints it, none of which call `findProfile`. That record
 * stays exactly as truthful as it always was: it says what it passed, and it
 * is correctly read as stale against `v2`. What it cannot do, and never
 * needed to, is be re-selected as a live verification target.
 */
export const VERIFICATION_PROFILES: readonly VerificationProfile[] = [
  profile(
    "standard",
    "v1",
    "Structure, fidelity and reference integrity, plus the token-level accessibility checks. No browser required.",
    ["schema", "fidelity", "reference", "accessibility"],
  ),
  profile(
    "interactive",
    "v2",
    "The standard families plus rendered layout, rendered accessibility (including rendered colour independence), keyboard interaction and motion. Requires a browser.",
    ["schema", "fidelity", "reference", "layout", "accessibility", "interaction", "motion"],
  ),
  profile(
    "change-review",
    "v2",
    "The interactive families, for a before/delta/after review: the same checks, including rendered colour independence, recorded against the review surface.",
    ["schema", "fidelity", "reference", "layout", "accessibility", "interaction", "motion"],
  ),
  profile(
    "print",
    "v1",
    "Structure, fidelity, reference, rendered layout, typography and contrast. No interaction and no motion.",
    ["schema", "fidelity", "reference", "layout", "typography", "contrast"],
  ),
];

export const DEFAULT_PROFILE_IDS = {
  architecture_explorer: "visual-interactive-v2",
  change_review: "visual-change-review-v2",
} as const;

export function profileIds(): string[] {
  return VERIFICATION_PROFILES.map((p) => p.id);
}

export function findProfile(id: string): VerificationProfile | undefined {
  return VERIFICATION_PROFILES.find((p) => p.id === id);
}

export function requireProfile(id: string): VerificationProfile {
  const found = findProfile(id);
  if (found === undefined) {
    throw new Error(`Unknown verification profile "${id}". Expected one of: ${profileIds().join(", ")}.`);
  }
  return found;
}

/**
 * A digest over the thresholds a profile actually ran with.
 *
 * Part of the verification digest, so lowering the minimum font size or
 * dropping the dark polarity changes the identity of every verification made
 * afterwards. Without this a configuration change would leave old
 * verifications looking current while describing rules nobody applies.
 */
export function profileConfigDigest(profile_: VerificationProfile): string {
  return digestOf({
    config: profile_.config,
    families: [...profile_.families].sort(),
    allow_warnings: profile_.allow_warnings,
    requires_browser: profile_.requires_browser,
    validators: Object.fromEntries(
      [...new Set(profile_.families.flatMap((family) => FAMILY_VALIDATORS[family]))]
        .sort()
        .map((name) => [name, VALIDATOR_VERSIONS[name] ?? "unknown"]),
    ),
  });
}

export function profileIdentity(profile_: VerificationProfile): VerificationProfileIdentity {
  return {
    id: profile_.id,
    name: profile_.name,
    version: profile_.version,
    families: [...profile_.families],
    requires_browser: profile_.requires_browser,
    allow_warnings: profile_.allow_warnings,
    config_digest: profileConfigDigest(profile_),
  };
}
