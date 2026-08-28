import {
  AA_THRESHOLDS,
  AAA_THRESHOLDS,
  NEUTRAL_VISUAL_TOKENS,
  VISUAL_TYPE_ROLES,
  VISUAL_COLOR_ROLES,
  COLOR_ROLE_CONTRAST_TIER,
  validateMotionPlan,
  validateTokenContrast,
  validateTypeScale,
  validateVisualCommunicationSpec,
} from "@rvs/visual-intelligence";
import type {
  MotionPlan,
  VisualCommunicationSpec,
  VisualDesignTokens,
  VisualFinding,
} from "@rvs/visual-intelligence";
import { validateEntityCoverage } from "@rvs/visual-composition";
import type { EntityCoverage } from "@rvs/visual-composition";
import {
  BrowserUnavailableError,
  RENDERED_INTERACTION_CODES,
  validateColorIndependenceHtmlFile,
  validateHtmlFile,
  validateInteractionHtmlFile,
} from "@rvs/validator";
import type { BrowserLaunchOptions, ColorIndependenceFinding, InteractionFinding, SceneReport } from "@rvs/validator";
import type {
  DeliveryFindingSeverity,
  ValidatorFamily,
  ValidatorFamilyResult,
  ValidatorSummary,
  VisualDeliveryCandidate,
  VisualDeliveryFinding,
  VisualVerificationResult,
} from "./contracts.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION } from "./contracts.js";
import { buildDeliveryFindingId, digestOf } from "./ids.js";
import { repairsFor } from "./repairs.js";
import { FAMILY_VALIDATORS, VALIDATOR_VERSIONS, profileIdentity, type VerificationProfile } from "./validation-profile.js";
import { candidateAbsolutePath } from "./candidate.js";

// Verification.
//
// This module runs validators. It does not contain any.
//
// Every finding below was raised by a check that already existed and already
// owned its rule: @rvs/visual-intelligence decides what a lost anchor is,
// @rvs/validator decides what an overflow is, @rvs/visual-change-review
// decides what a dangling change is. What happens here is narrower and
// entirely mechanical -- run the families a profile names, collect what comes
// back without re-grading it, and put the answer in one shape a receipt can
// render. A finding's code, subject and severity leave this module exactly as
// they arrived.
//
// The one judgement this module does make is the difference between "the
// artifact is wrong" and "the artifact was not measured". Those are
// different facts and collapsing them is how a gate ends up promoting
// something because a browser failed to start.

/**
 * A finding some other validator already produced, carried through unchanged.
 *
 * Exists for validators whose input this layer does not hold. A change review
 * runs `validateChangeReview` while it assembles itself, over a model that no
 * longer exists by the time an HTML file is on disk; re-deriving that input
 * here would mean verifying something adjacent to what was actually checked.
 * So the real findings travel with the candidate instead, and this layer
 * re-grades none of them.
 */
export interface UpstreamFinding {
  code: string;
  message: string;
  subject_id: string;
  blocking: boolean;
  /** The module that raised it, e.g. "@rvs/visual-change-review:validateChangeReview". */
  validator: string;
  family: ValidatorFamily;
  subject_type?: string;
  evidence_refs?: readonly string[];
  measured_value?: string;
  required_value?: string;
}

/**
 * Adapts `ChangeReviewFinding[]` without importing the package that defines it.
 *
 * Structural on purpose: @rvs/visual-change-review sits above this layer, and
 * a delivery gate that imported the surface it gates would invert the
 * dependency for the sake of one type. The severity mapping is the only
 * translation, and it is the identity mapping in meaning -- `error` is the
 * severity that already stopped a review from being published, `warning` and
 * `info` are the two that never did.
 */
export function upstreamFromChangeReview(
  findings: ReadonlyArray<{ code: string; message: string; subject_id: string; severity: "error" | "warning" | "info" }>,
): UpstreamFinding[] {
  return findings.map((finding) => ({
    code: finding.code,
    message: finding.message,
    subject_id: finding.subject_id,
    blocking: finding.severity === "error",
    validator: "@rvs/visual-change-review:validateChangeReview",
    family: "reference" as const,
    subject_type: "change",
  }));
}

