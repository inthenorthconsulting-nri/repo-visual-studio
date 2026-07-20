import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { defaultConfig, serializeConfig } from "@rvs/core";
import { buildPolicyId } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport } from "@rvs/governance-intelligence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCreateSlides } from "../commands/create-slides.js";
import { runExportGovernanceReport } from "../commands/export-governance-report.js";
import { runExportGovernanceSummary } from "../commands/export-governance-summary.js";
import { runGovernanceBaselineSet, runGovernanceBaselineShow, runGovernanceBaselineValidate } from "../commands/governance-baseline.js";
import { runGovernanceCheck } from "../commands/governance-check.js";
import { runGovernanceCompare } from "../commands/governance-compare.js";
import { runGovernanceExplain } from "../commands/governance-explain.js";
import { runSnapshotCreate } from "../commands/snapshot-create.js";

// ---------------------------------------------------------------------------
// These tests exercise the governance CLI commands' failure/edge behavior
// in-process (direct function calls against a temp repoRoot + fake Logger),
// exactly matching portfolio-cli.test.ts/validate.test.ts's established
// convention -- no subprocess spawning. Every assertion below was written
// against the ACTUAL control flow read from the command source files
// (packages/cli/src/commands/snapshot-create.ts, governance-baseline.ts,
// governance-compare.ts, governance-check.ts, governance-explain.ts,
// export-governance-report.ts, export-governance-summary.ts, and the
// "governance" branch of create-slides.ts), not from assumed/expected
// behavior -- some of these commands throw a plain Error (propagating to a
// `rejects.toThrow`), others set `process.exitCode = 1` and log via
// `logger.error` while resolving normally, and a couple (baseline
// show/validate with nothing configured) do neither: they log an
// informational message and return cleanly, since an absent
// `.rvs/governance.yml`/baseline is documented as a normal, optional state
// rather than an error condition. Each describe block below states which of
// the three outcomes the real code produces.
// ---------------------------------------------------------------------------

function makeLogger(): Logger & { infos: string[]; warns: string[]; errors: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    warns,
    errors,
    info: (m: string) => infos.push(m),
    warn: (m: string) => warns.push(m),
    error: (m: string) => errors.push(m),
    debug: () => {},
  };
}

// `rvs create slides --profile governance` (case 13) unconditionally calls
// loadConfig()/readCachedJson() for repository-model.json/evidence-
// manifest.json BEFORE any profile-specific branching runs (see
// create-slides.ts's runCreateSlides top few lines) -- so exercising its
// governance-specific "no cached plan" error requires these three fixtures
// to already be in place, even though the governance branch itself never
// reads their content beyond `model.git.commit`.
function writeBaseRepoFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/config.yml"), serializeConfig(defaultConfig("governance-cli-test")));
  writeFileSync(resolve(repoRoot, ".rvs/cache/repository-model.json"), JSON.stringify({ git: { commit: "abc1234" } }));
  writeFileSync(resolve(repoRoot, ".rvs/cache/evidence-manifest.json"), JSON.stringify({ claims: [] }));
}

function writeCachedArtifact(repoRoot: string, filename: string, content: unknown): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/cache", filename), JSON.stringify(content));
}

function writeGovernanceConfig(repoRoot: string, yaml: string): void {
  mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/governance.yml"), yaml);
}

// A minimal require_compatible_snapshot-only policy: its result (pass/fail)
// is driven entirely by the top-level compatibility status of the two
// snapshots being compared, never by a specific entity-level change --
// exactly the lever case 10 needs to isolate "severity" from "result".
const COMPAT_POLICY_YAML = `schema_version: 1
name: Compatibility Policy
rules:
  - id: require-compat
    title: Require compatible snapshot
    description: Snapshots must remain fully compatible with each other.
    kind: require_compatible_snapshot
    condition:
      kind: require_compatible_snapshot
      minimum_status: compatible
    severity: blocking
    enabled: true
`;

