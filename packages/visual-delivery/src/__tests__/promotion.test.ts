import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allocateRun, candidateAbsolutePath, stageCandidate, type DeliveryRun } from "../candidate.js";
import { readVerifiedHistory, withPromotion, writeVerifiedHistory } from "../history.js";
import { digestOfBytes } from "../ids.js";
import { promoteCandidate, readTargetState } from "../promotion.js";
import { requireProfile } from "../validation-profile.js";
import { verificationDigest } from "../verification.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION, type VerificationStatus, type VisualDeliveryCandidate, type VisualVerificationResult } from "../contracts.js";

// Promotion.
//
// Everything below is one question asked in different ways: can the artifact a
// reader is looking at be replaced by something that has not passed, or be
// lost while something that has passed is being written? The answer has to be
// no in every case, including the ones where the machine misbehaves rather
// than the drawing.
//
// The verification results here are constructed rather than measured. That is
// deliberate and it is the only place in the suite it happens: this module's
// job is to obey a status, not to compute one, and constructing the four
// statuses is the only way to prove it obeys all four. The end-to-end proofs
// in @rvs/cli run the real validators.

const TARGET = "artifacts/visuals/architecture.html";
const PROFILE = requireProfile("visual-standard-v1");

/**
 * Whether this process can make a directory unwritable to itself.
 *
 * The three promotion-failure cases below need a write to fail, and taking
 * away the directory's write bit is the least contrived way to arrange it.
 * Root ignores the bit and Windows does not have it, so on those the case is
 * skipped rather than asserted vacuously.
 */
const CAN_DENY_WRITES = process.platform !== "win32" && process.getuid?.() !== 0;