export interface VerifyCandidateInput {
  repoRoot: string;
  candidate: VisualDeliveryCandidate;
  profile: VerificationProfile;
  /** The spec the artifact was composed from. */
  spec: VisualCommunicationSpec;
  /** Where every source entity ended up, as composition computed it. */
  coverage: EntityCoverage;
  /** Paths upstream marked critical. Passed through to the spec validator unchanged. */
  critical_paths?: ReadonlyArray<{ id: string; node_ids: readonly string[] }>;
  /** The tokens the artifact was drawn with. Defaults to the neutral set the renderers default to. */
  tokens?: VisualDesignTokens;
  /** The fit scale the primary view was drawn at, so the type check measures what a reader sees. */
  render_scale?: number;
  motion?: { plan: MotionPlan; known_target_ids: readonly string[]; static_target_ids?: readonly string[] };
  /** Findings from validators whose input this layer does not hold. */
  upstream_findings?: readonly UpstreamFinding[];
  launchOptions?: BrowserLaunchOptions;
  /**
   * How long the browser families get before verification is called
   * incomplete. Conservative by construction: the timeout produces
   * `incomplete`, never `passed`.
   */
  browser_timeout_ms?: number;
}

export const DEFAULT_BROWSER_TIMEOUT_MS = 120_000;

/** Raised when a browser check does not finish. Never a statement about the drawing. */
export const VISUAL_VERIFICATION_TIMEOUT = "VISUAL_VERIFICATION_TIMEOUT";
/** Raised when no browser could be started. Never a statement about the drawing. */
export const VISUAL_VERIFICATION_BROWSER_UNAVAILABLE = "VISUAL_VERIFICATION_BROWSER_UNAVAILABLE";

const FIDELITY_PREFIX = "VISUAL_FIDELITY_";

interface FamilyRun {
  family: ValidatorFamily;
  validator: string;
  checks: number;
  findings: VisualDeliveryFinding[];
  status: ValidatorFamilyResult["status"];
}

function toDelivery(
  finding: { code: string; message: string; subject_id: string; blocking: boolean },
  family: ValidatorFamily,
  validator: string,
  subjectType: string,
  extra: { evidence_refs?: readonly string[]; measured_value?: string; required_value?: string } = {},
): VisualDeliveryFinding {
  const severity: DeliveryFindingSeverity = finding.blocking ? "blocking" : "warning";
  return {
    finding_id: buildDeliveryFindingId(finding.code, finding.subject_id),
    code: finding.code,
    severity,
    validator,
    family,
    subject_id: finding.subject_id,
    subject_type: subjectType,
    message: finding.message,
    ...(extra.measured_value === undefined ? {} : { measured_value: extra.measured_value }),
    ...(extra.required_value === undefined ? {} : { required_value: extra.required_value }),
    evidence_refs: [...(extra.evidence_refs ?? [])],
    supported_repairs: repairsFor(finding.code),
  };
}

const SEVERITY_RANK: Record<DeliveryFindingSeverity, number> = { blocking: 0, warning: 1 };
const FAMILY_RANK: Record<ValidatorFamily, number> = {
  schema: 0,
  fidelity: 1,
  reference: 2,
  layout: 3,
  typography: 4,
  contrast: 5,
  accessibility: 6,
  interaction: 7,
  motion: 8,
};

/**
 * The one order findings are ever reported in.
 *
 * Severity first because a reader with one minute reads the first line;
 * family, code, subject and finding id after it because every one of those is
 * a property of the finding rather than of the run that produced it. Nothing
 * here depends on the order a validator happened to return things in, or on
 * object key traversal, so shuffling the input cannot move the output.
 */
export function sortDeliveryFindings(findings: readonly VisualDeliveryFinding[]): VisualDeliveryFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      FAMILY_RANK[a.family] - FAMILY_RANK[b.family] ||
      a.code.localeCompare(b.code) ||
      a.subject_id.localeCompare(b.subject_id) ||
      a.finding_id.localeCompare(b.finding_id),
  );
}

function versionOf(family: ValidatorFamily): string {
  const names = FAMILY_VALIDATORS[family];
  return names.map((name) => `${name}@${VALIDATOR_VERSIONS[name] ?? "unknown"}`).join("+");
}

function familyResult(run: FamilyRun): ValidatorFamilyResult {
  const blocking = run.findings.filter((f) => f.severity === "blocking").length;
  return {
    family: run.family,
    validator: run.validator,
    version: versionOf(run.family),
    checks: run.checks,
    blocking,
    warnings: run.findings.length - blocking,
    status: run.status,
  };
}