describe("runSnapshotCreate", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-snapshot-create-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 1: throws (snapshot-create.ts lines 22-28) when architecture,
  // capability, product, AND (when --include-portfolio) portfolio are all
  // undefined -- the very first check in runSnapshotCreate, before any
  // snapshot is built.
  it("throws a clear error when no cached architecture/capability/product artifacts exist at all", async () => {
    const logger = makeLogger();
    await expect(runSnapshotCreate(repoRoot, {}, logger)).rejects.toThrow(
      "No cached intelligence artifacts found (architecture-intelligence.json, capability-model.json, product-identity-model.json). Run `rvs synthesize architecture`, `rvs synthesize capabilities`, and/or `rvs synthesize product-identity` first.",
    );
  });

  // Case 2: --include-portfolio with architecture/capability/product cached
  // but NO portfolio-model.json does NOT throw -- reading the actual code,
  // the "missing domain(s)" guard (line 41) explicitly filters OUT the
  // "portfolio" artifact ("Portfolio is opt-in ... so its absence never
  // blocks"), so this is graceful partial handling, not an error, even
  // without --allow-partial. This is the behavior a naive reading of
  // "--include-portfolio with no portfolio cached" would NOT expect.
  it("succeeds gracefully (does not throw, does not require --allow-partial) when --include-portfolio is passed but no portfolio-model.json is cached, so long as architecture/capability/product are cached", async () => {
    writeCachedArtifact(repoRoot, "architecture-intelligence.json", {});
    writeCachedArtifact(repoRoot, "capability-model.json", {});
    writeCachedArtifact(repoRoot, "product-identity-model.json", {});

    const logger = makeLogger();
    await expect(runSnapshotCreate(repoRoot, { name: "partial-portfolio", includePortfolio: true }, logger)).resolves.toBeUndefined();

    expect(logger.errors).toEqual([]);
    const written = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/snapshots/partial-portfolio.json"), "utf8"));
    const portfolioDigest = written.snapshot.artifacts.find((a: { artifact: string }) => a.artifact === "portfolio");
    expect(portfolioDigest.provenance).toBe("unavailable");
  });
});

describe("runGovernanceBaselineShow", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-baseline-show-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 3: reading governance-baseline.ts's runGovernanceBaselineShow and
  // loadGovernanceConfig/showBaseline's own doc comments, an absent
  // .rvs/governance.yml is NOT treated as an error condition anywhere in
  // this path -- loadGovernanceConfig returns undefined (optional-file
  // semantics), showBaseline(undefined, ...) returns undefined (its own doc
  // comment: "config itself is undefined ... -> undefined, never throws"),
  // and runGovernanceBaselineShow logs a plain informational message and
  // returns. This deliberately does NOT match a "clear error" framing: it
  // is a normal, first-run state, not a failure.
  it("logs an informational message (does not throw, does not set process.exitCode, does not log via logger.error) when no .rvs/governance.yml exists", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceBaselineShow(repoRoot, logger)).resolves.toBeUndefined();

    expect(logger.infos.some((m) => m.includes("No governance baseline is configured"))).toBe(true);
    expect(logger.errors).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runGovernanceBaselineSet", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-baseline-set-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 4: readSnapshotEnvelope -> resolveSnapshotRefPath
  // (governance-cache.ts lines 102-116) throws when the ref resolves neither
  // as a repo-relative path nor under .rvs/cache/governance/snapshots/ (with
  // or without ".json"). Nothing in runGovernanceBaselineSet catches this,
  // so it propagates as a rejected promise -- no .rvs/governance.yml is even
  // needed to observe this.
  it("throws a clear error when the given snapshot ref does not exist under .rvs/cache/governance/snapshots/", async () => {
    const logger = makeLogger();
    await expect(runGovernanceBaselineSet(repoRoot, "does-not-exist", {}, logger)).rejects.toThrow(
      'No snapshot found for "does-not-exist" (checked as a path relative to the repo root, and as a snapshot id/filename under .rvs/cache/governance/snapshots/). Run `rvs snapshot create` first.',
    );
  });

  // Case 5: replacing an existing (compatible) baseline with a
  // schema-incompatible one. assessSnapshotCompatibility's stage 2 (schema
  // version mismatch) is triggered here via capability-model.json's own
  // `schemaVersion` field differing between the two snapshots -- this is
  // deliberately NOT about IntelligenceSnapshot.schema_version (that's
  // always the fixed GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION constant); it's
  // about the per-domain GovernanceArtifactDigest.schema_version each
  // upstream artifact's own schemaVersion field feeds (see snapshot.ts's
  // parseCapabilityForSnapshot). Without --force: logger.error + exitCode=1,
  // no throw, baseline file left untouched. With --force: succeeds, logs a
  // warning, and overwrites the baseline file.
  it("refuses (logs error, sets process.exitCode=1, does not throw, does not overwrite) an incompatible baseline swap without --force; succeeds with --force", async () => {
    writeGovernanceConfig(repoRoot, "schema_version: 1\nbaseline:\n  snapshot: .rvs/cache/governance/baseline-snapshot.json\n");

    writeCachedArtifact(repoRoot, "architecture-intelligence.json", {});
    writeCachedArtifact(repoRoot, "product-identity-model.json", {});
    writeCachedArtifact(repoRoot, "capability-model.json", { schemaVersion: 1 });
    const snapLogger = makeLogger();
    await runSnapshotCreate(repoRoot, { name: "snap-v1" }, snapLogger);

    const firstLogger = makeLogger();
    await runGovernanceBaselineSet(repoRoot, "snap-v1", {}, firstLogger);
    expect(firstLogger.errors).toEqual([]);
    const baselinePath = resolve(repoRoot, ".rvs/cache/governance/baseline-snapshot.json");
    const baselineAfterFirstSet = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(baselineAfterFirstSet.snapshot.artifacts.find((a: { artifact: string }) => a.artifact === "capability").schema_version).toBe(1);

    writeCachedArtifact(repoRoot, "capability-model.json", { schemaVersion: 2 });
    await runSnapshotCreate(repoRoot, { name: "snap-v2" }, snapLogger);
    const noForceLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceBaselineSet(repoRoot, "snap-v2", {}, noForceLogger)).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(noForceLogger.errors.some((m) => m.includes("Refusing to set an incompatible baseline without --force"))).toBe(true);
    const baselineAfterRefusal = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(baselineAfterRefusal).toEqual(baselineAfterFirstSet);
    process.exitCode = undefined;

    const forceLogger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceBaselineSet(repoRoot, "snap-v2", { force: true }, forceLogger)).resolves.toBeUndefined();
    expect(process.exitCode).toBeUndefined();
    expect(forceLogger.warns.some((m) => m.includes("Setting an incompatible baseline because --force was passed"))).toBe(true);
    const baselineAfterForce = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(baselineAfterForce).not.toEqual(baselineAfterFirstSet);
    process.exitCode = undefined;
  });
});

