// Milestone 11.2 -- CLI-layer test suite for the `rvs change` command family
// (validate/evaluate/explain). Exercises the ACTUAL control flow read from
// packages/cli/src/commands/change-{decode,baseline,shared,presentation,
// validate,evaluate,explain}.ts and packages/cli/src/change-workbench-cache.ts,
// plus the underlying @rvs/change-workbench package (decode.ts/validation.ts/
// change-advisory.ts/ids.ts), against a temp repoRoot + fake Logger, in-process
// -- no subprocess spawning -- matching decisions-cli.test.ts's/
// governance-cli.test.ts's established convention.
//
// Covers: the validation/security/determinism/agent-parity matrix (§37),
// determinism proof (§27/§38), agent-parity proof (§29), and security proof
// (§39) from the governing Milestone 11.2 task.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "@rvs/core";
import {
  buildChangeAdvisory,
  CHANGE_WORKBENCH_ADVISORIES_DIR,
  decodeProposedChangeSet,
  MAX_OBJECT_KEYS,
  MAX_OPERATION_COUNT,
  MAX_SERIALIZED_BYTES,
  validateProposedChangeSet,
} from "@rvs/change-workbench";
import type { ChangeAdvisory, StoredChangeAdvisory } from "@rvs/change-workbench";
import type { KnowledgeNode } from "@rvs/knowledge-graph";
import { describe, expect, it } from "vitest";
import { resolveChangeWorkbenchBaseline } from "../commands/change-baseline.js";
import { runChangeEvaluateCommand } from "../commands/change-evaluate.js";
import { runChangeExplainCommand } from "../commands/change-explain.js";
import { runChangeValidateCommand } from "../commands/change-validate.js";
import { runChangeWorkbenchEvaluation, runChangeWorkbenchValidation } from "../commands/change-shared.js";
import { sanitizeTerminalText } from "../commands/change-presentation.js";
import { findStoredChangeAdvisoryById, writeStoredChangeAdvisory } from "../change-workbench-cache.js";

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
  return mkdtempSync(join(tmpdir(), "rvs-change-cli-"));
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

function writeGraphBaseline(repoRoot: string, nodes: KnowledgeNode[] = [NODE_A, NODE_B], digest = "sha256-test-baseline-digest-0001"): void {
  const dir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "nodes.json"), JSON.stringify(nodes, null, 2));
  writeFileSync(resolve(dir, "edges.json"), JSON.stringify([], null, 2));
  writeFileSync(
    resolve(dir, "graph-snapshot.json"),
    JSON.stringify(
      { id: "graph-snapshot:test", schema_version: 1, repository_id: REPO_ID, upstream_artifacts: [], node_count: nodes.length, edge_count: 0, digest },
      null,
      2,
    ),
  );
}

function writeProposalFile(repoRoot: string, name: string, body: unknown): string {
  writeFileSync(resolve(repoRoot, name), JSON.stringify(body, null, 2));
  return name;
}

