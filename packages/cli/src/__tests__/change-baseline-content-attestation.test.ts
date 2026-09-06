// Milestone 11.3.3A-K2/B -- Baseline Content Attestation & Cache-Read
// Integrity. Verifies that persisted Knowledge Graph baselines used by
// `rvs change evaluate`/`rvs change explain` are verified through the
// canonical @rvs/knowledge-graph content-digest authority
// (verifyGraphContentDigest()) -- via resolveChangeWorkbenchBaseline()'s
// single seam -- before Workbench evaluation is allowed to proceed.
//
// Kept in its own file (rather than folded into change-cli.test.ts)
// because the mandatory Workbench-invocation-count-zero-on-mismatch proof
// (§6/§9 of the governing milestone) requires a module-level vi.mock of
// "@rvs/change-workbench" that wraps buildChangeAdvisory in a spy --
// scoping that mock to this file avoids any risk of altering
// change-cli.test.ts's existing 918-line assertion surface.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ChangeAdvisory } from "@rvs/change-workbench";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { buildGraphContentDigest } from "@rvs/knowledge-graph";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildChangeAdvisorySpy } = vi.hoisted(() => ({ buildChangeAdvisorySpy: vi.fn() }));

vi.mock("@rvs/change-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rvs/change-workbench")>();
  buildChangeAdvisorySpy.mockImplementation(actual.buildChangeAdvisory);
  return { ...actual, buildChangeAdvisory: buildChangeAdvisorySpy };
});

import { resolveChangeWorkbenchBaseline } from "../commands/change-baseline.js";
import { runChangeEvaluateCommand } from "../commands/change-evaluate.js";
import { runChangeExplainCommand } from "../commands/change-explain.js";
import { runChangeWorkbenchEvaluation } from "../commands/change-shared.js";
import { writeStoredChangeAdvisory } from "../change-workbench-cache.js";

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

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "rvs-change-attestation-"));
}

const REPO_ID = "test-repo";

function node(id: string, label: string): KnowledgeNode {
  return {
    id,
    node_type: "component",
    source_artifact: "architecture",
    source_entity_id: id,
    label,
    evidence_refs: [],
    resolution_status: "resolved",
    schema_version: 1,
    repository_id: REPO_ID,
    confidence: "confirmed",
  };
}

const NODE_A = node("node:service-a", "Service A");
const NODE_B = node("node:service-b", "Service B");

/**
 * Writes a full Knowledge Graph cache directory with explicit control over
 * the persisted snapshot's `content_digest` -- unlike change-cli.test.ts's
 * own writeGraphBaseline() (always legacy/no-digest by construction), this
 * helper is what lets these tests construct attested/missing/mismatch
 * fixtures deliberately.
 */
function writeAttestedGraphCache(
  repoRoot: string,
  opts: {
    nodes?: KnowledgeNode[];
    edges?: KnowledgeEdge[];
    contentDigest?: string | "omit";
    digest?: string;
  } = {},
): void {
  const nodes = opts.nodes ?? [NODE_A, NODE_B];
  const edges = opts.edges ?? [];
  const digest = opts.digest ?? "sha256-test-membership-digest";
  const dir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "nodes.json"), JSON.stringify(nodes, null, 2));
  writeFileSync(resolve(dir, "edges.json"), JSON.stringify(edges, null, 2));
  const snapshot: Record<string, unknown> = {
    id: "graph-snapshot:test",
    schema_version: 1,
    repository_id: REPO_ID,
    upstream_artifacts: [],
    node_count: nodes.length,
    edge_count: edges.length,
    digest,
  };
  if (opts.contentDigest !== "omit") {
    snapshot.content_digest = opts.contentDigest ?? buildGraphContentDigest(nodes, edges);
  }
  writeFileSync(resolve(dir, "graph-snapshot.json"), JSON.stringify(snapshot, null, 2));
}

function writeProposalFile(repoRoot: string, name: string, body: unknown): string {
  writeFileSync(resolve(repoRoot, name), JSON.stringify(body, null, 2));
  return name;
}

function validProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    repository_id: REPO_ID,
    title: "Rename Service A",
    operations: [{ kind: "modify_attributes", ref: NODE_A.id, attributes: { label: "Service A Renamed" } }],
    ...overrides,
  };
}

beforeEach(() => {
  buildChangeAdvisorySpy.mockClear();
});

// ---------------------------------------------------------------------------
// resolveChangeWorkbenchBaseline() -- the single seam (§7): tri-state
// resolution (§26-§27)
// ---------------------------------------------------------------------------

describe("resolveChangeWorkbenchBaseline -- content attestation tri-state", () => {
  it("reports 'attested' when the persisted content_digest matches the recomputed digest of the independently loaded nodes/edges", () => {
    const repoRoot = tempRepo();
    try {
      const contentDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      writeAttestedGraphCache(repoRoot, { contentDigest });
      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      expect(baseline.contentAttestation.status).toBe("attested");
      expect(baseline.contentAttestation.expected).toBe(contentDigest);
      expect(baseline.contentAttestation.actual).toBe(contentDigest);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports 'missing' -- never silently promoted to 'attested' -- for a legacy snapshot with no content_digest field at all", () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "omit" });
      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      expect(baseline.contentAttestation.status).toBe("missing");
      expect(baseline.contentAttestation.expected).toBeUndefined();
      expect(baseline.contentAttestation.actual).toBe(buildGraphContentDigest([NODE_A, NODE_B], []));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reports 'mismatch' -- distinct from 'missing' -- when a declared content_digest is present but does not equal the recomputed digest", () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "sha256-deliberately-wrong-digest" });
      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      expect(baseline.contentAttestation.status).toBe("mismatch");
      expect(baseline.contentAttestation.expected).toBe("sha256-deliberately-wrong-digest");
      expect(baseline.contentAttestation.actual).toBe(buildGraphContentDigest([NODE_A, NODE_B], []));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("stays 'attested' under a reordering of nodes.json/edges.json that changes array position but not semantic content -- content_digest is order-invariant", () => {
    const repoRoot = tempRepo();
    try {
      const contentDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      // Written in reverse array order on disk; buildGraphContentDigest
      // sorts by id internally, so the recomputed digest must be identical.
      writeAttestedGraphCache(repoRoot, { nodes: [NODE_B, NODE_A], contentDigest });
      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      expect(baseline.contentAttestation.status).toBe("attested");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("distinguishes file-absence (graph-snapshot.json missing entirely -> throws with `rvs graph build` guidance) from a present file with no content_digest (-> 'missing' status, no throw) -- never the same error/status code", () => {
    const repoRootAbsent = tempRepo();
    const repoRootPresentButLegacy = tempRepo();
    try {
      // graph-snapshot.json entirely absent -- an I/O failure, not an attestation state.
      const dir = resolve(repoRootAbsent, ".rvs/cache/knowledge-graph");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "nodes.json"), JSON.stringify([NODE_A, NODE_B], null, 2));
      writeFileSync(resolve(dir, "edges.json"), JSON.stringify([], null, 2));
      expect(() => resolveChangeWorkbenchBaseline(repoRootAbsent)).toThrow(/rvs graph build/);
      expect(() => resolveChangeWorkbenchBaseline(repoRootAbsent)).toThrow(/graph-snapshot\.json/);

      // graph-snapshot.json present, but content_digest genuinely absent (legacy/pre-K1) -- no throw.
      writeAttestedGraphCache(repoRootPresentButLegacy, { contentDigest: "omit" });
      expect(() => resolveChangeWorkbenchBaseline(repoRootPresentButLegacy)).not.toThrow();
      expect(resolveChangeWorkbenchBaseline(repoRootPresentButLegacy).contentAttestation.status).toBe("missing");
    } finally {
      rmSync(repoRootAbsent, { recursive: true, force: true });
      rmSync(repoRootPresentButLegacy, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Same node IDs, different semantic content -> mismatch (the exact gap K1's
// membership-only GraphSnapshot.digest could never detect, per §21/§35).
// ---------------------------------------------------------------------------

describe("same node ids, changed semantic content -> mismatch (closes the K1-motivating gap)", () => {
  it("detects a changed node label under unchanged node ids as 'mismatch', and blocks Workbench evaluation for it", () => {
    const repoRoot = tempRepo();
    try {
      const originalDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      writeAttestedGraphCache(repoRoot, { contentDigest: originalDigest });

      // Simulates a torn/edited cache: nodes.json is rewritten with the
      // SAME ids (so GraphSnapshot.digest, a membership-only identity,
      // would remain unchanged) but different semantic content (label) --
      // the persisted content_digest was never recomputed to match.
      const mutatedNodeA: KnowledgeNode = { ...NODE_A, label: "Service A (silently altered)" };
      writeFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), JSON.stringify([mutatedNodeA, NODE_B], null, 2));

      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      expect(baseline.contentAttestation.status).toBe("mismatch");
      expect(baseline.contentAttestation.expected).toBe(originalDigest);
      expect(baseline.contentAttestation.actual).not.toBe(originalDigest);

      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      expect(outcome.outcome).toBe("blocked");
      expect(buildChangeAdvisorySpy).not.toHaveBeenCalled();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Mandatory: Workbench invocation-ordering proof (§6/§9). Must fail if the
// implementation ever evaluates-then-checks rather than checks-then-evaluates.
// ---------------------------------------------------------------------------

describe("Workbench invocation gate (§6/§9 -- mandatory)", () => {
  it("never invokes buildChangeAdvisory() when the baseline's content attestation is 'mismatch' -- checked BEFORE evaluation, not inferred from output", () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "sha256-deliberately-wrong-digest" });
      writeProposalFile(repoRoot, "proposal.json", validProposal());

      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");

      expect(outcome.outcome).toBe("blocked");
      expect(buildChangeAdvisorySpy).toHaveBeenCalledTimes(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("invokes buildChangeAdvisory() exactly once for an 'attested' baseline -- proving the gate does not also suppress the normal path", () => {
    const repoRoot = tempRepo();
    try {
      const contentDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      writeAttestedGraphCache(repoRoot, { contentDigest });
      writeProposalFile(repoRoot, "proposal.json", validProposal());

      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");

      expect(outcome.outcome).toBe("evaluated");
      expect(buildChangeAdvisorySpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("invokes buildChangeAdvisory() exactly once for a 'missing' (legacy) baseline -- missing is non-blocking", () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "omit" });
      writeProposalFile(repoRoot, "proposal.json", validProposal());

      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");

      expect(outcome.outcome).toBe("evaluated");
      expect(buildChangeAdvisorySpy).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `rvs change evaluate` -- CLI-layer disclosure/blocking behavior (§11)
// ---------------------------------------------------------------------------

describe("runChangeEvaluateCommand -- content attestation disclosure/blocking", () => {
  it("'missing': evaluation proceeds (non-blocking) AND the legacy/unattested state is deterministically disclosed -- never silently discarded", async () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "omit" });
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);

      expect(logger.errors).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      expect(logger.infos.some((m) => /missing/i.test(m))).toBe(true);
      expect(logger.infos.join(" ")).not.toMatch(/\bunsafe\b|\bcorrupt\b|\binvalid\b|\bcompromised\b/i);

      const written = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8")) as ChangeAdvisory & {
        baseline_content_attestation?: { status: string };
      };
      expect(written.baseline_content_attestation?.status).toBe("missing");
      // The advisory itself is still the full, real ChangeAdvisory -- disclosure is additive, not a replacement wrapper.
      expect(written.id).toBeDefined();
      expect(written.domain_coverage).toBeDefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("'attested': evaluation proceeds exactly once, with no regression, and the attested state is observable in the --output structured contract", async () => {
    const repoRoot = tempRepo();
    try {
      const contentDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      writeAttestedGraphCache(repoRoot, { contentDigest });
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);

      expect(logger.errors).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      expect(buildChangeAdvisorySpy).toHaveBeenCalledTimes(1);

      const written = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8")) as ChangeAdvisory & {
        baseline_content_attestation?: { status: string };
      };
      expect(written.baseline_content_attestation?.status).toBe("attested");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("'mismatch': hard-blocks BEFORE Workbench evaluation with a deterministic error, exitCode 1, and writes a distinct {status:'blocked'} shape -- never the ChangeAdvisory shape", async () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "sha256-deliberately-wrong-digest" });
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);

      expect(buildChangeAdvisorySpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(logger.errors.some((m) => m.includes("Persisted graph content does not match the content digest declared by the graph snapshot"))).toBe(true);
      // §39: no speculation about cause.
      expect(logger.errors.join(" ")).not.toMatch(/\battack\b|\btamper|\bcorrupt/i);

      const written = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8"));
      expect(written.status).toBe("blocked");
      expect(written.reason).toBe("content_attestation_mismatch");
      expect(written.baseline_content_attestation.status).toBe("mismatch");
      expect("id" in written).toBe(false);
      expect("domain_coverage" in written).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("preserves existing repository-compatibility validation (repository_id_mismatch) unchanged under a 'missing' content attestation baseline -- content attestation neither suppresses nor replaces it", async () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "omit" });
      writeProposalFile(
        repoRoot,
        "proposal.json",
        validProposal({
          operations: [
            {
              kind: "add_entity",
              ref: "node:new-entity-1",
              node_type: "component",
              source_artifact: "architecture",
              proposed_source_entity_id: "new-1",
              label: "New Component",
              repository_id: "a-different-repository",
            },
          ],
        }),
      );

      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      expect(outcome.outcome).toBe("evaluated");
      const advisory = outcome.outcome === "evaluated" ? outcome.advisory : undefined;
      expect(advisory?.proposal_validation.status).toBe("invalid");
      expect(advisory?.proposal_validation.issues.some((i) => i.code === "repository_id_mismatch")).toBe(true);
      expect(outcome.outcome === "evaluated" ? outcome.contentAttestation.status : undefined).toBe("missing");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `rvs change explain` -- all three states (§12)
// ---------------------------------------------------------------------------

describe("runChangeExplainCommand -- content attestation (all three states)", () => {
  function cacheAdvisory(repoRoot: string, baseSnapshotDigest: string): ChangeAdvisory {
    const advisory: ChangeAdvisory = {
      schema_version: 1,
      id: "change-workbench:advisory:test-repo:attestation0001",
      proposal_id: "change-workbench:proposal:test-repo:attestation0001",
      repository_id: REPO_ID,
      base_snapshot_digest: baseSnapshotDigest,
      proposal_validation: { status: "valid_sufficient", issues: [] },
      topology: [],
      impact: { status: "not_evaluated", detail: "not evaluated", directly_affected_refs: [], transitively_affected_refs: [], blast_radius_level: "low", unresolved_downstream_impact: false, truncated: false },
      governance: { status: "not_evaluated", detail: "not evaluated", findings: [] },
      decisions: { status: "not_evaluated", detail: "not evaluated", findings: [], capability_registry: [] },
      domain_coverage: [],
      evidence_refs: [],
    };
    writeStoredChangeAdvisory(repoRoot, { advisory, base_snapshot_digest_at_store_time: advisory.base_snapshot_digest });
    return advisory;
  }

  it("'attested': proceeds normally, no forced disclosure, and freshness is still reported", async () => {
    const repoRoot = tempRepo();
    try {
      const contentDigest = buildGraphContentDigest([NODE_A, NODE_B], []);
      writeAttestedGraphCache(repoRoot, { contentDigest, digest: "sha256-membership-digest-fixed" });
      const advisory = cacheAdvisory(repoRoot, "sha256-membership-digest-fixed");

      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);

      expect(logger.errors).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      expect(logger.infos.some((m) => m.includes(advisory.id))).toBe(true);
      expect(logger.infos.some((m) => m.trim() === "Advisory freshness: current")).toBe(true);
      expect(logger.infos.some((m) => /content attestation/i.test(m))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("'missing': proceeds (non-blocking) and discloses the legacy/unattested baseline using only permitted wording", async () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "omit", digest: "sha256-membership-digest-fixed" });
      const advisory = cacheAdvisory(repoRoot, "sha256-membership-digest-fixed");

      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);

      expect(logger.errors).toEqual([]);
      expect(process.exitCode).not.toBe(1);
      expect(logger.infos.some((m) => m.includes(advisory.id))).toBe(true);
      expect(logger.infos.some((m) => /content attestation.*missing/i.test(m))).toBe(true);
      const joined = logger.infos.join(" ").toLowerCase();
      expect(joined).not.toMatch(/\bunsafe\b|\bcorrupt\b|\binvalid\b|\bcompromised\b/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("'mismatch': hard-blocks BEFORE any narration is printed -- deterministic error, exitCode 1, zero advisory narration lines", async () => {
    const repoRoot = tempRepo();
    try {
      writeAttestedGraphCache(repoRoot, { contentDigest: "sha256-deliberately-wrong-digest", digest: "sha256-membership-digest-fixed" });
      const advisory = cacheAdvisory(repoRoot, "sha256-membership-digest-fixed");

      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);

      expect(process.exitCode).toBe(1);
      expect(logger.errors.some((m) => m.includes("Persisted graph content does not match the content digest declared by the graph snapshot"))).toBe(true);
      // No narration of any kind leaked before the block.
      expect(logger.infos.some((m) => m.includes(advisory.id))).toBe(false);
      expect(logger.infos.length).toBe(0);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Audits (§P/§35): single digest authority + no Workbench production
// contract change. Static source scans, mirroring change-cli.test.ts's own
// "security" describe block's established source-audit pattern.
// ---------------------------------------------------------------------------

describe("Milestone 11.3.3A-K2/B -- boundary audits", () => {
  it("the canonical content-digest functions are defined exactly once, only in @rvs/knowledge-graph, and are never reimplemented in the CLI", () => {
    const snapshotSource = readFileSync(fileUrlToLocalPath("../../../knowledge-graph/src/snapshot.ts"), "utf8");
    expect((snapshotSource.match(/export function buildGraphContentDigest\(/g) ?? []).length).toBe(1);
    expect((snapshotSource.match(/export function verifyGraphContentDigest\(/g) ?? []).length).toBe(1);

    const baselineSource = readFileSync(fileUrlToLocalPath("../commands/change-baseline.ts"), "utf8");
    expect(baselineSource).toMatch(/verifyGraphContentDigest\(/);
    expect(baselineSource).not.toMatch(/buildGraphContentDigest\(/);
    expect(baselineSource).not.toMatch(/digestOf\(|canonicalize\(/);
  });

  it("no production Workbench file (packages/change-workbench/src) references contentAttestation/content_digest -- K2/B adds no Workbench transport contract", () => {
    const files = ["contracts.ts", "evaluation.ts", "change-advisory.ts", "impact-advisory.ts", "governance-advisory.ts", "decision-advisory.ts", "persistence.ts", "validation.ts", "overlay.ts"];
    for (const file of files) {
      const source = readFileSync(fileUrlToLocalPath(`../../../change-workbench/src/${file}`), "utf8");
      expect(source, `${file} unexpectedly references content attestation`).not.toMatch(/contentAttestation|content_digest|ContentDigestVerification|ContentAttestationStatus/);
    }
  });

  it("evaluate/explain perform no cache write -- neither command's source references writeFile/writeFileSync/writeGraphOutputs against the knowledge-graph cache", () => {
    const evaluateSource = readFileSync(fileUrlToLocalPath("../commands/change-evaluate.ts"), "utf8");
    const explainSource = readFileSync(fileUrlToLocalPath("../commands/change-explain.ts"), "utf8");
    const baselineSource = readFileSync(fileUrlToLocalPath("../commands/change-baseline.ts"), "utf8");
    expect(explainSource).not.toMatch(/writeFile|writeGraphOutputs/);
    expect(baselineSource).not.toMatch(/writeFile|writeGraphOutputs/);
    // change-evaluate.ts legitimately writes the CLI's OWN --output/--cache
    // artifacts (unrelated to the Knowledge Graph cache) -- assert it never
    // touches the knowledge-graph cache directory specifically.
    expect(evaluateSource).not.toMatch(/knowledge-graph.*writeFile|writeGraphOutputs/);
  });
});

function fileUrlToLocalPath(relativePath: string): string {
  return new URL(relativePath, import.meta.url).pathname;
}