// ---------------------------------------------------------------------------
// The families
// ---------------------------------------------------------------------------

/** How many colour-role checks `validateTokenContrast` performs: every non-decorative role against both grounds. */
function contrastCheckCount(): number {
  return VISUAL_COLOR_ROLES.filter((role) => COLOR_ROLE_CONTRAST_TIER[role] !== "decoration").length * 2;
}

function runSpecFamilies(input: VerifyCandidateInput): { schema: FamilyRun; fidelity: FamilyRun } {
  const validator = "@rvs/visual-intelligence:validateVisualCommunicationSpec";
  const all = validateVisualCommunicationSpec(input.spec, { critical_paths: input.critical_paths });
  const fidelity = all.filter((f) => f.code.startsWith(FIDELITY_PREFIX));
  const schema = all.filter((f) => !f.code.startsWith(FIDELITY_PREFIX));
  return {
    schema: {
      family: "schema",
      validator,
      // Six vocabulary and determinism rules, evaluated against one spec.
      checks: 6,
      findings: schema.map((f) => toDelivery(f, "schema", validator, "spec")),
      status: schema.some((f) => f.blocking) ? "failed" : "passed",
    },
    fidelity: {
      family: "fidelity",
      validator,
      // Four receipt rules, plus one per critical path the caller named.
      checks: 4 + (input.critical_paths?.length ?? 0),
      findings: fidelity.map((f) =>
        toDelivery(f, "fidelity", validator, f.code === "VISUAL_FIDELITY_CRITICAL_PATH_LOST" ? "path" : "entity"),
      ),
      status: fidelity.some((f) => f.blocking) ? "failed" : "passed",
    },
  };
}

function runReferenceFamily(input: VerifyCandidateInput): FamilyRun {
  const validator = "@rvs/visual-composition:validateEntityCoverage";
  const coverage = validateEntityCoverage(input.coverage).map((f) =>
    toDelivery(f, "reference", validator, "entity"),
  );
  const upstream = (input.upstream_findings ?? [])
    .filter((f) => f.family === "reference")
    .map((f) =>
      toDelivery(f, "reference", f.validator, f.subject_type ?? "reference", {
        evidence_refs: f.evidence_refs,
        measured_value: f.measured_value,
        required_value: f.required_value,
      }),
    );
  const findings = [...coverage, ...upstream];
  return {
    family: "reference",
    validator,
    checks: input.coverage.source_entity_ids.length + upstream.length,
    findings,
    status: findings.some((f) => f.severity === "blocking") ? "failed" : "passed",
  };
}