describe("runGovernanceBaselineValidate", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-baseline-validate-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 6: same "optional, not an error" reasoning as case 3 -- with no
  // baseline configured, runGovernanceBaselineValidate logs "Nothing to
  // validate." and returns, touching neither process.exitCode nor
  // logger.error.
  it("logs an informational message (does not throw, does not set process.exitCode) when no baseline is configured", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceBaselineValidate(repoRoot, logger)).resolves.toBeUndefined();

    expect(logger.infos.some((m) => m.includes("No governance baseline is configured. Nothing to validate."))).toBe(true);
    expect(logger.errors).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("runGovernanceCompare", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-compare-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 7: governance-compare.ts's runGovernanceComparison throws
  // immediately (before touching the target/"to" side at all) when opts.from
  // is unset AND config?.baseline is unset -- no .rvs/governance.yml is
  // written in this test at all, so config is undefined.
  it("throws a clear error when no baseline is configured and neither --from nor --to is given", async () => {
    const logger = makeLogger();
    await expect(runGovernanceCompare(repoRoot, {}, logger)).rejects.toThrow(
      "No governance baseline is configured and no --from snapshot was given. Run `rvs governance baseline set <snapshot>` first, or pass --from <snapshot>.",
    );
  });

  // Case 8: --from referencing a snapshot that was never created.
  // readSnapshotEnvelope's underlying resolveSnapshotRefPath throws the
  // exact same "No snapshot found" error case 4 exercises for `baseline
  // set`, since both call sites share governance-cache.ts's one
  // resolveSnapshotRefPath implementation.
  it("throws a clear error when --from references a snapshot that does not exist", async () => {
    const logger = makeLogger();
    await expect(runGovernanceCompare(repoRoot, { from: "missing-snapshot" }, logger)).rejects.toThrow('No snapshot found for "missing-snapshot"');
  });

  // Case 9: comparing two snapshots whose capability-model.json schemaVersion
  // fields disagree trips assessSnapshotCompatibility's stage 2 (schema
  // mismatch) -> status "incompatible" -> runGovernanceComparison logs each
  // reason via logger.error, then throws a single clear "aborted" error
  // (governance-compare.ts lines 124-129) rather than letting the diff
  // engines run against genuinely incomparable snapshots and crash
  // partway through.
  it("throws a clear compatibility-failure error (not a raw crash) when comparing two snapshots with incompatible schema versions, logging the specific mismatch reason first", async () => {
    writeCachedArtifact(repoRoot, "architecture-intelligence.json", {});
    writeCachedArtifact(repoRoot, "product-identity-model.json", {});
    writeCachedArtifact(repoRoot, "capability-model.json", { schemaVersion: 1 });
    const snapLogger = makeLogger();
    await runSnapshotCreate(repoRoot, { name: "schema-v1" }, snapLogger);

    writeCachedArtifact(repoRoot, "capability-model.json", { schemaVersion: 2 });
    await runSnapshotCreate(repoRoot, { name: "schema-v2" }, snapLogger);

    const logger = makeLogger();
    await expect(runGovernanceCompare(repoRoot, { from: "schema-v1", to: "schema-v2" }, logger)).rejects.toThrow(
      "Governance compare aborted: snapshots are incompatible (see reasons above).",
    );
    expect(logger.errors.some((m) => m.includes('Snapshots are incompatible; cannot compare "'))).toBe(true);
    expect(logger.errors.some((m) => m.includes("capability schema_version mismatch: source snapshot is 1, target snapshot is 2"))).toBe(true);
  });
});