describe("promotion", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-promote-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function stage(html: string, run: DeliveryRun = allocateRun(repoRoot)): VisualDeliveryCandidate {
    return stageCandidate({
      repoRoot,
      run,
      artifact_type: "architecture_explorer",
      target_path: TARGET,
      html,
      visual_spec_id: "vspec_abc",
      source_digest: "a".repeat(64),
      validation_profile: PROFILE.id,
      metadata: { producer: "rvs graph open", source_snapshot_ids: [], upstream_artifact_ids: [] },
      created_at: "2026-01-01T00:00:00.000Z",
    });
  }

  function resultFor(candidate: VisualDeliveryCandidate, status: VerificationStatus = "passed"): VisualVerificationResult {
    return {
      schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
      status,
      candidate,
      profile: {
        id: PROFILE.id,
        name: PROFILE.name,
        version: PROFILE.version,
        families: [...PROFILE.families],
        requires_browser: PROFILE.requires_browser,
        allow_warnings: PROFILE.allow_warnings,
        config_digest: "cfg",
      },
      verification_digest: verificationDigest(candidate, PROFILE),
      findings: [],
      validator_summary: { families: [], checks_run: 12, findings_blocking: 0, findings_warning: 0 },
      ...(status === "incomplete" ? { incomplete_reason: "Browser verification is unavailable." } : {}),
    };
  }

  /** Promotes one candidate and records the verified artifact, the way `deliverVisualArtifact` does. */
  function promote(html: string, status: VerificationStatus = "passed") {
    const candidate = stage(html);
    const outcome = promoteCandidate({
      repoRoot,
      candidate,
      result: resultFor(candidate, status),
      verified_at: "2026-01-01T00:00:00.000Z",
    });
    if (outcome.status === "promoted" && outcome.verified !== null) {
      writeVerifiedHistory(repoRoot, withPromotion(readVerifiedHistory(repoRoot, TARGET), outcome.verified));
    }
    return { candidate, outcome };
  }

  function targetBytes(): string {
    return readFileSync(join(repoRoot, TARGET), "utf8");
  }

  function targetDigest(): string {
    return digestOfBytes(readFileSync(join(repoRoot, TARGET)));
  }

  // -------------------------------------------------------------------------

  it("promotes the first passing candidate, creating the target directory", () => {
    const { candidate, outcome } = promote("<!doctype html><title>v1</title>");

    expect(outcome.status).toBe("promoted");
    expect(outcome.digest_before).toBeNull();
    expect(outcome.digest_after).toBe(candidate.artifact_digest);
    expect(targetBytes()).toBe("<!doctype html><title>v1</title>");
  });

  it("makes the promoted target byte-identical to the candidate that was verified", () => {
    const { candidate } = promote("<!doctype html><title>v1</title>");
    expect(targetDigest()).toBe(candidate.artifact_digest);
  });

  it("names the verified artifact after the verification, not after the clock", () => {
    const { candidate, outcome } = promote("<!doctype html><title>v1</title>");
    const verified = outcome.verified;
    expect(verified).not.toBeNull();
    expect(verified?.verified_artifact_id).toBe(`vva_${verificationDigest(candidate, PROFILE).slice(0, 24)}`);
    expect(verified?.profile_id).toBe(PROFILE.id);
    expect(verified?.profile_version).toBe(PROFILE.version);
    expect(verified?.verified_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("replaces a verified artifact with a newer verified one", () => {
    promote("<!doctype html><title>v1</title>");
    const { outcome } = promote("<!doctype html><title>v2</title>");

    expect(outcome.status).toBe("promoted");
    expect(targetBytes()).toBe("<!doctype html><title>v2</title>");
    expect(readVerifiedHistory(repoRoot, TARGET).previous).toHaveLength(1);
  });

  // --- the four refusals ---------------------------------------------------

  it("refuses a failed verification and leaves the target exactly as it was", () => {
    promote("<!doctype html><title>v1</title>");
    const before = targetDigest();

    const { outcome } = promote("<!doctype html><title>v2 broken</title>", "failed");

    expect(outcome.status).toBe("not_promoted");
    expect(outcome.reason).toContain("Only a passed verification promotes");
    expect(outcome.target_preserved).toBe(true);
    expect(targetDigest()).toBe(before);
    expect(targetBytes()).toBe("<!doctype html><title>v1</title>");
  });

  it("refuses an incomplete verification, and says so as infrastructure rather than as a defect", () => {
    promote("<!doctype html><title>v1</title>");
    const before = targetDigest();

    const { outcome } = promote("<!doctype html><title>v2</title>", "incomplete");

    expect(outcome.status).toBe("not_promoted");
    expect(outcome.reason).toContain("Verification is incomplete");
    expect(outcome.reason).toContain("Browser verification is unavailable");
    expect(targetDigest()).toBe(before);
  });

  it("refuses a stale verification", () => {
    const { outcome } = promote("<!doctype html><title>v1</title>", "stale");
    expect(outcome.status).toBe("not_promoted");
    expect(existsSync(join(repoRoot, TARGET))).toBe(false);
  });

  it("refuses a candidate whose staged bytes changed after it was verified", () => {
    promote("<!doctype html><title>v1</title>");
    const before = targetDigest();

    const candidate = stage("<!doctype html><title>v2</title>");
    const result = resultFor(candidate);
    // Something touched the staged file between validation and replacement:
    // another run, an editor, a watch rebuild. The bytes that were measured
    // are no longer the bytes that would be promoted.
    writeFileSync(candidateAbsolutePath(repoRoot, candidate), "<!doctype html><title>tampered</title>");

    const outcome = promoteCandidate({ repoRoot, candidate, result, verified_at: "2026-01-01T00:00:00.000Z" });

    expect(outcome.status).toBe("not_promoted");
    expect(outcome.reason).toContain("changed after it was verified");
    expect(targetDigest()).toBe(before);
  });

  it("refuses a candidate whose staged file has gone", () => {
    const candidate = stage("<!doctype html><title>v1</title>");
    const result = resultFor(candidate);
    rmSync(candidateAbsolutePath(repoRoot, candidate));

    const outcome = promoteCandidate({ repoRoot, candidate, result, verified_at: "2026-01-01T00:00:00.000Z" });

    expect(outcome.status).toBe("not_promoted");
    expect(outcome.reason).toContain("could not be read back");
    expect(existsSync(join(repoRoot, TARGET))).toBe(false);
  });

  // --- generation ordering (the watch-mode race) ---------------------------

  it("refuses an older run's candidate even when its own verification passed", () => {
    // The race the specification names: edit A starts candidate A, edit B
    // starts candidate B, B finishes first and promotes, A finishes later.
    // A is a correct rendering of a state of the world that has already been
    // superseded, and promoting it would put the reader back one edit.
    const runA = allocateRun(repoRoot);
    const runB = allocateRun(repoRoot);
    expect(runB.generation).toBeGreaterThan(runA.generation);

    const candidateA = stage("<!doctype html><title>A</title>", runA);
    const candidateB = stage("<!doctype html><title>B</title>", runB);

    const promotedB = promoteCandidate({
      repoRoot,
      candidate: candidateB,
      result: resultFor(candidateB),
      verified_at: "2026-01-01T00:00:01.000Z",
    });
    expect(promotedB.status).toBe("promoted");
    writeVerifiedHistory(repoRoot, withPromotion(readVerifiedHistory(repoRoot, TARGET), promotedB.verified!));

    const promotedA = promoteCandidate({
      repoRoot,
      candidate: candidateA,
      result: resultFor(candidateA),
      verified_at: "2026-01-01T00:00:02.000Z",
    });

    expect(promotedA.status).toBe("not_promoted");
    expect(promotedA.reason).toContain(`generation ${candidateA.generation}`);
    expect(promotedA.reason).toContain("does not replace a newer verified artifact");
    expect(promotedA.target_preserved).toBe(true);
    expect(targetBytes()).toBe("<!doctype html><title>B</title>");
  });

  it("refuses a candidate from the generation that is already promoted", () => {
    const run = allocateRun(repoRoot);
    const candidate = stage("<!doctype html><title>v1</title>", run);
    const first = promoteCandidate({ repoRoot, candidate, result: resultFor(candidate), verified_at: "t" });
    writeVerifiedHistory(repoRoot, withPromotion(readVerifiedHistory(repoRoot, TARGET), first.verified!));

    const again = promoteCandidate({ repoRoot, candidate, result: resultFor(candidate), verified_at: "t" });
    expect(again.status).toBe("not_promoted");
    expect(again.target_preserved).toBe(true);
  });

  it("promotes generation 43 over generation 42, but never the other way round", () => {
    mkdirSync(join(repoRoot, ".rvs/cache/visual-delivery/runs/run-000041"), { recursive: true });
    const gen42 = stage("<!doctype html><title>42</title>", allocateRun(repoRoot));
    const gen43 = stage("<!doctype html><title>43</title>", allocateRun(repoRoot));
    expect([gen42.generation, gen43.generation]).toEqual([42, 43]);

    const promoted = promoteCandidate({ repoRoot, candidate: gen43, result: resultFor(gen43), verified_at: "t" });
    writeVerifiedHistory(repoRoot, withPromotion(readVerifiedHistory(repoRoot, TARGET), promoted.verified!));

    expect(promoteCandidate({ repoRoot, candidate: gen42, result: resultFor(gen42), verified_at: "t" }).status).toBe(
      "not_promoted",
    );
    expect(targetBytes()).toBe("<!doctype html><title>43</title>");
  });

  // --- promotion failure ---------------------------------------------------

  it.skipIf(!CAN_DENY_WRITES)("preserves the existing artifact when the replacement itself cannot be written", () => {
    promote("<!doctype html><title>v1</title>");
    const before = targetDigest();

    const candidate = stage("<!doctype html><title>v2</title>");
    const directory = dirname(join(repoRoot, TARGET));
    chmodSync(directory, 0o500);
    try {
      const outcome = promoteCandidate({
        repoRoot,
        candidate,
        result: resultFor(candidate),
        verified_at: "2026-01-01T00:00:00.000Z",
      });

      expect(outcome.status).toBe("promotion_failed");
      expect(outcome.reason).toContain("The existing artifact was not removed");
      expect(outcome.verified).toBeNull();
      expect(outcome.target_preserved).toBe(true);
      expect(targetDigest()).toBe(before);
    } finally {
      chmodSync(directory, 0o700);
    }
  });

  it.skipIf(!CAN_DENY_WRITES)("leaves no temporary file beside the target when the replacement fails", () => {
    promote("<!doctype html><title>v1</title>");
    const candidate = stage("<!doctype html><title>v2</title>");
    const directory = dirname(join(repoRoot, TARGET));
    chmodSync(directory, 0o500);
    try {
      promoteCandidate({ repoRoot, candidate, result: resultFor(candidate), verified_at: "t" });
    } finally {
      chmodSync(directory, 0o700);
    }
    expect(readdirSync(directory)).toEqual(["architecture.html"]);
  });

  it("leaves no temporary file beside the target after a successful promotion either", () => {
    promote("<!doctype html><title>v1</title>");
    expect(readdirSync(dirname(join(repoRoot, TARGET)))).toEqual(["architecture.html"]);
  });

  it.skipIf(!CAN_DENY_WRITES)("does not write a verified record for a promotion that failed", () => {
    promote("<!doctype html><title>v1</title>");
    const first = readVerifiedHistory(repoRoot, TARGET).current;

    const candidate = stage("<!doctype html><title>v2</title>");
    const directory = dirname(join(repoRoot, TARGET));
    chmodSync(directory, 0o500);
    try {
      const outcome = promoteCandidate({ repoRoot, candidate, result: resultFor(candidate), verified_at: "t" });
      expect(outcome.verified).toBeNull();
    } finally {
      chmodSync(directory, 0o700);
    }
    expect(readVerifiedHistory(repoRoot, TARGET).current).toEqual(first);
  });
});

describe("reading the target", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-target-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("reports an empty target as neither present nor verified", () => {
    const state = readTargetState(repoRoot, TARGET);
    expect(state).toMatchObject({ exists: false, digest: null, verified: null, unverified_target_present: false });
    expect(state.path).toBe(TARGET);
  });

  it("reports an existing artifact with no verification record as present and unverified", () => {
    // Somebody's output: written by `rvs graph open` without --verified, or
    // predating verified delivery entirely. Named as unverified, never
    // assumed verified, and never removed on that basis.
    mkdirSync(join(repoRoot, "artifacts/visuals"), { recursive: true });
    writeFileSync(join(repoRoot, TARGET), "<!doctype html><title>hand-made</title>");

    const state = readTargetState(repoRoot, TARGET);
    expect(state.exists).toBe(true);
    expect(state.verified).toBeNull();
    expect(state.unverified_target_present).toBe(true);
    expect(state.digest).toBe(digestOfBytes(readFileSync(join(repoRoot, TARGET))));
  });

  it("reports a record as the target's own only when the bytes still match it", () => {
    mkdirSync(join(repoRoot, "artifacts/visuals"), { recursive: true });
    writeFileSync(join(repoRoot, TARGET), "<!doctype html><title>verified</title>");
    const digest = digestOfBytes(readFileSync(join(repoRoot, TARGET)));

    writeVerifiedHistory(repoRoot, {
      schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
      target_path: TARGET,
      current: {
        verified_artifact_id: "vva_1",
        schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
        artifact_digest: digest,
        visual_spec_id: "vspec_abc",
        source_digest: "a".repeat(64),
        verification_digest: "c".repeat(64),
        verified_at: "2026-01-01T00:00:00.000Z",
        candidate_id: "vdc_1",
        generation: 1,
        target_path: TARGET,
        artifact_type: "architecture_explorer",
        profile_id: PROFILE.id,
        profile_version: PROFILE.version,
        validator_summary: { families: [], checks_run: 0, findings_blocking: 0, findings_warning: 0 },
      },
      previous: [],
    });

    expect(readTargetState(repoRoot, TARGET).verified?.verified_artifact_id).toBe("vva_1");

    // Edited in place afterwards. The record is still true about the bytes it
    // describes, and those are not the bytes at the target any more.
    writeFileSync(join(repoRoot, TARGET), "<!doctype html><title>edited by hand</title>");
    const after = readTargetState(repoRoot, TARGET);
    expect(after.verified).toBeNull();
    expect(after.unverified_target_present).toBe(true);
  });
});