function runAccessibilityFamily(
  input: VerifyCandidateInput,
  rendered: SceneReport[] | null,
  colorIndependence: { findings: ColorIndependenceFinding[]; checks: number } | null,
): FamilyRun {
  const tokens = input.tokens ?? NEUTRAL_VISUAL_TOKENS;
  const thresholds = input.profile.config.contrast_level === "AAA" ? AAA_THRESHOLDS : AA_THRESHOLDS;
  const scale = input.render_scale ?? input.profile.config.render_scale;

  const findings: VisualDeliveryFinding[] = [];
  let checks = 0;

  const contrastValidator = "@rvs/visual-intelligence:validateTokenContrast";
  checks += contrastCheckCount();
  for (const f of validateTokenContrast(tokens, thresholds)) {
    findings.push(
      toDelivery(f, "accessibility", contrastValidator, "token", {
        required_value: `${thresholds.text}:1 text, ${thresholds.non_text}:1 non-text`,
      }),
    );
  }

  const typeValidator = "@rvs/visual-intelligence:validateTypeScale";
  checks += VISUAL_TYPE_ROLES.length;
  for (const f of validateTypeScale(tokens, scale, input.profile.config.minimum_font_size_px)) {
    findings.push(
      toDelivery(f, "accessibility", typeValidator, "token", {
        required_value: `${input.profile.config.minimum_font_size_px}px at scale ${scale}`,
      }),
    );
  }

  // `validateColorIndependence` and `validateAccessibilitySpecs` are not run
  // here. Milestone 10 closure remediation (B2) found both unreachable from
  // this path: no caller of `VerifyCandidateInput` ever supplied
  // `state_presentations` or `accessibility_specs`, so the "accessibility"
  // family's reported validator set was claiming two checks that had never
  // once executed. Rather than wire fabricated input to make them run, each
  // was traced to an authoritative replacement that already covers its
  // invariant with real production data, and both were formally retired from
  // this contract:
  //
  // - `validateColorIndependence` checks a state's *presentation* --
  //   `resolveVisualState`'s output -- which is a pure function of the
  //   finite, closed `VISUAL_STATES` vocabulary, never of candidate-specific
  //   data. `@rvs/visual-intelligence`'s own
  //   `visual-state.test.ts` ("passes the colour-independence check for
  //   every state that carries meaning") already runs this exact validator
  //   over the complete vocabulary, unconditionally, on every test run.
  //   Gating it per-delivery could not have learned anything that
  //   whole-vocabulary test had not already proven.
  //
  // - `validateAccessibilitySpecs` checks three things: an unnamed focusable
  //   control, a non-deterministic tab order, and an invisible focus ring.
  //   For the two surfaces this module ever delivers (the explorer and the
  //   change review), the first two are already checked against the real
  //   candidate HTML, in a real browser, by the "interaction" family's
  //   `@rvs/validator:validateInteractionHtmlFile` (`RENDERED_CONTROL_UNNAMED`,
  //   `RENDERED_CONTROL_UNREACHABLE`, `RENDERED_DUPLICATE_ELEMENT_ID`) --
  //   required, not optional, by both `visual-interactive-v2` and
  //   `visual-change-review-v2`. The focus ring's colour is already checked,
  //   unconditionally, by `validateTokenContrast` above (`focus` is a
  //   non-decoration colour role); its width is a hardcoded constant
  //   (`NEUTRAL_VISUAL_TOKENS.geometry.focusRingWidth`, never overridden by
  //   this module's only caller) rather than candidate data, so there is
  //   nothing here for a per-delivery check to learn either.
  //   `VisualAccessibilitySpec`'s own shape confirms it was never meant for
  //   this surface: its `role` is restricted to the rendered diagram's own
  //   primitives (`image | group | region | button | link | listitem | note
  //   | status`), not HTML form controls -- the one real production site
  //   that ever built one, `@rvs/visual-grammar`'s `primitives.ts`, is
  //   unwired and out of this remediation's scope. Wiring this validator
  //   here would have meant either resurrecting that excluded code or
  //   inventing a mapping from `<input>`/`<select>` elements onto a role
  //   vocabulary that does not describe them -- asserting accessibility
  //   semantics through a "verified" gate that would themselves be wrong.
  //
  // Both retirements are a `FAMILY_VALIDATORS.accessibility` change, so the
  // "accessibility" family's version identity -- and therefore
  // `profileConfigDigest` for every profile, since every profile requires
  // this family -- changed the moment this landed. No historical verified
  // record can match the new digest, so `verificationIsStale` (this
  // package's own staleness check) correctly marks every one of them stale
  // rather than leaving them looking current under a family that no longer
  // claims what it used to.

  if (rendered !== null) {
    const validator = "@rvs/validator:validateHtmlFile";
    for (const scene of rendered) {
      for (const check of scene.checks) {
        if (check.rule !== "min-font-size" && check.rule !== "contrast" && check.rule !== "missing-evidence") continue;
        checks += 1;
        if (check.status === "pass") continue;
        findings.push(
          toDelivery(
            {
              code: `rendered:${check.rule}`,
              message: check.message,
              subject_id: scene.scene_id,
              blocking: check.status === "fail",
            },
            "accessibility",
            validator,
            "scene",
            {
              required_value:
                check.rule === "min-font-size"
                  ? `${input.profile.config.minimum_font_size_px}px`
                  : check.rule === "contrast"
                    ? `${thresholds.text}:1`
                    : undefined,
            },
          ),
        );
      }
    }
  }

  // Rendered color independence: does the state `resolveVisualState` resolved
  // still read as that state once color is removed. Only available when a
  // browser actually ran (interactive/change-review, same as `rendered`
  // above) -- `standard` verifies the token-level checks with no browser at
  // all, so this simply does not run there, exactly as the rendered checks
  // above already do not. A finding here always blocks (§20 of the closure
  // spec): a semantic state communicated by color alone is a defect in the
  // artifact, not an advisory.
  if (colorIndependence !== null) {
    const validator = "@rvs/validator:validateColorIndependenceHtmlFile";
    checks += colorIndependence.checks;
    for (const f of colorIndependence.findings) {
      findings.push(
        toDelivery(
          { code: f.code, message: f.message, subject_id: f.subject, blocking: true },
          "accessibility",
          validator,
          "node",
          {
            required_value: `${f.expected_channel} channel present for resolved state "${f.state}"`,
            measured_value: JSON.stringify(f.observed),
          },
        ),
      );
    }
  }

  return {
    family: "accessibility",
    validator: "@rvs/visual-intelligence:accessibility",
    checks,
    findings,
    status: findings.some((f) => f.severity === "blocking") ? "failed" : "passed",
  };
}