describe("runGovernanceCheck --ci severity-vs-result gate", () => {
  let repoRoot: string;

  // Sets up ONE policy (COMPAT_POLICY_YAML) containing a single rule of
  // severity "blocking" whose result is driven purely by the compared
  // snapshots' top-level compatibility status:
  //   - comparing a snapshot to itself is always "compatible" -> rule PASSES
  //     (severity is still "blocking": a rule's configured severity is
  //     independent of whether it passed or failed -- see
  //     policy-evaluator.ts's aggregateFinding/entityFinding, which set
  //     `severity` from `rule.severity` unconditionally).
  //   - comparing a snapshot with no portfolio artifact to one that DOES
  //     have a complete portfolio artifact trips
  //     assessSnapshotCompatibility's stage 4 ("reduced coverage") ->
  //     status "partial" -> the same "blocking"-severity rule now FAILS.
  // This proves the exact distinction case 10 calls out: a "blocking"
  // severity value alone must never be read as "this run should fail" --
  // only findings whose RESULT is "fail"/"unverifiable" count toward
  // --ci's exit-code gate (governance-compare.ts's printFindingsSummary,
  // shared by both `compare` and `check`).
  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-check-"));
    writeGovernanceConfig(repoRoot, "schema_version: 1\npolicies:\n  - .rvs/policies/compat.yml\n");
    mkdirSync(resolve(repoRoot, ".rvs/policies"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".rvs/policies/compat.yml"), COMPAT_POLICY_YAML);

    writeCachedArtifact(repoRoot, "architecture-intelligence.json", {});
    writeCachedArtifact(repoRoot, "capability-model.json", {});
    writeCachedArtifact(repoRoot, "product-identity-model.json", {});
    writeCachedArtifact(repoRoot, "portfolio-model.json", {});

    const snapLogger = makeLogger();
    await runSnapshotCreate(repoRoot, { name: "no-portfolio" }, snapLogger);
    await runSnapshotCreate(repoRoot, { name: "with-portfolio", includePortfolio: true }, snapLogger);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("does NOT set process.exitCode under --ci when the only finding at the configured fail_on severity ('blocking') has result 'pass' (compatible comparison)", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await runGovernanceCheck(repoRoot, { from: "no-portfolio", to: "no-portfolio", ci: true }, logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.errors.some((m) => m.includes("[blocking]"))).toBe(false);
    expect(logger.errors.some((m) => m.includes("Governance check failed under --ci"))).toBe(false);

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const compatFinding = report.findings.find((f) => f.policy_id === buildPolicyId("Compatibility Policy"));
    expect(compatFinding).toBeDefined();
    expect(compatFinding!.severity).toBe("blocking");
    expect(compatFinding!.result).toBe("pass");
    process.exitCode = undefined;
  });

  it("sets process.exitCode = 1 under --ci when the same 'blocking'-severity rule instead FAILS (partial-compatibility comparison), and logs the specific finding plus a summary error", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await runGovernanceCheck(repoRoot, { from: "no-portfolio", to: "with-portfolio", ci: true }, logger);

    expect(process.exitCode).toBe(1);
    expect(logger.errors.some((m) => m.includes("[blocking]") && m.includes('below the required minimum "compatible"'))).toBe(true);
    expect(logger.errors.some((m) => m.includes("Governance check failed under --ci: 1 un-excepted finding(s)"))).toBe(true);

    const report = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/governance/governance-report.json"), "utf8")) as ContinuousIntelligenceReport;
    const compatFinding = report.findings.find((f) => f.policy_id === buildPolicyId("Compatibility Policy"));
    expect(compatFinding!.severity).toBe("blocking");
    expect(compatFinding!.result).toBe("fail");
    process.exitCode = undefined;
  });

  it("without --ci, never touches process.exitCode even for the failing (partial-compatibility) comparison", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await runGovernanceCheck(repoRoot, { from: "no-portfolio", to: "with-portfolio" }, logger);

    expect(process.exitCode).toBeUndefined();
    process.exitCode = undefined;
  });
});

