import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { defaultConfig, serializeConfig } from "@rvs/core";
import type { DecisionChangeSet, DecisionIntelligenceReport } from "@rvs/decision-intelligence";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCreateSlides } from "../commands/create-slides.js";
import { runDecisionAnalysis, runDecisionsAnalyze } from "../commands/decisions-analyze.js";
import { runDecisionsCompare } from "../commands/decisions-compare.js";
import { runDecisionsExplain } from "../commands/decisions-explain.js";
import { runDecisionsValidate } from "../commands/decisions-validate.js";
import { runExportDecisionReport } from "../commands/export-decision-report.js";
import { runExportDecisionSummary } from "../commands/export-decision-summary.js";

// ---------------------------------------------------------------------------
// These tests exercise the decisions CLI commands' behavior in-process
// (direct function calls against a temp repoRoot + fake Logger), exactly
// matching governance-cli.test.ts's established convention -- no subprocess
// spawning. Every assertion below was written against the ACTUAL control
// flow read from the command source files (packages/cli/src/commands/
// decisions-analyze.ts, decisions-validate.ts, decisions-compare.ts,
// decisions-explain.ts, export-decision-report.ts, export-decision-summary.ts,
// and the "decisions" branch of create-slides.ts) plus the underlying
// @rvs/decision-intelligence package (discovery.ts, source-classification.ts,
// alternatives.ts, validation.ts, compatibility.ts, diff.ts, snapshot.ts,
// ids.ts), not from assumed/expected behavior. Each describe block/case
// states which real code path it exercises.
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

// `rvs create slides --profile decisions` (case: create-slides) unconditionally
// calls loadConfig()/readCachedJson() for repository-model.json/evidence-
// manifest.json BEFORE any profile-specific branching runs (see
// create-slides.ts's runCreateSlides top few lines, shared verbatim by every
// profile) -- so exercising the decisions-specific "no cached plan" error
// requires these three fixtures to already be in place, mirroring
// governance-cli.test.ts's writeBaseRepoFixtures precedent exactly.
function writeBaseRepoFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/config.yml"), serializeConfig(defaultConfig("decisions-cli-test")));
  writeFileSync(resolve(repoRoot, ".rvs/cache/repository-model.json"), JSON.stringify({ git: { commit: "abc1234" } }));
  writeFileSync(resolve(repoRoot, ".rvs/cache/evidence-manifest.json"), JSON.stringify({ claims: [] }));
}

// Configures a single `.rvs/decisions.yml` source pointing at docs/decisions/
// with `type: adr`, forcing classifyDecisionSource's very first branch
// (configured_type set -> classification_basis "configured_path",
// source-classification.ts lines 27-30) so every fixture markdown file
// dropped under docs/decisions/ is picked up deterministically regardless of
// its own heading/filename shape.
function writeDecisionsConfig(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".rvs/decisions.yml"),
    "schema_version: 1\nsources:\n  - path: docs/decisions\n    type: adr\n",
  );
}

// A well-formed ADR: frontmatter `id`/`status` (identity.ts's
// DEFAULT_PREFERENCE_ORDER puts frontmatter.id first, so this decision's id
// is deterministically "decision:ADR-0001", per ids.ts's buildDecisionId),
// plus a `## Alternatives` heading with a `[state] statement`-labeled bullet
// list (alternatives.ts's extractFromList/parseLabeledListItem path) so the
// decisions.json `alternatives_by_decision_id` fold-in (decisions-analyze.ts
// lines 319-331) has real content to fold in.
function writeAdrFixture(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, "docs/decisions"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, "docs/decisions/0001-use-postgres.md"),
    `---
id: ADR-0001
status: accepted
---

# Use PostgreSQL as the primary database

## Context

We need a relational database for the core application's transactional data.

## Decision

We will use PostgreSQL as the primary datastore for all transactional data.

## Alternatives

- [rejected] Use MySQL: weaker JSON support and extension ecosystem for our needs.
- [considered] Use a managed NoSQL store: does not fit our relational data model.
`,
  );
}

// A second ADR whose frontmatter `supersedes` names an id that does not, and
// never will, exist in this repo -- reliably trips
// validation.ts's checkBrokenSupersessionReferences (iterates
// `[...decision.supersedes, ...decision.superseded_by]` checking
// `decisionsById.has(targetId)`) into a single DECISION_BROKEN_SUPERSESSION_
// REFERENCE finding, which validation.ts's TIER1_ERROR_CODES marks
// "error"-severity.
function writeBrokenSupersessionFixture(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, "docs/decisions"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, "docs/decisions/0002-use-redis.md"),
    `---
id: ADR-0002
status: accepted
supersedes:
  - does-not-exist
---

# Use Redis for caching

## Decision

We will use Redis for caching of hot read paths.
`,
  );
}