/**
 * @param rules The rules this family owns, each with what it required. The
 * required value is per rule rather than per family because a family can
 * measure more than one invariant -- `layout` asks both whether a fixed frame
 * holds its content and whether two entity boxes were drawn on top of each
 * other -- and a receipt that reported one requirement for both would be
 * telling the reader the wrong thing about one of them.
 */
function runRenderedRuleFamily(
  family: "layout" | "typography" | "contrast",
  rules: Readonly<Partial<Record<SceneReport["checks"][number]["rule"], string>>>,
  rendered: SceneReport[],
): FamilyRun {
  const validator = "@rvs/validator:validateHtmlFile";
  const findings: VisualDeliveryFinding[] = [];
  let checks = 0;
  for (const scene of rendered) {
    for (const check of scene.checks) {
      if (!Object.prototype.hasOwnProperty.call(rules, check.rule)) continue;
      checks += 1;
      if (check.status === "pass") continue;
      findings.push(
        toDelivery(
          {
            code: `rendered:${check.rule}`,
            message: check.message,
            subject_id: scene.scene_id,
            blocking: check.status === "fail",
          },
          family,
          validator,
          "scene",
          { required_value: rules[check.rule] },
        ),
      );
    }
  }
  return {
    family,
    validator,
    checks,
    findings,
    status: findings.some((f) => f.severity === "blocking") ? "failed" : "passed",
  };
}

function runInteractionFamily(interaction: InteractionFinding[]): FamilyRun {
  const validator = "@rvs/validator:validateInteractionHtmlFile";
  const findings = interaction.map((f) =>
    toDelivery(
      { code: f.code, message: f.message, subject_id: f.subject, blocking: true },
      "interaction",
      validator,
      f.code === "RENDERED_DUPLICATE_ELEMENT_ID" || f.code === "RENDERED_LABELLEDBY_UNRESOLVED" ? "element" : "control",
    ),
  );
  return {
    family: "interaction",
    validator,
    checks: RENDERED_INTERACTION_CODES.length,
    findings,
    status: findings.length > 0 ? "failed" : "passed",
  };
}

function runMotionFamily(input: VerifyCandidateInput): FamilyRun {
  const validator = "@rvs/visual-intelligence:validateMotionPlan";
  // A static artifact is a valid artifact. No plan means nothing claimed to
  // move, which is a complete answer to "is the motion trustworthy" and not a
  // gap in verification -- so the family passes with the checks it ran, which
  // is none, said plainly.
  if (input.motion === undefined) {
    return { family: "motion", validator, checks: 0, findings: [], status: "passed" };
  }
  const findings = validateMotionPlan({
    plan: input.motion.plan,
    known_target_ids: input.motion.known_target_ids,
    static_target_ids: input.motion.static_target_ids,
  }).map((f: VisualFinding) => toDelivery(f, "motion", validator, "target"));
  return {
    family: "motion",
    validator,
    checks: input.motion.plan.target_ids.length + 3,
    findings,
    status: findings.some((f) => f.severity === "blocking") ? "failed" : "passed",
  };
}

function infrastructureRun(family: ValidatorFamily, code: string, message: string): FamilyRun {
  return {
    family,
    validator: versionOf(family),
    checks: 0,
    findings: [
      toDelivery({ code, message, subject_id: family, blocking: true }, family, "@rvs/visual-delivery:verification", "runtime"),
    ],
    status: "not_run",
  };
}

// ---------------------------------------------------------------------------
// The browser block
// ---------------------------------------------------------------------------