describe("runGovernanceExplain", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-governance-explain-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 11: with no governance-report.json/governance-plan.json/
  // baseline-snapshot.json cached at all, governance-explain.ts reads all
  // three as `undefined` via readGovernanceCachedJsonOptional (never
  // throws for "missing cache" itself), then calls explainGovernanceId()
  // which throws a plain Error naming exactly what it searched. That Error
  // is caught locally (governance-explain.ts's try/catch) and turned into
  // logger.error + process.exitCode = 1 -- never a raw stack trace, and
  // never an uncaught rejection.
  it('sets process.exitCode = 1 and logs a clean "not found" message (never a raw stack trace, never a throw) for an unknown id with nothing cached', async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runGovernanceExplain(repoRoot, "governance:finding:does-not-exist", logger)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('No governance change, finding, policy evaluation, blast-radius entry, snapshot, baseline, narrative, plan, or scene found matching id "governance:finding:does-not-exist"');
    expect(logger.errors[0]).toContain("Run `rvs governance compare` first");
    // No raw stack trace / "at " frame leaked into the logged message.
    expect(logger.errors[0]).not.toMatch(/\n\s*at /);
    process.exitCode = undefined;
  });
});

describe("runExportGovernanceReport / runExportGovernanceSummary", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-governance-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 12a: export-governance-report.ts's runExportGovernanceReport reads
  // governance-report.json via readGovernanceCachedJson, which throws the
  // standard "Missing .rvs/cache/governance/<file>. Run `rvs governance
  // compare` first." message (governance-cache.ts line 74) when the file
  // was never written by a prior `rvs governance compare`/`check`.
  it("throws the standard missing-cache error when governance-report.json has never been written (export governance-report)", async () => {
    const logger = makeLogger();
    await expect(runExportGovernanceReport(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/governance/governance-report.json. Run `rvs governance compare` first.");
  });

  // Case 12b: export-governance-summary.ts reads governance-report.json
  // FIRST (before governance-narrative.json), so the exact same
  // missing-cache error surfaces even though the ultimate output is a
  // different file (a Markdown summary, not the raw JSON report).
  it("throws the standard missing-cache error when governance-report.json has never been written (export governance-summary)", async () => {
    const logger = makeLogger();
    await expect(runExportGovernanceSummary(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/governance/governance-report.json. Run `rvs governance compare` first.");
  });
});

describe("runCreateSlides --profile governance", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-create-slides-governance-"));
    writeBaseRepoFixtures(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case 13: with repository-model.json/evidence-manifest.json/.rvs/config.yml
  // present (required unconditionally by every profile, read before any
  // profile branching) but no governance-plan.json ever cached,
  // runCreateGovernanceSlides (create-slides.ts lines 301-313) throws a
  // clear, specific error rather than reading GOVERNANCE_OUTPUT_FILES.
  // governancePlan as `undefined` and crashing later on `plan.scenes`.
  it("throws a clear error when no cached governance plan exists (governance compare/check never run)", async () => {
    const logger = makeLogger();
    await expect(runCreateSlides(repoRoot, undefined, logger, "governance", {})).rejects.toThrow("No cached governance plan found. Run `rvs governance compare` first.");
  });
});
