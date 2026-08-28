import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RUN_RETENTION,
  allocateRun,
  candidateAbsolutePath,
  pruneRuns,
  stageCandidate,
  type DeliveryRun,
} from "../candidate.js";
import { HISTORY_LIMIT, readVerifiedHistory, targetStateDirectory, verificationIsStale, withPromotion, writeVerifiedHistory } from "../history.js";
import { digestOfBytes } from "../ids.js";
import { DeliveryPathError, deliveryRoot } from "../security.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION, type VerifiedVisualArtifact } from "../contracts.js";

// Staging and the verified record.
//
// Two invariants carry the whole module. A candidate is written somewhere that
// is not the target and is written completely before anything reads it --
// generating into the target means a failed validation has already destroyed
// what it was protecting, and validating a half-written file means measuring a
// document nobody generated. And the record of what passed is metadata only
// and bounded, because a cache that keeps five copies of a megabyte explorer
// is larger than the repository it describes.

const TARGET = ".rvs/out/architecture-explorer.html";

function stage(repoRoot: string, run: DeliveryRun, html: string, overrides: Partial<Parameters<typeof stageCandidate>[0]> = {}) {
  return stageCandidate({
    repoRoot,
    run,
    artifact_type: "architecture_explorer",
    target_path: TARGET,
    html,
    visual_spec_id: "vspec_abc",
    source_digest: "a".repeat(64),
    validation_profile: "visual-standard-v1",
    metadata: { producer: "rvs graph open", source_snapshot_ids: [], upstream_artifact_ids: [] },
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("run allocation", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-stage-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("starts at generation 1 and hands out strictly increasing generations", () => {
    const generations = Array.from({ length: 4 }, () => allocateRun(repoRoot).generation);
    expect(generations).toEqual([1, 2, 3, 4]);
  });

  it("gives every run its own directory, and never the same one twice", () => {
    const runs = Array.from({ length: 4 }, () => allocateRun(repoRoot));
    expect(new Set(runs.map((run) => run.directory)).size).toBe(4);
    for (const run of runs) {
      expect(existsSync(run.directory)).toBe(true);
      expect(run.run_id).toMatch(/^run-\d{6}$/);
    }
  });

  it("resumes after the highest generation that already exists, not after the count of them", () => {
    // A pruned cache has gaps. Numbering from the count would reissue a
    // generation that has already been promoted, which is exactly the number
    // promotion ordering trusts.
    mkdirSync(join(deliveryRoot(repoRoot), "runs", "run-000042"), { recursive: true });
    expect(allocateRun(repoRoot).generation).toBe(43);
  });

  it("keeps the delivery root inside the cache, never beside the target", () => {
    const run = allocateRun(repoRoot);
    expect(run.directory.startsWith(deliveryRoot(repoRoot))).toBe(true);
  });
});

describe("candidate staging", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-stage-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("writes the candidate into the run directory and leaves the target untouched", () => {
    const run = allocateRun(repoRoot);
    const candidate = stage(repoRoot, run, "<!doctype html><title>a</title>");

    expect(existsSync(join(repoRoot, TARGET))).toBe(false);
    expect(candidate.source_path.startsWith(".rvs/cache/visual-delivery/runs/")).toBe(true);
    expect(readFileSync(candidateAbsolutePath(repoRoot, candidate), "utf8")).toBe("<!doctype html><title>a</title>");
  });

  it("leaves no partial file behind, so nothing can validate a half-written document", () => {
    const run = allocateRun(repoRoot);
    stage(repoRoot, run, "<!doctype html><title>a</title>");
    expect(readdirSync(run.directory).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("digests the bytes that are on disk", () => {
    const run = allocateRun(repoRoot);
    const html = "<!doctype html><title>a</title>";
    const candidate = stage(repoRoot, run, html);
    expect(candidate.artifact_digest).toBe(digestOfBytes(readFileSync(candidateAbsolutePath(repoRoot, candidate))));
    expect(candidate.artifact_digest).toBe(digestOfBytes(Buffer.from(html, "utf8")));
  });

  it("gives two runs over identical inputs the same candidate id and different run identity", () => {
    const first = stage(repoRoot, allocateRun(repoRoot), "<!doctype html><title>a</title>");
    const second = stage(repoRoot, allocateRun(repoRoot), "<!doctype html><title>a</title>");

    expect(second.candidate_id).toBe(first.candidate_id);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.run_id).not.toBe(first.run_id);
    expect(second.source_path).not.toBe(first.source_path);
  });

  it("gives a changed artifact a different candidate id", () => {
    const first = stage(repoRoot, allocateRun(repoRoot), "<!doctype html><title>a</title>");
    const second = stage(repoRoot, allocateRun(repoRoot), "<!doctype html><title>b</title>");
    expect(second.candidate_id).not.toBe(first.candidate_id);
  });

  it("records the target it is destined for, repository-relative", () => {
    const candidate = stage(repoRoot, allocateRun(repoRoot), "<html>", { target_path: join(repoRoot, TARGET) });
    expect(candidate.target_path).toBe(TARGET);
  });

  it("refuses a target outside the repository before writing anything", () => {
    const outside = mkdtempSync(join(tmpdir(), "rvs-outside-"));
    try {
      const run = allocateRun(repoRoot);
      expect(() => stage(repoRoot, run, "<html>", { target_path: join(outside, "x.html") })).toThrow(DeliveryPathError);
      expect(readdirSync(run.directory)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("stages into a repository whose path has spaces in it", () => {
    const spaced = join(repoRoot, "My Repos", "repo visual studio");
    mkdirSync(spaced, { recursive: true });
    const candidate = stage(spaced, allocateRun(spaced), "<html>", {
      repoRoot: spaced,
      target_path: "artifacts/visuals/change review.html",
    });
    expect(candidate.target_path).toBe("artifacts/visuals/change review.html");
    expect(readFileSync(candidateAbsolutePath(spaced, candidate), "utf8")).toBe("<html>");
  });
});

describe("run retention", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-prune-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function runNames(): string[] {
    return readdirSync(join(deliveryRoot(repoRoot), "runs")).sort();
  }

  it("keeps a bounded window of runs, oldest removed first", () => {
    const runs = Array.from({ length: RUN_RETENTION + 3 }, () => allocateRun(repoRoot));
    const removed = pruneRuns(repoRoot);
    expect(removed).toEqual(runs.slice(0, 3).map((run) => run.run_id));
    expect(runNames()).toEqual(runs.slice(3).map((run) => run.run_id).sort());
  });

  it("never removes the run that is currently going", () => {
    Array.from({ length: RUN_RETENTION + 2 }, () => allocateRun(repoRoot));
    const current = allocateRun(repoRoot);
    pruneRuns(repoRoot, 1, [current.run_id]);
    expect(runNames()).toContain(current.run_id);
  });

  it("does nothing at all when there is no delivery root yet", () => {
    const empty = mkdtempSync(join(tmpdir(), "rvs-empty-"));
    try {
      expect(pruneRuns(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("leaves directories that are not runs alone", () => {
    allocateRun(repoRoot);
    mkdirSync(join(deliveryRoot(repoRoot), "runs", "notes"), { recursive: true });
    pruneRuns(repoRoot, 0);
    expect(runNames()).toEqual(["notes"]);
  });
});

describe("the verified record", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-history-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function verified(overrides: Partial<VerifiedVisualArtifact> = {}): VerifiedVisualArtifact {
    return {
      verified_artifact_id: "vva_1",
      schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
      artifact_digest: "b".repeat(64),
      visual_spec_id: "vspec_abc",
      source_digest: "a".repeat(64),
      verification_digest: "c".repeat(64),
      verified_at: "2026-01-01T00:00:00.000Z",
      candidate_id: "vdc_1",
      generation: 1,
      target_path: TARGET,
      artifact_type: "architecture_explorer",
      profile_id: "visual-standard-v1",
      profile_version: "v1",
      validator_summary: { families: [], checks_run: 0, findings_blocking: 0, findings_warning: 0 },
      ...overrides,
    };
  }

  it("reads as 'nothing has ever been verified here' before anything has been", () => {
    const history = readVerifiedHistory(repoRoot, TARGET);
    expect(history.current).toBeNull();
    expect(history.previous).toEqual([]);
  });

  it("round-trips what was written", () => {
    writeVerifiedHistory(repoRoot, { schema_version: 1, target_path: TARGET, current: verified(), previous: [] });
    expect(readVerifiedHistory(repoRoot, TARGET).current?.verified_artifact_id).toBe("vva_1");
  });

  it("keeps records per target, so one target's history says nothing about another's", () => {
    writeVerifiedHistory(repoRoot, { schema_version: 1, target_path: TARGET, current: verified(), previous: [] });
    expect(readVerifiedHistory(repoRoot, "artifacts/visuals/change-review.html").current).toBeNull();
  });

  it("reads an unreadable record conservatively, as nothing verified rather than as verified", () => {
    // The conservative direction matters: this can only cause an extra
    // verification, never a promotion that should not have happened.
    const directory = targetStateDirectory(repoRoot, TARGET);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "verified.json"), "{ not json");
    expect(readVerifiedHistory(repoRoot, TARGET).current).toBeNull();
  });

  it("leaves no partial file behind when it writes", () => {
    writeVerifiedHistory(repoRoot, { schema_version: 1, target_path: TARGET, current: verified(), previous: [] });
    expect(readdirSync(targetStateDirectory(repoRoot, TARGET))).toEqual(["verified.json"]);
  });

  it("moves the current record to the head of the previous list on each promotion", () => {
    let history = readVerifiedHistory(repoRoot, TARGET);
    history = withPromotion(history, verified({ verified_artifact_id: "vva_1", generation: 1 }));
    history = withPromotion(history, verified({ verified_artifact_id: "vva_2", generation: 2 }));

    expect(history.current?.verified_artifact_id).toBe("vva_2");
    expect(history.previous.map((entry) => entry.verified_artifact_id)).toEqual(["vva_1"]);
  });

  it("caps the retained history, so the cache cannot grow without bound", () => {
    let history = readVerifiedHistory(repoRoot, TARGET);
    for (let generation = 1; generation <= HISTORY_LIMIT + 4; generation += 1) {
      history = withPromotion(history, verified({ verified_artifact_id: `vva_${generation}`, generation }));
    }
    expect(history.previous).toHaveLength(HISTORY_LIMIT);
    expect(history.previous[0]?.verified_artifact_id).toBe(`vva_${HISTORY_LIMIT + 3}`);
    // Metadata only: no artifact bytes are kept anywhere in the record.
    expect(JSON.stringify(history)).not.toContain("<!doctype");
  });
});

describe("stale verification", () => {
  const record: VerifiedVisualArtifact = {
    verified_artifact_id: "vva_1",
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    artifact_digest: "b".repeat(64),
    visual_spec_id: "vspec_abc",
    source_digest: "a".repeat(64),
    verification_digest: "c".repeat(64),
    verified_at: "2026-01-01T00:00:00.000Z",
    candidate_id: "vdc_1",
    generation: 1,
    target_path: TARGET,
    artifact_type: "architecture_explorer",
    profile_id: "visual-interactive-v1",
    profile_version: "v1",
    validator_summary: { families: [], checks_run: 0, findings_blocking: 0, findings_warning: 0 },
  };

  it("is not stale while the same profile and the same rules are being asked about", () => {
    expect(verificationIsStale(record, "visual-interactive-v1", "v1", "c".repeat(64))).toBe(false);
  });

  it("is stale under a different profile", () => {
    expect(verificationIsStale(record, "visual-print-v1", "v1", "c".repeat(64))).toBe(true);
  });

  it("is stale under a later version of the same profile", () => {
    expect(verificationIsStale(record, "visual-interactive-v1", "v2", "c".repeat(64))).toBe(true);
  });

  it("is stale when the artifact is unchanged but a threshold moved under it", () => {
    // Same bytes, same profile id, different configuration: the record still
    // says truthfully what it passed, and what it passed is no longer the
    // question being asked. Not failed, and never silently re-labelled.
    expect(verificationIsStale(record, "visual-interactive-v1", "v1", "d".repeat(64))).toBe(true);
  });
});
