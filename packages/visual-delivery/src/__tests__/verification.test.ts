import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMotionPlan,
  buildVisualCommunicationSpec,
  emptyVisualGraphModel,
  type VisualCommunicationSpec,
  type VisualGraphModel,
  type VisualNode,
} from "@rvs/visual-intelligence";
import type { EntityCoverage } from "@rvs/visual-composition";
import { allocateRun, stageCandidate } from "../candidate.js";
import { digestOf } from "../ids.js";
import { verificationIsStale } from "../history.js";
import { findProfile, profileConfigDigest, requireProfile, type VerificationProfile } from "../validation-profile.js";
import {
  VISUAL_VERIFICATION_BROWSER_UNAVAILABLE,
  sortDeliveryFindings,
  verificationDigest,
  verifyCandidate,
  upstreamFromChangeReview,
  type UpstreamFinding,
} from "../verification.js";
import {
  VISUAL_DELIVERY_SCHEMA_VERSION,
  type VisualDeliveryCandidate,
  type VisualDeliveryFinding,
  type VerifiedVisualArtifact,
} from "../contracts.js";

// Verification.
//
// The module under test runs validators and contains none, so what is asserted
// here is orchestration rather than judgement: that the families a profile
// names are the families that run, that a finding arrives with the code,
// subject and severity the validator gave it, that the order findings come out
// in is a property of the findings, and -- the one that matters most -- that a
// browser which will not start produces `incomplete` and never `passed`.
//
// The findings below come from real validators over real inputs. Nothing here
// fabricates a validator result.

const HTML = "<!doctype html><html><head><title>Fixture</title></head><body></body></html>";

function node(id: string, over: Partial<VisualNode> = {}): VisualNode {
  return {
    id,
    source_entity_id: id,
    label: id,
    kind: "component",
    emphasis: "normal",
    resolution: "resolved",
    confidence: "confirmed",
    evidence_refs: [],
    ...over,
  };
}

function model(nodes: VisualNode[]): VisualGraphModel {
  return { ...emptyVisualGraphModel(), nodes };
}

function specFor(nodes: VisualNode[]): VisualCommunicationSpec {
  return buildVisualCommunicationSpec({
    producer: "verification-test",
    subject: "fixture",
    semantic_intent: "architecture",
    model: model(nodes),
    audience: "engineering",
    detail_mode: "faithful",
    format: "interactive",
  }).spec;
}

function coverageFor(spec: VisualCommunicationSpec, unaccounted: string[] = []): EntityCoverage {
  return {
    source_entity_ids: [...spec.source_entity_ids],
    primary_entity_ids: spec.source_entity_ids.filter((id) => !unaccounted.includes(id)),
    detail_entity_ids: [],
    collapsed_entity_ids: [],
    hidden_entity_ids: [],
    unaccounted_entity_ids: [...unaccounted],
  };
}