interface BrowserOutcome {
  scenes: SceneReport[] | null;
  interaction: InteractionFinding[] | null;
  colorIndependence: { findings: ColorIndependenceFinding[]; checks: number } | null;
  /** Set when the browser families could not be measured at all. */
  incomplete: { code: string; reason: string } | null;
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms.`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs the browser families, or explains why it could not.
 *
 * The two failures it distinguishes are the two that matter. A browser that
 * will not start is a missing tool; a browser that starts and never answers is
 * a hung measurement. Neither is a fact about the artifact, and neither may
 * promote -- §75's rule is that verification not finishing is not verification
 * succeeding.
 */
async function runBrowserFamilies(input: VerifyCandidateInput, families: Set<ValidatorFamily>): Promise<BrowserOutcome> {
  const htmlPath = candidateAbsolutePath(input.repoRoot, input.candidate);
  const timeoutMs = input.browser_timeout_ms ?? DEFAULT_BROWSER_TIMEOUT_MS;
  const needsScenes = families.has("layout") || families.has("typography") || families.has("contrast");
  const needsRenderedA11y = families.has("accessibility");
  const needsInteraction = families.has("interaction");

  try {
    let scenes: SceneReport[] | null = null;
    if (needsScenes || needsRenderedA11y) {
      // Measured once per polarity the profile names, and merged. A dark
      // palette that fails contrast fails it in the reader's browser whether
      // or not the machine running verification prefers dark.
      const merged: SceneReport[] = [];
      for (const scheme of input.profile.config.color_schemes) {
        const report = await withTimeout(
          validateHtmlFile(htmlPath, {
            minFontSizePx: input.profile.config.minimum_font_size_px,
            minimumContrast: input.profile.config.contrast_level,
            colorScheme: scheme,
            launchOptions: input.launchOptions,
          }),
          timeoutMs,
          `Rendered validation (${scheme})`,
        );
        for (const scene of report.scenes) {
          merged.push({ ...scene, scene_id: `${scene.scene_id}@${scheme}` });
        }
      }
      scenes = merged;
    }

    let interaction: InteractionFinding[] | null = null;
    if (needsInteraction) {
      const report = await withTimeout(
        validateInteractionHtmlFile(htmlPath, { launchOptions: input.launchOptions }),
        timeoutMs,
        "Interaction validation",
      );
      interaction = report.findings;
    }

    let colorIndependence: { findings: ColorIndependenceFinding[]; checks: number } | null = null;
    if (needsRenderedA11y) {
      const report = await withTimeout(
        validateColorIndependenceHtmlFile(htmlPath, { launchOptions: input.launchOptions }),
        timeoutMs,
        "Color independence validation",
      );
      colorIndependence = { findings: report.findings, checks: report.checks };
    }

    return { scenes, interaction, colorIndependence, incomplete: null };
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return {
        scenes: null,
        interaction: null,
        colorIndependence: null,
        incomplete: { code: VISUAL_VERIFICATION_BROWSER_UNAVAILABLE, reason: error.message },
      };
    }
    if (error instanceof Error && / did not finish within \d+ms\.$/.test(error.message)) {
      return {
        scenes: null,
        interaction: null,
        colorIndependence: null,
        incomplete: { code: VISUAL_VERIFICATION_TIMEOUT, reason: error.message },
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * The verification digest.
 *
 * Over what was measured and the rules it was measured against: the artifact's
 * bytes, the spec it draws, what that spec was built from, and the profile's
 * complete identity including every validator version and every threshold.
 * Not over the findings -- the digest names a verification, and the same
 * artifact checked under the same rules is the same verification whatever it
 * turned out to be. Not over the clock, so two machines agree.
 */
export function verificationDigest(
  candidate: VisualDeliveryCandidate,
  profile: VerificationProfile,
): string {
  return digestOf({
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    artifact_digest: candidate.artifact_digest,
    visual_spec_id: candidate.visual_spec_id,
    source_digest: candidate.source_digest,
    artifact_type: candidate.artifact_type,
    target_path: candidate.target_path,
    profile: profileIdentity(profile),
  });
}

export async function verifyCandidate(input: VerifyCandidateInput): Promise<VisualVerificationResult> {
  const required = new Set(input.profile.families);
  const runs: FamilyRun[] = [];

  const browserRequired = [...required].filter((family) => family === "layout" || family === "interaction");
  const browser: BrowserOutcome =
    browserRequired.length > 0
      ? await runBrowserFamilies(input, required)
      : { scenes: null, interaction: null, colorIndependence: null, incomplete: null };

  const specFamilies = runSpecFamilies(input);
  if (required.has("schema")) runs.push(specFamilies.schema);
  if (required.has("fidelity")) runs.push(specFamilies.fidelity);
  if (required.has("reference")) runs.push(runReferenceFamily(input));

  const contrastRequired = input.profile.config.contrast_level === "AAA" ? AAA_THRESHOLDS : AA_THRESHOLDS;

  if (required.has("layout")) {
    runs.push(
      browser.scenes === null
        ? infrastructureRun("layout", browser.incomplete?.code ?? VISUAL_VERIFICATION_BROWSER_UNAVAILABLE, browser.incomplete?.reason ?? "Rendered layout was not measured.")
        : runRenderedRuleFamily(
            "layout",
            { overflow: "content within its frame", "node-overlap": "entity boxes drawn without overlap" },
            browser.scenes,
          ),
    );
  }
  if (required.has("typography")) {
    runs.push(
      browser.scenes === null
        ? infrastructureRun("typography", browser.incomplete?.code ?? VISUAL_VERIFICATION_BROWSER_UNAVAILABLE, browser.incomplete?.reason ?? "Rendered typography was not measured.")
        : runRenderedRuleFamily("typography", { "min-font-size": `${input.profile.config.minimum_font_size_px}px` }, browser.scenes),
    );
  }
  if (required.has("contrast")) {
    runs.push(
      browser.scenes === null
        ? infrastructureRun("contrast", browser.incomplete?.code ?? VISUAL_VERIFICATION_BROWSER_UNAVAILABLE, browser.incomplete?.reason ?? "Rendered contrast was not measured.")
        : runRenderedRuleFamily("contrast", { contrast: `${contrastRequired.text}:1` }, browser.scenes),
    );
  }
  if (required.has("accessibility")) {
    // The token-level accessibility checks need no browser and are reported
    // even when the rendered half could not run; the family is still marked
    // `not_run` in that case, because a profile that asked for rendered
    // accessibility did not get it.
    const run = runAccessibilityFamily(input, browser.scenes, browser.colorIndependence);
    runs.push(
      browserRequired.length > 0 && browser.scenes === null && browser.incomplete !== null
        ? { ...run, status: "not_run" }
        : run,
    );
  }
  if (required.has("interaction")) {
    runs.push(
      browser.interaction === null
        ? infrastructureRun("interaction", browser.incomplete?.code ?? VISUAL_VERIFICATION_BROWSER_UNAVAILABLE, browser.incomplete?.reason ?? "Keyboard interaction was not measured.")
        : runInteractionFamily(browser.interaction),
    );
  }
  if (required.has("motion")) runs.push(runMotionFamily(input));

  // Anything the caller carried in for a family the profile did not name is
  // reported rather than dropped: a finding a validator produced does not
  // stop being true because this profile was not asking.
  const carried = (input.upstream_findings ?? []).filter((f) => f.family !== "reference" || !required.has("reference"));
  for (const f of carried) {
    if (f.family === "reference" && required.has("reference")) continue;
    if (required.has(f.family)) continue;
    runs.push({
      family: f.family,
      validator: f.validator,
      checks: 1,
      findings: [
        toDelivery(f, f.family, f.validator, f.subject_type ?? "document", {
          evidence_refs: f.evidence_refs,
          measured_value: f.measured_value,
          required_value: f.required_value,
        }),
      ],
      status: f.blocking ? "failed" : "passed",
    });
  }

  const findings = sortDeliveryFindings(runs.flatMap((run) => run.findings));
  const families = runs
    .map(familyResult)
    .sort((a, b) => FAMILY_RANK[a.family] - FAMILY_RANK[b.family] || a.validator.localeCompare(b.validator));

  const blocking = findings.filter((f) => f.severity === "blocking").length;
  const summary: ValidatorSummary = {
    families,
    checks_run: families.reduce((total, family) => total + family.checks, 0),
    findings_blocking: blocking,
    findings_warning: findings.length - blocking,
  };

  const incomplete = browser.incomplete !== null && browserRequired.length > 0;
  const status = incomplete ? "incomplete" : blocking > 0 ? "failed" : "passed";

  return {
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    status,
    candidate: input.candidate,
    profile: profileIdentity(input.profile),
    verification_digest: verificationDigest(input.candidate, input.profile),
    findings,
    validator_summary: summary,
    ...(browser.incomplete === null ? {} : { incomplete_reason: browser.incomplete.reason }),
  };
}