// An object literal's `__proto__: ...` key sets the object's actual
// prototype rather than creating an own enumerable property, so
// `JSON.stringify` on a JS object never emits it. This writes raw JSON
// TEXT containing a literal `"__proto__"` key instead, exactly matching
// what `JSON.parse` on untrusted input produces (a real own property named
// "__proto__", the actual prototype-pollution vector this package's decode
// boundary rejects).
function writeHostileProtoProposalFile(repoRoot: string, name: string): string {
  const hostile = `{"schema_version":1,"repository_id":"${REPO_ID}","operations":[{"kind":"modify_attributes","ref":"${NODE_A.id}","attributes":{"label":"x","__proto__":{"polluted":true}}}]}`;
  writeFileSync(resolve(repoRoot, name), hostile);
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

// ---------------------------------------------------------------------------
// `rvs change validate`
// ---------------------------------------------------------------------------

describe("runChangeValidateCommand", () => {
  it("prints VALID PROPOSAL and leaves exitCode untouched for a well-formed proposal with a matching baseline present (valid_sufficient)", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.infos.some((m) => m.startsWith("VALID PROPOSAL (valid_sufficient)"))).toBe(true);
      expect(logger.errors).toEqual([]);
      expect(process.exitCode).not.toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("does NOT require a Knowledge Graph baseline to exist -- degrades to a non-blocking unresolved_confirmation_context issue instead of failing", async () => {
    const repoRoot = tempRepo();
    try {
      // deliberately no writeGraphBaseline() call
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.infos.some((m) => m.startsWith("VALID PROPOSAL (unresolved)"))).toBe(true);
      expect(logger.warns.some((m) => m.includes("unresolved_confirmation_context"))).toBe(true);
      expect(process.exitCode).not.toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  for (const [label, schemaVersion] of [
    ["unsupported numeric schema_version 2", 2],
    ["missing schema_version", undefined],
    ["string-typed schema_version \"1\"", "1"],
    ["null schema_version", null],
  ] as const) {
    it(`rejects ${label} deterministically as INVALID PROPOSAL with code unsupported_schema_version, exitCode 1`, async () => {
      const repoRoot = tempRepo();
      try {
        writeGraphBaseline(repoRoot);
        const body: Record<string, unknown> = validProposal();
        if (schemaVersion === undefined) delete body.schema_version;
        else body.schema_version = schemaVersion;
        writeProposalFile(repoRoot, "proposal.json", body);
        const logger = makeLogger();
        process.exitCode = undefined;
        await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
        expect(logger.errors.some((m) => m === "INVALID PROPOSAL")).toBe(true);
        expect(logger.errors.some((m) => m.includes("unsupported_schema_version"))).toBe(true);
        expect(process.exitCode).toBe(1);
      } finally {
        rmSync(repoRoot, { recursive: true, force: true });
      }
    });
  }

  it("accepts schema_version 1 (the one supported version) without an unsupported_schema_version issue", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal({ schema_version: 1 }));
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("unsupported_schema_version"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects an unrecognized operation kind deterministically as INVALID PROPOSAL with code unsupported_operation_kind, exitCode 1", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(
        repoRoot,
        "proposal.json",
        validProposal({ operations: [{ kind: "delete_everything", ref: NODE_A.id }] }),
      );
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m === "INVALID PROPOSAL")).toBe(true);
      expect(logger.errors.some((m) => m.includes("unsupported_operation_kind"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a missing file with a file_not_found decode issue, exitCode 1", async () => {
    const repoRoot = tempRepo();
    try {
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "does-not-exist.json" }, logger);
      expect(logger.errors.some((m) => m.includes("file_not_found"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON syntax with a malformed_json decode issue, exitCode 1", async () => {
    const repoRoot = tempRepo();
    try {
      writeFileSync(resolve(repoRoot, "proposal.json"), "{ not valid json ");
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("malformed_json"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects an oversized proposal file (> MAX_SERIALIZED_BYTES) via a byte-length precheck, exitCode 1, without ever reading the whole file into a JSON.parse call", async () => {
    const repoRoot = tempRepo();
    try {
      const oversized = { schema_version: 1, repository_id: REPO_ID, operations: [], padding: "x".repeat(MAX_SERIALIZED_BYTES + 1024) };
      writeProposalFile(repoRoot, "proposal.json", oversized);
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("input_too_large"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a __proto__-shaped key anywhere in the document as prototype_pollution_shaped_key, exitCode 1", async () => {
    const repoRoot = tempRepo();
    try {
      writeHostileProtoProposalFile(repoRoot, "proposal.json");
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("prototype_pollution_shaped_key"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a proposal exceeding MAX_OPERATION_COUNT as too_many_operations", async () => {
    const repoRoot = tempRepo();
    try {
      const operations = Array.from({ length: MAX_OPERATION_COUNT + 1 }, (_, i) => ({ kind: "remove_entity", ref: `node:generated-${i}` }));
      writeProposalFile(repoRoot, "proposal.json", validProposal({ operations }));
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("too_many_operations"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("rejects a JSON object exceeding MAX_OBJECT_KEYS anywhere in the document (a resource bound, not a semantic proposal defect) as resource_bound_exceeded", async () => {
    const repoRoot = tempRepo();
    try {
      const hostileAttributes: Record<string, string> = {};
      for (let i = 0; i < MAX_OBJECT_KEYS + 1; i++) hostileAttributes[`key_${i}`] = "v";
      writeProposalFile(
        repoRoot,
        "proposal.json",
        validProposal({ operations: [{ kind: "modify_attributes", ref: NODE_A.id, attributes: hostileAttributes }] }),
      );
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(logger.errors.some((m) => m.includes("resource_bound_exceeded"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes a small CLI-local {status, proposal_id, repository_id, issues} wrapper to --output for a validated (post-decode) proposal", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "proposal.json", output: "result.json" }, logger);
      const written = JSON.parse(readFileSync(resolve(repoRoot, "result.json"), "utf8"));
      expect(written.status).toBe("valid_sufficient");
      expect(typeof written.proposal_id).toBe("string");
      expect(written.repository_id).toBe(REPO_ID);
      expect(Array.isArray(written.issues)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("writes the minimal {status:'invalid', issues} wrapper (no proposal_id/repository_id) to --output for a pre-decode rejection", async () => {
    const repoRoot = tempRepo();
    try {
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "missing.json", output: "result.json" }, logger);
      const written = JSON.parse(readFileSync(resolve(repoRoot, "result.json"), "utf8"));
      expect(written).toEqual({ status: "invalid", issues: expect.any(Array) });
      expect("proposal_id" in written).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("throws when --file is omitted, without ever touching the filesystem", async () => {
    const repoRoot = tempRepo();
    try {
      const logger = makeLogger();
      await expect(runChangeValidateCommand(repoRoot, {}, logger)).rejects.toThrow("--file <proposal.json>");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `rvs change evaluate`
// ---------------------------------------------------------------------------

describe("runChangeEvaluateCommand", () => {
  it("fails with rvs-graph-build guidance when no Knowledge Graph baseline is cached -- never silently auto-builds one", async () => {
    const repoRoot = tempRepo();
    try {
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      await expect(runChangeEvaluateCommand(repoRoot, { file: "proposal.json" }, logger)).rejects.toThrow(/rvs graph build/);
      // no partial/failed cache artifacts left behind by the aborted attempt
      expect(existsSync(resolve(repoRoot, ".rvs/cache/change-workbench"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("produces an ADVISORY COMPLETE with the exact resolved base_snapshot_digest echoed back, for a valid proposal against a present baseline", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot, [NODE_A, NODE_B], "sha256-fixed-digest-abc123");
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);
      expect(logger.infos.some((m) => m === "ADVISORY COMPLETE" || m === "ADVISORY PARTIAL" || m === "ADVISORY UNRESOLVED")).toBe(true);
      expect(logger.infos.some((m) => m.includes("SAFE") || m.includes("APPROVED") || m.includes("NO RISK"))).toBe(false);
      const advisory = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8")) as ChangeAdvisory;
      expect(advisory.base_snapshot_digest).toBe("sha256-fixed-digest-abc123");
      expect(process.exitCode).not.toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks INVALID PROPOSAL and sets exitCode 1 for a decode-rejected file, writing the {status:'invalid', issues} wrapper to --output", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeFileSync(resolve(repoRoot, "proposal.json"), "not json");
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);
      expect(logger.errors.some((m) => m === "INVALID PROPOSAL")).toBe(true);
      expect(process.exitCode).toBe(1);
      const written = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8"));
      expect(written).toEqual({ status: "invalid", issues: expect.any(Array) });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("marks INVALID PROPOSAL and sets exitCode 1 for a post-decode invalid proposal_validation (unsupported schema_version), writing the RAW ChangeAdvisory object to --output", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal({ schema_version: 99 }));
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", output: "advisory.json" }, logger);
      expect(logger.errors.some((m) => m === "INVALID PROPOSAL")).toBe(true);
      expect(process.exitCode).toBe(1);
      const written = JSON.parse(readFileSync(resolve(repoRoot, "advisory.json"), "utf8")) as ChangeAdvisory;
      // the RAW ChangeAdvisory -- not a CLI-invented wrapper -- proving §28:
      // ChangeAdvisory is the sole truth contract even for an invalid proposal.
      expect(written.proposal_validation.status).toBe("invalid");
      expect(written.id).toBeDefined();
      expect(written.domain_coverage).toBeDefined();
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("never persists an advisory by default -- only --cache writes under .rvs/cache/change-workbench/", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const logger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json" }, logger);
      expect(existsSync(resolve(repoRoot, ".rvs/cache/change-workbench"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("--cache persists a StoredChangeAdvisory retrievable end-to-end via `rvs change explain <id>`", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const evalLogger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", cache: true }, evalLogger);
      const cachedLine = evalLogger.infos.find((m) => m.startsWith("Cached advisory at "));
      expect(cachedLine).toBeDefined();

      const advisoryIdMatch = evalLogger.infos.join("\n");
      // Re-run evaluate (side-effect-free) to recover the advisory id deterministically.
      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      expect(outcome.outcome).toBe("evaluated");
      const advisoryId = outcome.outcome === "evaluated" ? outcome.advisory.id : "";
      expect(advisoryIdMatch).toBeDefined();

      const explainLogger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisoryId, {}, explainLogger);
      expect(explainLogger.errors).toEqual([]);
      expect(explainLogger.infos.some((m) => m.includes(advisoryId))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("never writes into the observed Knowledge Graph cache (nodes.json/edges.json/graph-snapshot.json byte-identical before and after) -- a proposal can never self-promote into observed truth", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const before = {
        nodes: readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), "utf8"),
        edges: readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/edges.json"), "utf8"),
        snapshot: readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/graph-snapshot.json"), "utf8"),
      };
      const logger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", cache: true, output: "advisory.json" }, logger);
      expect(readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), "utf8")).toBe(before.nodes);
      expect(readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/edges.json"), "utf8")).toBe(before.edges);
      expect(readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/graph-snapshot.json"), "utf8")).toBe(before.snapshot);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("throws when --file is omitted", async () => {
    const repoRoot = tempRepo();
    try {
      const logger = makeLogger();
      await expect(runChangeEvaluateCommand(repoRoot, {}, logger)).rejects.toThrow("--file <proposal.json>");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism (§27/§38): 5 repeated + 5 shuffled-operation-order-equivalent
// runs must produce byte-identical JSON.stringify(advisory) output, with no
// timestamp field anywhere in the shape to break equality.
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces byte-identical advisory JSON across 5 repeated evaluate runs of the same proposal file", () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const outputs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
        expect(outcome.outcome).toBe("evaluated");
        outputs.push(JSON.stringify(outcome.outcome === "evaluated" ? outcome.advisory : null, null, 2));
      }
      for (const output of outputs) expect(output).toBe(outputs[0]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("produces byte-identical advisory JSON across 5 shuffled-but-logically-equivalent operation orderings of the same multi-operation proposal", () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      // Deliberately non-conflicting operations -- a proposal that removes
      // an entity another operation still relates to would produce
      // validation issues whose `operation_index` legitimately depends on
      // array position (see change-workbench's own determinism.test.ts),
      // which is not what this test is proving.
      const baseOperations = [
        { kind: "modify_attributes", ref: NODE_A.id, attributes: { label: "A2" } },
        { kind: "add_relation", from_ref: NODE_A.id, to_ref: NODE_B.id, edge_type: "depends_on" },
      ];

      function shuffled<T>(arr: T[], seed: number): T[] {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = (i * 2654435761 + seed) % (i + 1);
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      const outputs: string[] = [];
      for (let seed = 0; seed < 5; seed++) {
        const fileName = `proposal-${seed}.json`;
        writeProposalFile(repoRoot, fileName, validProposal({ operations: shuffled(baseOperations, seed) }));
        const outcome = runChangeWorkbenchEvaluation(repoRoot, fileName);
        expect(outcome.outcome).toBe("evaluated");
        outputs.push(JSON.stringify(outcome.outcome === "evaluated" ? outcome.advisory : null, null, 2));
      }
      for (const output of outputs) expect(output).toBe(outputs[0]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Agent parity (§29): the reusable decode/evaluation boundary
// (@rvs/change-workbench's own decodeProposedChangeSet/
// validateProposedChangeSet/buildChangeAdvisory) must produce the identical
// result for a directly-parsed in-memory object -- no Commander, no file,
// no CLI wiring at all -- as the CLI's `runChangeWorkbenchEvaluation` path
// produces for the same logical proposal read from a file.
// ---------------------------------------------------------------------------

describe("agent parity", () => {
  it("a directly-parsed object through @rvs/change-workbench's own exports produces byte-identical results to the CLI file-reading path", () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot, [NODE_A, NODE_B], "sha256-parity-digest");
      const proposal = validProposal();
      writeProposalFile(repoRoot, "proposal.json", proposal);

      const cliOutcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      expect(cliOutcome.outcome).toBe("evaluated");
      const cliAdvisory = cliOutcome.outcome === "evaluated" ? cliOutcome.advisory : undefined;

      // Simulates a future MCP/agent/CI caller: no file I/O, no Commander --
      // a plain in-memory `unknown` value (as if already JSON.parse()d by
      // that caller) handed straight to the package's own exports.
      const decoded = decodeProposedChangeSet(JSON.parse(JSON.stringify(proposal)));
      expect(decoded.status).toBe("ok");
      const baseline = resolveChangeWorkbenchBaseline(repoRoot);
      const directAdvisory =
        decoded.status === "ok"
          ? buildChangeAdvisory({
              changeSet: decoded.changeSet,
              confirmedNodes: baseline.nodes,
              confirmedEdges: baseline.edges,
              baseSnapshotDigest: baseline.baseSnapshotDigest,
              decisionStateLookup: baseline.decisionStateLookup,
            })
          : undefined;

      expect(JSON.stringify(directAdvisory, null, 2)).toBe(JSON.stringify(cliAdvisory, null, 2));
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("an unknown operation kind is rejected identically by validateProposedChangeSet() called directly as it is via the CLI's change-validate path", () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      const proposal = validProposal({ operations: [{ kind: "not_a_real_kind", ref: NODE_A.id }] });
      writeProposalFile(repoRoot, "proposal.json", proposal);

      const cliOutcome = runChangeWorkbenchValidation(repoRoot, "proposal.json");
      expect(cliOutcome.outcome).toBe("validated");
      const cliResult = cliOutcome.outcome === "validated" ? cliOutcome.result : undefined;

      const decoded = decodeProposedChangeSet(JSON.parse(JSON.stringify(proposal)));
      expect(decoded.status).toBe("ok");
      const directResult = decoded.status === "ok" ? validateProposedChangeSet(decoded.changeSet, { confirmedNodes: [NODE_A, NODE_B] }) : undefined;

      expect(directResult?.status).toBe("invalid");
      expect(cliResult?.status).toBe("invalid");
      expect(directResult?.issues.some((i) => i.code === "unsupported_operation_kind")).toBe(true);
      expect(cliResult?.issues.some((i) => i.code === "unsupported_operation_kind")).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// `rvs change explain`
// ---------------------------------------------------------------------------

describe("runChangeExplainCommand", () => {
  it("fails with a clear message and exitCode 1 for an unknown advisory id, without throwing out of the function", async () => {
    const repoRoot = tempRepo();
    try {
      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeExplainCommand(repoRoot, "change-workbench:advisory:does-not-exist", {}, logger);
      expect(logger.errors.some((m) => m.includes("No cached advisory found"))).toBe(true);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("narrates only existing ChangeAdvisory evidence -- prints governance/decision concern headings sourced verbatim from the stored advisory's own findings", async () => {
    const repoRoot = tempRepo();
    try {
      const advisory = fixtureAdvisoryWithFindings();
      const cachedPath = writeStoredChangeAdvisory(repoRoot, { advisory, base_snapshot_digest_at_store_time: advisory.base_snapshot_digest });
      expect(existsSync(cachedPath)).toBe(true);

      const logger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);
      expect(logger.errors).toEqual([]);
      expect(logger.infos.some((m) => m.includes("PROPOSED GOVERNANCE CONCERN"))).toBe(true);
      expect(logger.infos.some((m) => m.includes("PROPOSED DECISION CONCERN"))).toBe(true);
      expect(logger.infos.some((m) => m.includes("would violate the isolation policy"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes control/ANSI-escape characters in a finding's statement for terminal presentation, without mutating the stored advisory's own truth value (§26)", async () => {
    const repoRoot = tempRepo();
    try {
      const hostileStatement = "\x1b[31mDANGER\x1b[0m\x07 would violate the isolation policy";
      const advisory = fixtureAdvisoryWithFindings(hostileStatement);
      writeStoredChangeAdvisory(repoRoot, { advisory, base_snapshot_digest_at_store_time: advisory.base_snapshot_digest });

      const logger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);
      const printedLine = logger.infos.find((m) => m.includes("would violate the isolation policy"));
      expect(printedLine).toBeDefined();
      // eslint-disable-next-line no-control-regex
      expect(/[\x00-\x1f\x7f]/.test(printedLine ?? "")).toBe(false);

      // The stored truth on disk is untouched -- sanitization is presentation-only.
      const stored = findStoredChangeAdvisoryById(repoRoot, advisory.id);
      expect(stored?.advisory.governance.findings[0]?.statement).toBe(hostileStatement);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("discloses `Advisory freshness: current` when the observed Knowledge Graph baseline has not moved since the advisory was cached", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot, [NODE_A, NODE_B], "sha256-freshness-digest-A");
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const evalLogger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", cache: true }, evalLogger);
      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      const advisoryId = outcome.outcome === "evaluated" ? outcome.advisory.id : "";

      const explainLogger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisoryId, {}, explainLogger);
      expect(explainLogger.errors).toEqual([]);
      expect(explainLogger.infos.some((m) => m.trim() === "Advisory freshness: current")).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("discloses `Advisory freshness: stale_equivalent` and both baseline digests when the observed Knowledge Graph baseline has advanced since the advisory was cached -- without invalidating, regenerating, or re-evaluating the stored advisory", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot, [NODE_A, NODE_B], "sha256-freshness-digest-A");
      writeProposalFile(repoRoot, "proposal.json", validProposal());
      const evalLogger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", cache: true }, evalLogger);
      const outcome = runChangeWorkbenchEvaluation(repoRoot, "proposal.json");
      const advisoryId = outcome.outcome === "evaluated" ? outcome.advisory.id : "";
      const storedBefore = findStoredChangeAdvisoryById(repoRoot, advisoryId);

      // Observed baseline advances -- e.g. `rvs graph build` re-run after new evidence lands.
      writeGraphBaseline(repoRoot, [NODE_A, NODE_B], "sha256-freshness-digest-B");

      const explainLogger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisoryId, {}, explainLogger);
      expect(explainLogger.errors).toEqual([]);
      expect(explainLogger.infos.some((m) => m.trim() === "Advisory freshness: stale_equivalent")).toBe(true);
      expect(explainLogger.infos.some((m) => m.includes("Evaluated baseline: sha256-freshness-digest-A"))).toBe(true);
      expect(explainLogger.infos.some((m) => m.includes("Current baseline: sha256-freshness-digest-B"))).toBe(true);
      // No forbidden wording (§5) -- staleness is disclosure, not a correctness judgment.
      const joined = explainLogger.infos.join("\n").toLowerCase();
      expect(joined).not.toMatch(/\binvalid\b|\bwrong\b|\bobsolete\b|\bunsafe\b/);

      // The stored advisory itself is untouched by explain -- disclosure, not recomputation.
      const storedAfter = findStoredChangeAdvisoryById(repoRoot, advisoryId);
      expect(storedAfter).toEqual(storedBefore);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("discloses no freshness line -- and does not fail -- when no Knowledge Graph baseline is available to compare against (explain never requires `rvs graph build`)", async () => {
    const repoRoot = tempRepo();
    try {
      const advisory = fixtureAdvisoryWithFindings();
      writeStoredChangeAdvisory(repoRoot, { advisory, base_snapshot_digest_at_store_time: advisory.base_snapshot_digest });
      // deliberately no writeGraphBaseline() call

      const logger = makeLogger();
      await runChangeExplainCommand(repoRoot, advisory.id, {}, logger);
      expect(logger.errors).toEqual([]);
      expect(logger.infos.some((m) => m.includes("Advisory freshness"))).toBe(false);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("sanitizeTerminalText", () => {
  it("strips control and DEL characters but preserves ordinary text", () => {
    expect(sanitizeTerminalText("hello\x07\x1bworld\x7f!")).toBe("helloworld!");
    expect(sanitizeTerminalText("plain text, no surprises")).toBe("plain text, no surprises");
  });
});

// ---------------------------------------------------------------------------
// Security (§39)
// ---------------------------------------------------------------------------

describe("security", () => {
  it("sanitizes a caller-controlled repository_id before constructing an advisory cache path -- a hostile repository_id can never escape .rvs/cache/change-workbench/advisories/", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      writeProposalFile(repoRoot, "proposal.json", validProposal({ repository_id: "../../evil-escape" }));
      const logger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal.json", cache: true }, logger);
      const cachedLine = logger.infos.find((m) => m.startsWith("Cached advisory at "));
      expect(cachedLine).toBeDefined();
      const cachedPath = cachedLine!.replace("Cached advisory at ", "");
      const advisoriesRoot = resolve(repoRoot, CHANGE_WORKBENCH_ADVISORIES_DIR);
      const rel = relative(advisoriesRoot, cachedPath);
      // A real directory-traversal escape produces a relative path whose
      // first segment is exactly ".." -- checking `rel.startsWith("..")`
      // alone would also (wrongly) flag a legitimate sanitized segment like
      // "..-..-evil-escape" that merely happens to start with two dots.
      const firstSegment = rel.split(/[\\/]/)[0];
      expect(firstSegment).not.toBe("..");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("a caller-supplied proposal `id` claim -- including hostile path-like content -- never influences canonical proposal/advisory identity or the persisted cache path; identity is always recomputed from repository_id + operations", async () => {
    const repoRoot = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      const hostileId = "../../etc/passwd:spoofed-id";
      writeProposalFile(repoRoot, "proposal-plain.json", validProposal());
      writeProposalFile(repoRoot, "proposal-spoofed.json", validProposal({ id: "change-workbench:proposal:completely-different-claim:0000" }));
      writeProposalFile(repoRoot, "proposal-hostile.json", validProposal({ id: hostileId }));

      const outcomePlain = runChangeWorkbenchEvaluation(repoRoot, "proposal-plain.json");
      const outcomeSpoofed = runChangeWorkbenchEvaluation(repoRoot, "proposal-spoofed.json");
      const outcomeHostile = runChangeWorkbenchEvaluation(repoRoot, "proposal-hostile.json");
      if (outcomePlain.outcome !== "evaluated" || outcomeSpoofed.outcome !== "evaluated" || outcomeHostile.outcome !== "evaluated") {
        throw new Error("unreachable -- all three proposals are otherwise identical and valid against the same baseline");
      }

      // Same semantic proposal (repository_id + operations), three different
      // caller-supplied `id` claims (including none at all) -> identical
      // canonical ProposedChangeSet.id and ChangeAdvisory.id. A caller cannot
      // choose proposal identity, collide identity intentionally, or change
      // advisory identity merely by varying the supplied `id`.
      expect(outcomeSpoofed.advisory.proposal_id).toBe(outcomePlain.advisory.proposal_id);
      expect(outcomeHostile.advisory.proposal_id).toBe(outcomePlain.advisory.proposal_id);
      expect(outcomeSpoofed.advisory.id).toBe(outcomePlain.advisory.id);
      expect(outcomeHostile.advisory.id).toBe(outcomePlain.advisory.id);

      // The hostile `id` string never leaks into the actual --cache path
      // written to disk -- cache path identity derives solely from the
      // canonical (repository_id, ChangeAdvisory.id), never the caller's claim.
      const logger = makeLogger();
      await runChangeEvaluateCommand(repoRoot, { file: "proposal-hostile.json", cache: true }, logger);
      const cachedLine = logger.infos.find((m) => m.startsWith("Cached advisory at "));
      expect(cachedLine).toBeDefined();
      expect(cachedLine).not.toContain("etc");
      expect(cachedLine).not.toContain("passwd");
      expect(cachedLine).not.toContain("spoofed-id");
      const cachedPath = cachedLine!.replace("Cached advisory at ", "");
      const rel = relative(resolve(repoRoot, CHANGE_WORKBENCH_ADVISORIES_DIR), cachedPath);
      expect(rel.split(/[\\/]/)[0]).not.toBe("..");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("reading through a symlinked --file works safely (arbitrary-input-read is the intended, documented policy -- no crash, no unsafe behavior)", async () => {
    const repoRoot = tempRepo();
    const outsideDir = tempRepo();
    try {
      writeGraphBaseline(repoRoot);
      const realPath = resolve(outsideDir, "real-proposal.json");
      writeFileSync(realPath, JSON.stringify(validProposal()));
      const { symlinkSync } = await import("node:fs");
      symlinkSync(realPath, resolve(repoRoot, "linked-proposal.json"));

      const logger = makeLogger();
      process.exitCode = undefined;
      await runChangeValidateCommand(repoRoot, { file: "linked-proposal.json" }, logger);
      expect(logger.errors).toEqual([]);
      expect(logger.infos.some((m) => m.startsWith("VALID PROPOSAL"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("never leaves any fs artifact behind for a rejected proposal beyond an explicitly requested --output path", async () => {
    const repoRoot = tempRepo();
    try {
      writeHostileProtoProposalFile(repoRoot, "hostile.json");
      const before = new Set(readdirSync(repoRoot));
      const logger = makeLogger();
      await runChangeValidateCommand(repoRoot, { file: "hostile.json" }, logger);
      const after = new Set(readdirSync(repoRoot));
      expect(after).toEqual(before);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("the change-workbench CLI wiring source contains no network, child-process, or git-mutation calls", () => {
    const commandFiles = [
      "change-decode.ts",
      "change-baseline.ts",
      "change-presentation.ts",
      "change-shared.ts",
      "change-validate.ts",
      "change-evaluate.ts",
      "change-explain.ts",
    ];
    const forbidden = /\bfetch\(|node:child_process|require\(["']child_process["']\)|execFile|execSync|spawn\(|spawnSync|simple-git|isomorphic-git/;
    for (const file of commandFiles) {
      const path = fileURLToPath(new URL(`../commands/${file}`, import.meta.url));
      const source = readFileSync(path, "utf8");
      expect(forbidden.test(source), `${file} unexpectedly matched a forbidden network/child-process/git pattern`).toBe(false);
    }
    const cachePath = fileURLToPath(new URL("../change-workbench-cache.ts", import.meta.url));
    expect(forbidden.test(readFileSync(cachePath, "utf8"))).toBe(false);
  });
});

function fixtureAdvisoryWithFindings(governanceStatement = "This proposal would violate the isolation policy for node:service-a."): ChangeAdvisory {
  return {
    schema_version: 1,
    id: "change-workbench:advisory:test-repo:fixture0000001",
    proposal_id: "change-workbench:proposal:test-repo:fixture0000001",
    repository_id: REPO_ID,
    base_snapshot_digest: "sha256-fixture-digest",
    proposal_validation: { status: "valid_sufficient", issues: [] },
    topology: [],
    impact: {
      status: "evaluated",
      detail: "1 direct ref affected.",
      directly_affected_refs: [NODE_A.id],
      transitively_affected_refs: [],
      blast_radius_level: "low",
      unresolved_downstream_impact: false,
      truncated: false,
    },
    governance: {
      status: "evaluated",
      detail: "1 finding.",
      findings: [{ rule_id: "rule:isolation", policy_id: "policy:isolation", result: "would_violate", severity: "high", statement: governanceStatement, affected_refs: [NODE_A.id] }],
    },
    decisions: {
      status: "evaluated",
      detail: "1 finding.",
      findings: [{ decision_node_id: "decision:use-postgres", state: "would_conflict", statement: "This proposal would conflict with decision:use-postgres." }],
      capability_registry: [],
    },
    domain_coverage: [
      { domain: "impact", status: "evaluated", detail: "evaluated" },
      { domain: "governance", status: "evaluated", detail: "evaluated" },
      { domain: "decisions", status: "evaluated", detail: "evaluated" },
      { domain: "topology", status: "not_applicable", detail: "not applicable" },
    ],
    evidence_refs: [],
  };
}