describe("verification", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-verify-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function stage(html = HTML, profileId = "visual-standard-v1"): VisualDeliveryCandidate {
    return stageCandidate({
      repoRoot,
      run: allocateRun(repoRoot),
      artifact_type: "architecture_explorer",
      target_path: "artifacts/visuals/architecture.html",
      html,
      visual_spec_id: "vspec_abc",
      source_digest: "a".repeat(64),
      validation_profile: profileId,
      metadata: { producer: "test", source_snapshot_ids: [], upstream_artifact_ids: [] },
      created_at: "2026-01-01T00:00:00.000Z",
    });
  }

  it("passes a sound spec under the profile that needs no browser", async () => {
    const spec = specFor([node("a"), node("b")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: requireProfile("visual-standard-v1"),
      spec,
      coverage: coverageFor(spec),
    });

    expect(result.status).toBe("passed");
    expect(result.findings).toEqual([]);
    expect(result.validator_summary.checks_run).toBeGreaterThan(0);
  });

  it("runs exactly the families the profile names, and reports each with the validator that owns it", async () => {
    const spec = specFor([node("a")]);
    const profile = requireProfile("visual-standard-v1");
    const result = await verifyCandidate({ repoRoot, candidate: stage(), profile, spec, coverage: coverageFor(spec) });

    expect(result.validator_summary.families.map((family) => family.family)).toEqual(profile.families);
    for (const family of result.validator_summary.families) {
      expect(family.validator, family.family).toMatch(/^@rvs\//);
      expect(family.version, family.family).toMatch(/@/);
      expect(family.status, family.family).toBe("passed");
    }
  });

  // Milestone 10 closure remediation, B2: `validateColorIndependence` and
  // `validateAccessibilitySpecs` were registered validators that no caller
  // of this module ever supplied input for, so the "accessibility" family's
  // reported identity was claiming two checks that had never once run. Both
  // were retired from the family rather than wired with fabricated input --
  // see `runAccessibilityFamily` in `verification.ts` for the authoritative
  // replacement each was traced to. This pins the retirement itself: the
  // family this real entry point reports must name only the validators it
  // actually executed.
  it("names only the accessibility validators it actually ran, with neither retired validator present", async () => {
    const spec = specFor([node("a")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: requireProfile("visual-standard-v1"),
      spec,
      coverage: coverageFor(spec),
    });

    const accessibility = result.validator_summary.families.find((family) => family.family === "accessibility");
    expect(accessibility).toBeDefined();
    // The retired validator was `@rvs/visual-intelligence:validateColorIndependence`.
    // Milestone 10 closure remediation later added a *different*, deliberately
    // similarly-named validator -- `@rvs/validator:validateColorIndependenceHtmlFile`,
    // a different package, a different function, checking a rendered artifact
    // rather than an abstract spec (see the comment on that entry in
    // `FAMILY_VALIDATORS.accessibility`) -- so this assertion is pinned to the
    // retired validator's exact qualified name rather than a bare substring
    // match, which the new validator's name would otherwise also satisfy.
    expect(accessibility?.version).not.toContain("@rvs/visual-intelligence:validateColorIndependence@");
    expect(accessibility?.version).not.toMatch(/validateAccessibilitySpecs/);
    expect(accessibility?.version).toBe(
      "@rvs/visual-intelligence:validateTokenContrast@1+@rvs/visual-intelligence:validateTypeScale@1+@rvs/validator:validateHtmlFile@1+@rvs/validator:validateColorIndependenceHtmlFile@1",
    );
    // No finding in a passing run ever attributes itself to either retired
    // validator -- there would be nothing to attribute, since neither runs.
    for (const finding of result.findings) {
      expect(finding.validator).not.toBe("@rvs/visual-intelligence:validateColorIndependence");
      expect(finding.validator).not.toContain("validateAccessibilitySpecs");
    }
  });

  // The digest is what a stored verification is checked against on every
  // later run (`verificationIsStale`), so retiring a validator has to move
  // it -- silently leaving old receipts looking current under a family that
  // no longer claims what it used to would be exactly the kind of accounting
  // gap B2 exists to close. Reconstructed here byte-for-byte from the pre-
  // retirement shape (both validators back in `FAMILY_VALIDATORS.accessibility`,
  // at the version they carried) rather than asserted abstractly.
  it("moved the config digest of every profile that requires the accessibility family", () => {
    const profile = requireProfile("visual-standard-v1");
    const preRetirementDigest = digestOf({
      config: profile.config,
      families: [...profile.families].sort(),
      allow_warnings: profile.allow_warnings,
      requires_browser: profile.requires_browser,
      validators: Object.fromEntries(
        [
          "@rvs/visual-intelligence:validateVisualCommunicationSpec",
          "@rvs/visual-composition:entityCoverage",
          "@rvs/visual-change-review:validateChangeReview",
          "@rvs/visual-intelligence:validateTokenContrast",
          "@rvs/visual-intelligence:validateTypeScale",
          "@rvs/visual-intelligence:validateColorIndependence",
          "@rvs/visual-intelligence:validateAccessibilitySpecs",
          "@rvs/validator:validateHtmlFile",
        ]
          .sort()
          .map((name) => [name, "1"]),
      ),
    });

    expect(profileConfigDigest(profile)).not.toBe(preRetirementDigest);
  });

  // Milestone 10 closure -- rendered color independence (spec s29): a
  // digest moving is only useful if `verificationIsStale`, the function every
  // later run actually calls, notices. Proved here through the real
  // `verifyCandidate` pipeline rather than a hand-built digest string: a
  // record carrying the digest this profile produced *before* this
  // remediation added `validateColorIndependenceHtmlFile` must read as stale
  // against what the same profile produces now, and a record carrying today's
  // real digest must not.
  it("verificationIsStale catches this remediation's own config-digest move", async () => {
    const spec = specFor([node("a")]);
    const profile = requireProfile("visual-standard-v1");
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile,
      spec,
      coverage: coverageFor(spec),
    });
    expect(result.status).toBe("passed");

    const record: VerifiedVisualArtifact = {
      verified_artifact_id: "vva_pre_remediation",
      schema_version: result.schema_version,
      artifact_digest: result.candidate.artifact_digest,
      visual_spec_id: result.candidate.visual_spec_id,
      source_digest: result.candidate.source_digest,
      // Reconstructed byte-for-byte as `verificationDigest` would have
      // computed it immediately before this remediation: same candidate and
      // profile identity fields, but a `config_digest` built from the
      // pre-remediation three-entry accessibility validator list (no
      // `@rvs/validator:validateColorIndependenceHtmlFile`).
      verification_digest: digestOf({
        schema_version: result.schema_version,
        artifact_digest: result.candidate.artifact_digest,
        visual_spec_id: result.candidate.visual_spec_id,
        source_digest: result.candidate.source_digest,
        artifact_type: result.candidate.artifact_type,
        target_path: result.candidate.target_path,
        profile: {
          id: result.profile.id,
          name: result.profile.name,
          version: result.profile.version,
          families: result.profile.families,
          requires_browser: result.profile.requires_browser,
          allow_warnings: result.profile.allow_warnings,
          config_digest: digestOf({
            config: profile.config,
            families: [...profile.families].sort(),
            allow_warnings: profile.allow_warnings,
            requires_browser: profile.requires_browser,
            validators: Object.fromEntries(
              [
                "@rvs/visual-intelligence:validateVisualCommunicationSpec",
                "@rvs/visual-composition:entityCoverage",
                "@rvs/visual-change-review:validateChangeReview",
                "@rvs/visual-intelligence:validateTokenContrast",
                "@rvs/visual-intelligence:validateTypeScale",
                "@rvs/validator:validateHtmlFile",
              ]
                .sort()
                .map((name) => [name, "1"]),
            ),
          }),
        },
      }),
      verified_at: "2026-01-01T00:00:00.000Z",
      candidate_id: result.candidate.candidate_id,
      generation: 1,
      target_path: result.candidate.target_path,
      artifact_type: result.candidate.artifact_type,
      profile_id: result.profile.id,
      profile_version: result.profile.version,
      validator_summary: result.validator_summary,
    };

    expect(record.verification_digest).not.toBe(result.verification_digest);
    expect(verificationIsStale(record, profile.id, profile.version, result.verification_digest)).toBe(true);

    // And the negative: a record carrying today's real digest reads as
    // current, so the function is catching the actual move above rather than
    // failing open on every comparison.
    const current: VerifiedVisualArtifact = { ...record, verification_digest: result.verification_digest };
    expect(verificationIsStale(current, profile.id, profile.version, result.verification_digest)).toBe(false);
  });

  // Milestone 10 closure -- profile versioning (spec s29, C1): retiring the
  // `visual-interactive-v1` profile *object* from the registry must not stop
  // a historical record naming it from being read, and must not stop
  // `verificationIsStale` -- the only function any later run actually calls --
  // from correctly calling it stale against what `visual-interactive-v2`
  // asks today. `readVerifiedHistory`/`verificationIsStale` treat
  // `profile_id`/`profile_version` as opaque strings and never call
  // `findProfile`, so a v1-labelled record is still fully parseable even
  // though `requireProfile("visual-interactive-v1")` would now throw.
  it("reads a v1-labelled historical record as stale against the real v2 profile, without needing v1 to still resolve", async () => {
    const spec = specFor([node("a")]);
    const v2 = requireProfile("visual-interactive-v2");
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(HTML, v2.id),
      profile: v2,
      spec,
      coverage: coverageFor(spec),
      launchOptions: { executablePath: join(repoRoot, "no-such-browser") },
    });

    // A record left over from when `visual-interactive-v1` was the current
    // profile: same shape, an unrelated digest, and a profile id/version that
    // no longer names anything in `VERIFICATION_PROFILES`.
    const v1Record: VerifiedVisualArtifact = {
      verified_artifact_id: "vva_under_retired_v1",
      schema_version: result.schema_version,
      artifact_digest: result.candidate.artifact_digest,
      visual_spec_id: result.candidate.visual_spec_id,
      source_digest: result.candidate.source_digest,
      verification_digest: digestOf({ note: "computed under the retired visual-interactive-v1 profile" }),
      verified_at: "2026-01-01T00:00:00.000Z",
      candidate_id: result.candidate.candidate_id,
      generation: 1,
      target_path: result.candidate.target_path,
      artifact_type: result.candidate.artifact_type,
      profile_id: "visual-interactive-v1",
      profile_version: "v1",
      validator_summary: result.validator_summary,
    };

    expect(findProfile("visual-interactive-v1")).toBeUndefined();
    expect(() => requireProfile("visual-interactive-v1")).toThrow(/Unknown verification profile/);
    expect(
      verificationIsStale(v1Record, v2.id, v2.version, result.verification_digest),
    ).toBe(true);
  });

  // Milestone 10 closure -- profile versioning (spec s29, C1): the config
  // digest is over families/config/validators, none of which changed for
  // `interactive` -- only the identity (id, version, description) did. So the
  // *config* digest of a v1-shaped profile with today's families/config must
  // equal today's v2 config digest, while the *verification* digest (which
  // folds in the full profile identity, including id and version) must still
  // differ. Proves "same artifact + v1 != same artifact + v2" is carried by
  // identity, not smuggled in through a config change, and that timestamps
  // play no part (`created_at`/`verified_at` appear nowhere in either digest).
  it("keeps the config digest identical across v1 and v2 (same families/config) while the verification digest still differs", () => {
    const v2 = requireProfile("visual-interactive-v2");
    // Reconstructed as the v1 profile object looked: same name, same
    // families, same config -- only `id`/`version`/`description` differ.
    const v1Shaped: VerificationProfile = {
      ...v2,
      id: "visual-interactive-v1",
      version: "v1",
      description: "The v1 description, irrelevant to either digest.",
    };

    expect(profileConfigDigest(v1Shaped)).toBe(profileConfigDigest(v2));

    const cand: VisualDeliveryCandidate = {
      candidate_id: "vdc_0000000000000000000000",
      schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
      artifact_type: "architecture_explorer",
      source_path: ".rvs/cache/visual-delivery/runs/run-000001/architecture-explorer.html",
      target_path: ".rvs/out/architecture-explorer.html",
      visual_spec_id: "vspec_abc",
      source_digest: "a".repeat(64),
      artifact_digest: "b".repeat(64),
      validation_profile: v2.id,
      created_at: "2026-01-01T00:00:00.000Z",
      generation: 1,
      run_id: "run-000001",
      metadata: { producer: "verification-test", source_snapshot_ids: [], upstream_artifact_ids: [] },
    };
    expect(verificationDigest(cand, v1Shaped)).not.toBe(verificationDigest(cand, v2));
  });

  // Milestone 10 closure -- profile versioning (spec s29, C1): only
  // `interactive`/`change-review` minted a v2. `standard` and `print` were
  // not touched by the rule that forced that mint -- neither ever claimed to
  // run the new rendered colour-independence check -- so both stay at `v1`.
  it("leaves visual-standard-v1 and visual-print-v1 at v1, and proves the new validator changes neither's real behaviour", async () => {
    const standard = requireProfile("visual-standard-v1");
    const print = requireProfile("visual-print-v1");

    expect(standard.id).toBe("visual-standard-v1");
    expect(standard.version).toBe("v1");
    expect(standard.families).toEqual(["schema", "fidelity", "reference", "accessibility"]);
    expect(standard.requires_browser).toBe(false);

    expect(print.id).toBe("visual-print-v1");
    expect(print.version).toBe("v1");
    expect(print.families).toEqual(["schema", "fidelity", "reference", "layout", "typography", "contrast"]);
    expect(print.requires_browser).toBe(true);

    // `print` never names "accessibility", so the family that carries the new
    // rendered colour-independence validator contributes nothing to its
    // config digest at all -- not merely "does not run", but structurally
    // absent from its family list.
    expect(print.families).not.toContain("accessibility");

    // `standard` does name "accessibility", but the new validator is
    // browser-only, and `runBrowserFamilies` only starts a browser when a
    // profile names `layout` or `interaction` -- neither of which `standard`
    // does (see `runAccessibilityFamily`'s own comment on `colorIndependence`
    // in verification.ts). So a real run under `standard` must show zero
    // findings attributed to it, proving the shared
    // `FAMILY_VALIDATORS.accessibility` listing changed standard's reported
    // identity without changing what it actually measures.
    const spec = specFor([node("a")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: standard,
      spec,
      coverage: coverageFor(spec),
    });
    expect(result.status).toBe("passed");
    for (const finding of result.findings) {
      expect(finding.validator).not.toBe("@rvs/validator:validateColorIndependenceHtmlFile");
    }
  });

  it("fails on a real reference finding, with the code and subject the owning validator gave it", async () => {
    const spec = specFor([node("a"), node("b")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: requireProfile("visual-standard-v1"),
      spec,
      // A real coverage gap, graded by @rvs/visual-composition rather than here.
      coverage: coverageFor(spec, ["b"]),
    });

    expect(result.status).toBe("failed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: "VISUAL_COVERAGE_ENTITY_UNACCOUNTED",
      subject_id: "b",
      severity: "blocking",
      family: "reference",
      validator: "@rvs/visual-composition:validateEntityCoverage",
    });
    // Repair categories, not instructions.
    expect(result.findings[0].supported_repairs).toEqual(["restore-anchor", "resolve-reference"]);
  });

  it("carries a finding from a validator whose input this layer does not hold, without re-grading it", async () => {
    const spec = specFor([node("a")]);
    const upstream = upstreamFromChangeReview([
      { code: "CHANGE_REVIEW_DANGLING_CHANGE", message: "A change names an entity no snapshot holds.", subject_id: "svc-x", severity: "error" },
      { code: "CHANGE_REVIEW_FIDELITY_LOSS", message: "Two entities left the primary view.", subject_id: "review", severity: "warning" },
    ]);

    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: requireProfile("visual-standard-v1"),
      spec,
      coverage: coverageFor(spec),
      upstream_findings: upstream,
    });

    expect(result.status).toBe("failed");
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("CHANGE_REVIEW_DANGLING_CHANGE");
    expect(codes).toContain("CHANGE_REVIEW_FIDELITY_LOSS");
    // `error` blocks, `warning` does not: the severity the review already
    // applied, translated and not reinterpreted.
    expect(result.findings.find((f) => f.code === "CHANGE_REVIEW_DANGLING_CHANGE")?.severity).toBe("blocking");
    expect(result.findings.find((f) => f.code === "CHANGE_REVIEW_FIDELITY_LOSS")?.severity).toBe("warning");
  });

  it("passes when the only findings are warnings, because the validator that owns the rule said so", async () => {
    const spec = specFor([node("a")]);
    const upstream: UpstreamFinding[] = upstreamFromChangeReview([
      { code: "CHANGE_REVIEW_FIDELITY_LOSS", message: "Two entities left the primary view.", subject_id: "review", severity: "warning" },
    ]);

    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: requireProfile("visual-standard-v1"),
      spec,
      coverage: coverageFor(spec),
      upstream_findings: upstream,
    });

    expect(result.status).toBe("passed");
    expect(result.validator_summary.findings_warning).toBe(1);
    expect(result.validator_summary.findings_blocking).toBe(0);
  });

  it("reports the same result five times over the same candidate bytes", async () => {
    const spec = specFor([node("a"), node("b")]);
    const candidate = stage();
    const profile = requireProfile("visual-standard-v1");

    const results = [];
    for (let run = 0; run < 5; run += 1) {
      results.push(await verifyCandidate({ repoRoot, candidate, profile, spec, coverage: coverageFor(spec, ["b"]) }));
    }

    const serialised = new Set(results.map((result) => JSON.stringify(result)));
    expect(serialised.size).toBe(1);
    expect(new Set(results.map((result) => result.verification_digest)).size).toBe(1);
  });

  it("reports `incomplete` when the browser will not start, and never `passed`", async () => {
    const spec = specFor([node("a")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(HTML, "visual-interactive-v2"),
      profile: requireProfile("visual-interactive-v2"),
      spec,
      coverage: coverageFor(spec),
      launchOptions: { executablePath: join(repoRoot, "no-such-browser") },
    });

    expect(result.status).toBe("incomplete");
    expect(result.incomplete_reason).toContain("Browser verification is unavailable");

    const infrastructure = result.findings.filter((f) => f.code === VISUAL_VERIFICATION_BROWSER_UNAVAILABLE);
    expect(infrastructure.length).toBeGreaterThan(0);
    // An infrastructure repair, never one of the eleven visual ones: a missing
    // browser is not a defect in the drawing.
    expect(infrastructure[0].supported_repairs).toEqual(["install-browser-runtime"]);
  });

  it("marks every browser family `not_run` rather than reporting a clean pass it did not measure", async () => {
    const spec = specFor([node("a")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(HTML, "visual-interactive-v2"),
      profile: requireProfile("visual-interactive-v2"),
      spec,
      coverage: coverageFor(spec),
      launchOptions: { executablePath: join(repoRoot, "no-such-browser") },
    });

    const byFamily = new Map(result.validator_summary.families.map((family) => [family.family, family]));
    for (const family of ["layout", "accessibility", "interaction"] as const) {
      expect(byFamily.get(family)?.status, family).toBe("not_run");
    }
    // The families that need no browser were measured and say so.
    for (const family of ["schema", "fidelity", "reference"] as const) {
      expect(byFamily.get(family)?.status, family).toBe("passed");
    }
  });

  it("does not treat a static artifact as a motion failure", async () => {
    const spec = specFor([node("a")]);
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(HTML, "visual-interactive-v2"),
      profile: {
        ...requireProfile("visual-interactive-v2"),
        // Motion alone, so the assertion is about motion and not about a
        // browser this test does not need.
        families: ["motion"],
        requires_browser: false,
      },
      spec,
      coverage: coverageFor(spec),
    });

    expect(result.status).toBe("passed");
    const motion = result.validator_summary.families.find((family) => family.family === "motion");
    expect(motion).toMatchObject({ status: "passed", checks: 0, blocking: 0 });
  });

  it("fails a motion plan that points at an entity the drawing does not hold", async () => {
    const spec = specFor([node("a")]);
    // A real plan from the real builder, sequencing an entity the view does
    // not draw. The finding is @rvs/visual-intelligence's, not this test's.
    const plan = buildMotionPlan({ mode: "reveal", grammar: "architecture", sequence: ["a", "ghost"] });
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: { ...requireProfile("visual-standard-v1"), families: ["motion"] },
      spec,
      coverage: coverageFor(spec),
      motion: { plan, known_target_ids: ["a"] },
    });

    expect(result.status).toBe("failed");
    const unknown = result.findings.filter((f) => f.code === "VISUAL_MOTION_UNKNOWN_TARGET");
    expect(unknown.map((f) => f.subject_id)).toEqual(["ghost"]);
    expect(unknown[0].supported_repairs).toEqual(["resolve-reference"]);
  });

  it("passes a motion plan whose every target is drawn", async () => {
    const spec = specFor([node("a"), node("b")]);
    const plan = buildMotionPlan({ mode: "reveal", grammar: "architecture", sequence: ["a", "b"] });
    const result = await verifyCandidate({
      repoRoot,
      candidate: stage(),
      profile: { ...requireProfile("visual-standard-v1"), families: ["motion"] },
      spec,
      coverage: coverageFor(spec),
      motion: { plan, known_target_ids: ["a", "b"] },
    });

    expect(result.status).toBe("passed");
  });
});