describe("runDecisionsAnalyze / runDecisionAnalysis", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-decisions-analyze-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: with no .rvs/decisions.yml at all, decisions-analyze.ts's
  // loadDecisionsConfig() returns undefined -> falls back to
  // `{ schema_version: 1, sources: [] }` (line 88), so
  // discoverDecisionCandidates (discovery.ts) iterates zero sources and
  // returns []. The full pipeline still runs to completion (never throws)
  // and writeDecisionOutputs is called unconditionally with every
  // DECISION_OUTPUT_FILES key except decisionChanges (compare-only), even
  // though every collection is empty.
  it("runs to completion with decision_count 0 and writes every analyze-time cache file when there are zero decision candidates", async () => {
    const logger = makeLogger();
    await expect(runDecisionsAnalyze(repoRoot, {}, logger)).resolves.toBeUndefined();

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m === 'Analyzed 0 decision(s) (compatibility: "unavailable").')).toBe(true);
    expect(logger.infos.some((m) => m === "Findings: 0 drift, 0 debt, 0 conflict(s), 0 supersession issue(s).")).toBe(true);
    expect(logger.infos.some((m) => m === "Cached decision outputs to .rvs/cache/decisions/.")).toBe(true);

    const cacheDir = resolve(repoRoot, ".rvs/cache/decisions");
    for (const file of [
      "decision-snapshot.json",
      "decisions.json",
      "decision-links.json",
      "assumptions.json",
      "consequences.json",
      "dependencies.json",
      "supersession.json",
      "conflicts.json",
      "implementation-state.json",
      "coverage.json",
      "drift.json",
      "decision-debt.json",
      "decision-claims.json",
      "decision-narrative.json",
      "decision-plan.json",
      "decision-report.json",
    ]) {
      expect(existsSync(resolve(cacheDir, file))).toBe(true);
    }
    // decision-changes.json is only ever written by `decisions compare`.
    expect(existsSync(resolve(cacheDir, "decision-changes.json"))).toBe(false);

    const report = JSON.parse(readFileSync(resolve(cacheDir, "decision-report.json"), "utf8")) as DecisionIntelligenceReport;
    expect(report.decision_count).toBe(0);
    const decisionsFile = JSON.parse(readFileSync(resolve(cacheDir, "decisions.json"), "utf8"));
    expect(decisionsFile).toEqual({ decisions: [], alternatives_by_decision_id: {} });
  });

  // Case: a real ADR-shaped markdown fixture, configured via .rvs/
  // decisions.yml, is discovered, classified (configured_path), parsed, and
  // normalized into a single ArchitectureDecision -- exercising
  // discovery.ts/source-classification.ts/markdown-parser.ts/
  // normalization.ts/identity.ts end-to-end. Also verifies alternatives.ts's
  // list-based extraction and decisions-analyze.ts's alternatives fold-in
  // into decisions.json's `alternatives_by_decision_id` map (there is no
  // dedicated DECISION_OUTPUT_FILES entry for alternatives).
  it("picks up a real ADR fixture and shapes decisions.json correctly, including the alternatives_by_decision_id fold-in", async () => {
    writeDecisionsConfig(repoRoot);
    writeAdrFixture(repoRoot);

    const logger = makeLogger();
    const result = await runDecisionAnalysis(repoRoot, logger);

    expect(logger.infos.some((m) => m === "Discovered 1 decision candidate(s); parsed 1 decision(s), 0 source issue(s).")).toBe(true);
    expect(result.snapshot.decisions).toHaveLength(1);
    const decision = result.snapshot.decisions[0];
    // frontmatter.id "ADR-0001" wins identity resolution (identity.ts's
    // DEFAULT_PREFERENCE_ORDER puts "frontmatter.id" first), and
    // buildDecisionId is a pure sanitize() pass-through for an
    // already-safe string (ids.ts).
    expect(decision.id).toBe("decision:ADR-0001");
    expect(decision.decision_status).toBe("accepted");
    expect(decision.source.classification_basis).toBe("configured_path");
    expect(decision.source.source_type).toBe("adr");

    const cacheDir = resolve(repoRoot, ".rvs/cache/decisions");
    const decisionsFile = JSON.parse(readFileSync(resolve(cacheDir, "decisions.json"), "utf8"));
    expect(decisionsFile.decisions).toHaveLength(1);
    expect(decisionsFile.decisions[0].id).toBe("decision:ADR-0001");
    const alternatives = decisionsFile.alternatives_by_decision_id["decision:ADR-0001"];
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map((a: { state: string }) => a.state).sort()).toEqual(["considered", "rejected"]);
    expect(alternatives.every((a: { statement: string }) => typeof a.statement === "string" && a.statement.length > 0)).toBe(true);
  });
});