describe("finding order", () => {
  function finding(over: Partial<VisualDeliveryFinding>): VisualDeliveryFinding {
    return {
      finding_id: "vdf_0",
      code: "X",
      severity: "warning",
      validator: "v",
      family: "schema",
      subject_id: "s",
      subject_type: "spec",
      message: "m",
      evidence_refs: [],
      supported_repairs: [],
      ...over,
    };
  }

  const findings: VisualDeliveryFinding[] = [
    finding({ finding_id: "f1", severity: "warning", family: "motion", code: "M", subject_id: "z" }),
    finding({ finding_id: "f2", severity: "blocking", family: "layout", code: "L", subject_id: "b" }),
    finding({ finding_id: "f3", severity: "blocking", family: "schema", code: "S", subject_id: "a" }),
    finding({ finding_id: "f4", severity: "blocking", family: "layout", code: "L", subject_id: "a" }),
    finding({ finding_id: "f5", severity: "warning", family: "schema", code: "S", subject_id: "a" }),
  ];

  it("sorts by severity, then family, then code, then subject, then finding id", () => {
    expect(sortDeliveryFindings(findings).map((f) => f.finding_id)).toEqual(["f3", "f4", "f2", "f5", "f1"]);
  });

  it("produces the same order whatever order the findings arrived in", () => {
    // Deterministic permutations rather than a random shuffle: a determinism
    // proof that fails intermittently is the least useful kind.
    const expected = sortDeliveryFindings(findings).map((f) => f.finding_id);
    const permutations = [
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
      [1, 4, 0, 3, 2],
      [3, 2, 1, 0, 4],
      [0, 2, 4, 3, 1],
    ];
    for (const order of permutations) {
      expect(sortDeliveryFindings(order.map((index) => findings[index])).map((f) => f.finding_id)).toEqual(expected);
    }
  });

  it("does not mutate the array it was given", () => {
    const input = [...findings];
    sortDeliveryFindings(input);
    expect(input.map((f) => f.finding_id)).toEqual(findings.map((f) => f.finding_id));
  });
});