describe("runDecisionsValidate --ci severity gate", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-decisions-validate-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: a decision whose frontmatter `supersedes` names a non-existent id
  // trips validation.ts's DECISION_BROKEN_SUPERSESSION_REFERENCE check,
  // which is TIER1 ("error"-severity). decisions-validate.ts increments
  // errorCount for every "error"-severity issue and, under --ci with
  // errorCount > 0, logs a summary error and sets process.exitCode = 1.
  it("sets process.exitCode = 1 under --ci when a broken supersession reference produces an error-severity finding", async () => {
    writeDecisionsConfig(repoRoot);
    writeBrokenSupersessionFixture(repoRoot);

    const logger = makeLogger();
    process.exitCode = undefined;
    await runDecisionsValidate(repoRoot, { ci: true }, logger);

    expect(process.exitCode).toBe(1);
    expect(logger.errors.some((m) => m.includes("[DECISION_BROKEN_SUPERSESSION_REFERENCE]") && m.includes('references supersession target "does-not-exist"'))).toBe(true);
    expect(logger.errors.some((m) => m.includes("Decision validation failed under --ci:") && m.includes("error-severity finding"))).toBe(true);
    process.exitCode = undefined;
  });

  // Case: with zero decisions (nothing configured/discovered), snapshot-level
  // checks (duplicate id, unsorted, invalid status, broken supersession) all
  // vacuously produce no issues, so errorCount stays 0 and --ci never touches
  // process.exitCode, even though a DECISION_PLAN_TOO_FEW_SCENES *warning*
  // may still be emitted (validation.ts line 223) -- that code is
  // deliberately absent from TIER1_ERROR_CODES, so it never counts toward
  // the --ci gate.
  it("does NOT set process.exitCode under --ci for a clean repo with zero decisions", async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await runDecisionsValidate(repoRoot, { ci: true }, logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.errors.some((m) => m.includes("Decision validation failed under --ci"))).toBe(false);
    process.exitCode = undefined;
  });
});

describe("runDecisionsCompare", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-decisions-compare-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: decisions-compare.ts's runDecisionsCompare throws immediately
  // (before touching the filesystem at all) when opts.from is unset -- the
  // very first line of the function.
  it("throws a clear error when --from is omitted", async () => {
    const logger = makeLogger();
    await expect(runDecisionsCompare(repoRoot, {}, logger)).rejects.toThrow("`rvs decisions compare` requires --from <path to a decision-snapshot.json>.");
  });

  // Case: readSnapshotFile (decisions-compare.ts's local helper) throws a
  // clear "No decision snapshot found at <resolved path>." error when the
  // --from path does not exist on disk -- verbatim message, including the
  // fully-resolved absolute path.
  it("throws a clear error naming the resolved path when --from references a nonexistent file", async () => {
    const logger = makeLogger();
    const missing = resolve(repoRoot, "nonexistent-snapshot.json");
    await expect(runDecisionsCompare(repoRoot, { from: "nonexistent-snapshot.json" }, logger)).rejects.toThrow(`No decision snapshot found at ${missing}.`);
  });

  // Case: a real compare, --from pointing at a decision-snapshot.json
  // written by a prior runDecisionAnalysis call, --to omitted (so a fresh
  // runDecisionAnalysis supplies the target). With zero decision candidates
  // configured in this repo, both the cached source snapshot and the fresh
  // target snapshot have empty `decisions`/`source_issues`, so
  // buildDecisionSnapshot's content-hash id (ids.ts's buildSnapshotId, over
  // an empty digest list) is byte-identical between the two runs --
  // deterministically producing compatibility.status "compatible"
  // (compatibility.ts never downgrades on schema/repository-id match) and
  // zero "changed" decisions (diff.ts's allIds set is empty).
  // decision-changes.json is written via writeDecisionOutputs.
  it("succeeds against a snapshot from a prior analysis, writing decision-changes.json", async () => {
    const firstLogger = makeLogger();
    await runDecisionsAnalyze(repoRoot, {}, firstLogger);
    const cacheDir = resolve(repoRoot, ".rvs/cache/decisions");
    expect(existsSync(resolve(cacheDir, "decision-snapshot.json"))).toBe(true);

    const logger = makeLogger();
    await expect(runDecisionsCompare(repoRoot, { from: ".rvs/cache/decisions/decision-snapshot.json" }, logger)).resolves.toBeUndefined();

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => /^Compared "decision:snapshot:.*" -> "decision:snapshot:.*" \(compatibility: "compatible"\): 0 changed decision\(s\) of 0\.$/.test(m))).toBe(true);
    expect(logger.infos.some((m) => m === "Wrote .rvs/cache/decisions/decision-changes.json.")).toBe(true);

    const changesPath = resolve(cacheDir, "decision-changes.json");
    expect(existsSync(changesPath)).toBe(true);
    const changeSet = JSON.parse(readFileSync(changesPath, "utf8")) as DecisionChangeSet;
    expect(changeSet.compatibility.status).toBe("compatible");
    expect(changeSet.changes).toEqual([]);
    expect(changeSet.source_snapshot_id).toBe(changeSet.target_snapshot_id);
  });
});

describe("runDecisionsExplain", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-decisions-explain-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: with no decision cache artifacts at all, decisions-explain.ts
  // reads all ten of its optional inputs as `undefined` via
  // readDecisionCachedJsonOptional (never throws for "missing cache"
  // itself), then calls explainDecisionId(), which throws a plain Error
  // naming exactly what it searched (explain.ts). That Error is caught
  // locally (decisions-explain.ts's try/catch) and turned into
  // logger.error + process.exitCode = 1 -- never a raw stack trace, and
  // never an uncaught rejection.
  it('sets process.exitCode = 1 and logs a clean "not found" message (never a raw stack trace, never a throw) for an unknown id with nothing cached', async () => {
    const logger = makeLogger();
    process.exitCode = undefined;
    await expect(runDecisionsExplain(repoRoot, "decision:does-not-exist", logger)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain(
      'No decision, assumption, consequence, link, conflict, drift, decision-debt, coverage, implementation-state, change, or supersession-chain found matching id "decision:does-not-exist"',
    );
    expect(logger.errors[0]).toContain("Run `rvs decisions analyze` first");
    // No raw stack trace / "at " frame leaked into the logged message.
    expect(logger.errors[0]).not.toMatch(/\n\s*at /);
    process.exitCode = undefined;
  });
});

describe("runExportDecisionReport / runExportDecisionSummary", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-decisions-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: export-decision-report.ts's runExportDecisionReport reads
  // decision-report.json via readDecisionCachedJson, which throws the
  // standard "Missing .rvs/cache/decisions/<file>. Run `rvs decisions
  // analyze` first." message (decision-cache.ts line 20) when the file was
  // never written by a prior `rvs decisions analyze`/`validate`.
  it("throws the standard missing-cache error when decision-report.json has never been written (export decision-report)", async () => {
    const logger = makeLogger();
    await expect(runExportDecisionReport(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/decisions/decision-report.json. Run `rvs decisions analyze` first.");
  });

  // Case: export-decision-summary.ts reads decision-narrative.json FIRST
  // (before decision-plan.json), so that is the exact missing-cache error
  // that surfaces, even though the ultimate output is a different file (a
  // Markdown summary, not the raw JSON report).
  it("throws the standard missing-cache error for decision-narrative.json (read before decision-plan.json) when nothing has been written (export decision-summary)", async () => {
    const logger = makeLogger();
    await expect(runExportDecisionSummary(repoRoot, {}, logger)).rejects.toThrow("Missing .rvs/cache/decisions/decision-narrative.json. Run `rvs decisions analyze` first.");
  });
});

describe("runCreateSlides --profile decisions", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-create-slides-decisions-"));
    writeBaseRepoFixtures(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: with repository-model.json/evidence-manifest.json/.rvs/config.yml
  // present (required unconditionally by every profile, read before any
  // profile branching) but no decision-plan.json ever cached,
  // runCreateDecisionsSlides (create-slides.ts lines 354-365) throws a
  // clear, specific error rather than reading DECISION_OUTPUT_FILES.
  // decisionPlan as `undefined` and crashing later on `plan.scenes`.
  it("throws a clear error when no cached decision plan exists (decisions analyze/validate never run)", async () => {
    const logger = makeLogger();
    await expect(runCreateSlides(repoRoot, undefined, logger, "decisions", {})).rejects.toThrow("No cached decision plan found. Run `rvs decisions analyze` first.");
  });
});
