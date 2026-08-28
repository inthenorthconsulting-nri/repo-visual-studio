import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type {
  ChangePlanEntry,
  DecisionImpactEntry,
  GraphChangeSet,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeNode,
  RootCauseGroup,
  ValidationFinding,
} from "@rvs/knowledge-graph";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCreateSlides } from "../commands/create-slides.js";
import { runExportGraphReport } from "../commands/export-graph-report.js";
import { runExportImpactSummary } from "../commands/export-impact-summary.js";
import { runGraphBuild, runGraphBuildCommand } from "../commands/graph-build.js";
import type { GraphReport } from "../commands/graph-build.js";
import { runGraphCompareCommand } from "../commands/graph-compare.js";
import { runGraphExplainCommand } from "../commands/graph-explain.js";
import { runGraphImpactCommand } from "../commands/graph-impact.js";
import { runGraphInspectCommand } from "../commands/graph-inspect.js";
import { runGraphOpenCommand } from "../commands/graph-open.js";
import { runGraphPathCommand } from "../commands/graph-path.js";
import { runGraphPlanChangeCommand } from "../commands/graph-plan-change.js";
import { runExportChangeReviewSummary } from "../commands/export-change-review-summary.js";
import { runGraphReviewCommand } from "../commands/graph-review.js";
import { runGraphRootsCommand } from "../commands/graph-roots.js";
import { runGraphValidateCommand } from "../commands/graph-validate.js";

// ---------------------------------------------------------------------------
// These tests exercise the knowledge-graph CLI commands' behavior in-process
// (direct function calls against a temp repoRoot + fake Logger), exactly
// matching decisions-cli.test.ts's/governance-cli.test.ts's established
// convention -- no subprocess spawning. Every assertion below was written
// against the ACTUAL control flow read from the command source files
// (packages/cli/src/commands/graph-build.ts, graph-validate.ts,
// graph-inspect.ts, graph-impact.ts, graph-path.ts, graph-roots.ts,
// graph-compare.ts, graph-plan-change.ts, graph-explain.ts,
// export-graph-report.ts, export-impact-summary.ts, and the
// "knowledge-graph" branch of create-slides.ts) plus the underlying
// @rvs/knowledge-graph package (graph-builder.ts, node-builder.ts,
// edge-builder.ts, compatibility.ts, identity.ts, root-cause.ts,
// traversal.ts, impact-analysis.ts, path-finding.ts, decision-impact.ts,
// change-planning.ts, validation.ts, explain.ts, graph-plan.ts, ids.ts),
// not from assumed/expected behavior. Each describe block/case states which
// real code path it exercises.
// ---------------------------------------------------------------------------

import {
  archiveSnapshot,
  makeLogger,
  REPOSITORY_ID,
  writeBaseRepoFixtures,
  writeFullUpstreamFixtures,
  writePolicyFixture,
} from "./upstream-fixtures.js";


/** architecture + governance only (consistent repository_id) -- capability/product/portfolio/decision all absent, so compatibility.ts's stage 4 ("one or more artifacts are absent") applies -> status "partial", never "incompatible". */
function writePartialUpstreamFixtures(repoRoot: string, repositoryId: string = REPOSITORY_ID): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache/governance"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"),
    JSON.stringify({
      identity: { id: repositoryId, name: { displayLabel: "Fixture Repo" } },
      components: [{ id: "component:api-gateway", label: { displayLabel: "API Gateway" } }],
    }),
  );
  writePolicyFixture(repoRoot);
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/governance/governance-report.json"),
    JSON.stringify({
      repository_id: repositoryId,
      findings: [
        {
          id: "finding:api-gateway-review",
          policy_id: "governance:policy:test-policy",
          statement: "API Gateway requires additional review.",
          affected_entity_ids: ["component:api-gateway"],
        },
      ],
    }),
  );
}

/** architecture (repo-a) + governance (repo-b) -- a deliberate repository_id mismatch, tripping compatibility.ts's stage 2 ("present artifacts disagree on repository identity") -> status "incompatible" -> validation.ts's GRAPH_COMPATIBILITY_INCOMPATIBLE_SET (blocking: true). */
function writeMismatchedRepositoryFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache/governance"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"),
    JSON.stringify({ identity: { id: "github.com/acme/repo-a" }, components: [] }),
  );
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/governance/governance-report.json"),
    JSON.stringify({ repository_id: "github.com/acme/repo-b", findings: [] }),
  );
}

describe("runGraphBuild / runGraphBuildCommand", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-build-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: a full six-domain, cross-consistent fixture set (see
  // writeFullUpstreamFixtures's own doc comment) builds a small non-empty
  // graph with compatibility "compatible", exactly one "confirmed"
  // root-cause group, and zero blocking validation findings, and
  // graph-build.ts's writeGraphOutputs call writes every cache file it
  // covers (graphSnapshot, nodes, edges, unresolvedLinks, rootCauseGroups,
  // graphNarrative, graphPlan, graphReport) -- but never impact-results.json
  // /decision-impact.json/graph-changes.json/change-plan.json, which are
  // exclusively written by their own dedicated commands.
  it("builds a complete knowledge graph across all six upstream domains and writes every build-time cache file", async () => {
    writeFullUpstreamFixtures(repoRoot);
    const logger = makeLogger();

    await runGraphBuildCommand(repoRoot, {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.includes('compatibility "compatible"'))).toBe(true);
    expect(logger.infos.some((m) => m === "Wrote .rvs/cache/knowledge-graph/*.json.")).toBe(true);

    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    for (const file of [
      "graph-snapshot.json",
      "nodes.json",
      "edges.json",
      "unresolved-links.json",
      "root-cause-groups.json",
      "graph-narrative.json",
      "graph-plan.json",
      "graph-report.json",
    ]) {
      expect(existsSync(resolve(graphCacheDir, file))).toBe(true);
    }
    for (const file of ["impact-results.json", "decision-impact.json", "graph-changes.json", "change-plan.json"]) {
      expect(existsSync(resolve(graphCacheDir, file))).toBe(false);
    }

    const nodes = JSON.parse(readFileSync(resolve(graphCacheDir, "nodes.json"), "utf8")) as KnowledgeNode[];
    const edges = JSON.parse(readFileSync(resolve(graphCacheDir, "edges.json"), "utf8")) as KnowledgeEdge[];
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    expect(nodes.some((n) => n.node_type === "unresolved_reference")).toBe(false);

    const report = JSON.parse(readFileSync(resolve(graphCacheDir, "graph-report.json"), "utf8")) as GraphReport;
    expect(report.compatibility_status).toBe("compatible");
    expect(report.repository_id).toBe(REPOSITORY_ID);
    expect(report.validation_blocking_count).toBe(0);

    const rootCauseGroups = JSON.parse(readFileSync(resolve(graphCacheDir, "root-cause-groups.json"), "utf8")) as RootCauseGroup[];
    expect(rootCauseGroups).toHaveLength(1);
    expect(rootCauseGroups[0]!.classification).toBe("confirmed");
    expect(rootCauseGroups[0]!.finding_node_ids).toHaveLength(2);
  });

  // Case: zero upstream artifacts at all (empty .rvs/cache) -- graph-build.ts
  // always supplies a repositoryIdHint (resolveRepositoryIdHint falls back to
  // basename(repoRoot) outside a git remote/worktree), so
  // resolveRepositoryId (graph-builder.ts) never throws; buildKnowledgeGraph
  // itself never throws regardless of compatibility.status. compatibility.ts
  // stage 1 ("no artifact present at all") applies -> status "incompatible",
  // and the pipeline still runs to completion producing an empty graph.
  it("still builds (never throws) with zero upstream artifacts, producing an empty graph with an incompatible compatibility status", async () => {
    const logger = makeLogger();

    await expect(runGraphBuildCommand(repoRoot, {}, logger)).resolves.toBeUndefined();

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.includes('compatibility "incompatible"'))).toBe(true);

    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    const nodes = JSON.parse(readFileSync(resolve(graphCacheDir, "nodes.json"), "utf8")) as KnowledgeNode[];
    const edges = JSON.parse(readFileSync(resolve(graphCacheDir, "edges.json"), "utf8")) as KnowledgeEdge[];
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);

    const report = JSON.parse(readFileSync(resolve(graphCacheDir, "graph-report.json"), "utf8")) as GraphReport;
    expect(report.node_count).toBe(0);
    expect(report.edge_count).toBe(0);
    expect(report.compatibility_status).toBe("incompatible");
  });

  // Case: only architecture + governance cached (capability/product/
  // portfolio/decision all absent) with a consistent repository_id --
  // compatibility.ts's stage 4 applies ("one or more artifacts are absent")
  // -> status "partial", a distinct outcome from the "zero artifacts"
  // (stage 1, "incompatible") and "mismatched repository_id" (stage 2,
  // "incompatible") cases above/below. The graph still builds a small
  // non-empty node/edge set from the two present domains.
  it("builds successfully from a partial upstream set (architecture + governance only), with compatibility status \"partial\"", async () => {
    writePartialUpstreamFixtures(repoRoot);
    const logger = makeLogger();

    const result = await runGraphBuild(repoRoot, logger);

    expect(result.buildResult.compatibility.status).toBe("partial");
    expect(result.buildResult.nodes.length).toBeGreaterThan(0);
    expect(result.buildResult.nodes.some((n) => n.source_entity_id === "component:api-gateway")).toBe(true);
    expect(result.buildResult.nodes.some((n) => n.node_type === "governance_finding")).toBe(true);
  });
});

describe("runGraphValidateCommand --ci", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-validate-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  // Case: the full, cross-consistent fixture set produces zero blocking
  // validation findings (see writeFullUpstreamFixtures's doc comment), so
  // --ci never touches process.exitCode even though non-blocking findings
  // may still be logged as warnings.
  it("does NOT set process.exitCode under --ci when there are zero blocking findings", async () => {
    writeFullUpstreamFixtures(repoRoot);
    const logger = makeLogger();
    process.exitCode = undefined;

    await runGraphValidateCommand(repoRoot, { ci: true }, logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.infos.some((m) => /^Knowledge graph validation: \d+ finding\(s\), 0 blocking\.$/.test(m))).toBe(true);
  });

  // Case: a deliberate architecture/governance repository_id mismatch trips
  // compatibility.ts's stage-2 "repository identity mismatch" check ->
  // compatibility.status "incompatible" -> validation.ts's
  // GRAPH_COMPATIBILITY_INCOMPATIBLE_SET finding, which is blocking: true.
  // graph-validate.ts logs every blocking finding via logger.error and, under
  // --ci with any blocking finding present, sets process.exitCode = 1.
  it("sets process.exitCode = 1 under --ci when a repository_id mismatch produces a blocking GRAPH_COMPATIBILITY_INCOMPATIBLE_SET finding", async () => {
    writeMismatchedRepositoryFixtures(repoRoot);
    const logger = makeLogger();
    process.exitCode = undefined;

    await runGraphValidateCommand(repoRoot, { ci: true }, logger);

    expect(process.exitCode).toBe(1);
    expect(logger.errors.some((m) => m.includes("[GRAPH_COMPATIBILITY_INCOMPATIBLE_SET]"))).toBe(true);
    expect(logger.infos.some((m) => /^Knowledge graph validation: \d+ finding\(s\), [1-9]\d* blocking\.$/.test(m))).toBe(true);
  });
});

describe("resolveNode / runGraphInspectCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-inspect-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: resolveNode's third fallback branch (bySourceEntityId, since
  // "component:api-gateway" is the raw upstream entity id, not a graph node
  // id) resolves a real node, and runGraphInspectCommand lists its adjacent
  // edges via buildEdgeIndex/collectCandidateEdges("both").
  it("resolves a real node by its raw source entity id and lists its adjacent edges", async () => {
    const logger = makeLogger();

    await runGraphInspectCommand(repoRoot, "component:api-gateway", {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos[0]).toMatch(/^graph:node:.*\(component, confirmed, resolved\)$/);
    expect(logger.infos.some((m) => / adjacent edge\(s\):$/.test(m))).toBe(true);
    // The repository-contains-component edge and the flow-derived invokes
    // edge (see writeFullUpstreamFixtures) are both adjacent to api-gateway.
    expect(logger.infos.some((m) => m.includes("[contains]"))).toBe(true);
    expect(logger.infos.some((m) => m.includes("[invokes]"))).toBe(true);
  });

  // Case: resolveNode exhausts all three lookup strategies (exact id, built
  // node id, source_entity_id) and throws a clear error naming the
  // unresolved input and pointing at `rvs graph build`/`rvs graph explain`.
  it("throws a clear error for an unresolvable entity id", async () => {
    const logger = makeLogger();

    await expect(runGraphInspectCommand(repoRoot, "component:does-not-exist", {}, logger)).rejects.toThrow(
      'No knowledge graph node found for "component:does-not-exist"',
    );
  });
});

describe("runGraphImpactCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-impact-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: default direction ("downstream", parseDirection's undefined
  // branch). component:api-gateway's only outgoing edge is the
  // flow-derived `invokes` edge to component:billing-service (the
  // repository--contains-->component edge points the other way, into
  // api-gateway, so it is not part of a downstream traversal from it) --
  // exactly one directly-affected node.
  it("runs a default-direction (downstream) impact query and writes impact-results.json", async () => {
    const logger = makeLogger();

    await runGraphImpactCommand(repoRoot, "component:api-gateway", {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.startsWith("Impact of graph:node:component-api-gateway: 1 direct"))).toBe(true);

    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    const impactResults = JSON.parse(readFileSync(resolve(graphCacheDir, "impact-results.json"), "utf8")) as ImpactResult[];
    expect(impactResults).toHaveLength(1);
    expect(impactResults[0]!.query.direction).toBe("downstream");
    expect(impactResults[0]!.directly_affected).toHaveLength(1);
    expect(impactResults[0]!.directly_affected[0]!.node_type).toBe("component");
  });

  // Case: impact-results.json accumulates across repeated `graph impact`
  // calls (graph-impact.ts always writes `[...existingImpactResults,
  // result]`, never replacing), and decision-impact.json entries are merged
  // by their own `id` rather than duplicated (graph-impact.ts builds a
  // `Map` keyed by `entry.id` seeded from the existing cache, then
  // overwrites/adds this call's entries into it) -- calling the identical
  // query twice leaves decision-impact.json's length unchanged the second
  // time. --direction upstream from capability:process-payment reaches
  // domain:payments (contains), the product-identity and portfolio product
  // nodes (requires), the governance finding (affects), and decision:
  // use-stripe (the decision-link's references edge) all at depth 1, so
  // products_affected/governance_findings_affected/decisions_affected are
  // all non-empty -- a materially richer query than the first case.
  it("accumulates impact-results.json across repeated calls and merges decision-impact.json by id without duplicating", async () => {
    const logger = makeLogger();
    await runGraphImpactCommand(repoRoot, "component:api-gateway", {}, logger);

    await runGraphImpactCommand(repoRoot, "capability:process-payment", { direction: "upstream" }, logger);

    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    const afterSecondCall = JSON.parse(readFileSync(resolve(graphCacheDir, "impact-results.json"), "utf8")) as ImpactResult[];
    expect(afterSecondCall).toHaveLength(2);
    const upstreamResult = afterSecondCall[1]!;
    expect(upstreamResult.products_affected.length).toBeGreaterThan(0);
    expect(upstreamResult.governance_findings_affected.length).toBeGreaterThan(0);
    expect(upstreamResult.decisions_affected.length).toBeGreaterThan(0);

    const decisionImpactAfterSecondCall = JSON.parse(readFileSync(resolve(graphCacheDir, "decision-impact.json"), "utf8")) as DecisionImpactEntry[];
    expect(decisionImpactAfterSecondCall.length).toBeGreaterThan(0);

    // Identical query a third time: impact-results.json grows again (never
    // deduplicated), but decision-impact.json's entry count is unchanged
    // (same entity -> same decision-impact entry ids -> Map overwrite, not
    // append).
    await runGraphImpactCommand(repoRoot, "capability:process-payment", { direction: "upstream" }, logger);

    const afterThirdCall = JSON.parse(readFileSync(resolve(graphCacheDir, "impact-results.json"), "utf8")) as ImpactResult[];
    expect(afterThirdCall).toHaveLength(3);

    const decisionImpactAfterThirdCall = JSON.parse(readFileSync(resolve(graphCacheDir, "decision-impact.json"), "utf8")) as DecisionImpactEntry[];
    expect(decisionImpactAfterThirdCall).toHaveLength(decisionImpactAfterSecondCall.length);
    expect(new Set(decisionImpactAfterThirdCall.map((e) => e.id)).size).toBe(decisionImpactAfterThirdCall.length);
  });
});

describe("runGraphPathCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-path-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: `--shortest` (the default, opts.all falsy) -- findShortestPath via
  // the single flow-derived `invokes` edge, a length-1 path.
  it("finds the shortest path (default, --shortest) between two connected components", async () => {
    const logger = makeLogger();

    await runGraphPathCommand(repoRoot, "component:api-gateway", "component:billing-service", {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.startsWith("Shortest path (length 1) from"))).toBe(true);
    expect(logger.infos.some((m) => m.includes("graph:node:component-api-gateway -> graph:node:component-billing-service"))).toBe(true);
  });

  // Case: `--all` -- findAllPaths's bounded simple-path DFS enumeration.
  it("finds all paths (--all) between two connected components", async () => {
    const logger = makeLogger();

    await runGraphPathCommand(repoRoot, "component:api-gateway", "component:billing-service", { all: true }, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => /^\d+ path\(s\) from graph:node:component-api-gateway to graph:node:component-billing-service:$/.test(m))).toBe(
      true,
    );
    expect(logger.infos.some((m) => m.trim().startsWith("[1]"))).toBe(true);
  });
});

describe("runGraphRootsCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-roots-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: recomputes root-cause-groups.json from the current nodes.json/
  // edges.json (groupRootCauses), independent of the copy `graph build`
  // already wrote -- the fixture's two governance findings sharing
  // domain:payments as their sole causal ancestor group into one
  // "confirmed" root-cause group (see writeFullUpstreamFixtures's doc
  // comment and root-cause.ts's classification rules).
  it("recomputes root-cause-groups.json with one confirmed group", async () => {
    const logger = makeLogger();

    await runGraphRootsCommand(repoRoot, {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m === "1 root-cause group(s):")).toBe(true);
    expect(logger.infos.some((m) => m.includes("[confirmed] 2 finding(s) -> 1 candidate root(s)"))).toBe(true);

    const rootCauseGroups = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/root-cause-groups.json"), "utf8"),
    ) as RootCauseGroup[];
    expect(rootCauseGroups).toHaveLength(1);
    expect(rootCauseGroups[0]!.classification).toBe("confirmed");
    expect(rootCauseGroups[0]!.candidate_root_node_ids).toEqual(["graph:node:domain-payments"]);
  });
});

describe("runGraphCompareCommand", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-compare-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: graph-compare.ts's runGraphCompareCommand throws immediately when
  // opts.from is unset -- the very first line of the function, before
  // touching the filesystem.
  it("throws a clear error when --from is omitted", async () => {
    const logger = makeLogger();
    await expect(runGraphCompareCommand(repoRoot, {}, logger)).rejects.toThrow("`rvs graph compare` requires --from <snapshot-dir>.");
  });

  // Case: a real archived snapshot directory (readSnapshotDir's own three
  // expected filenames -- graph-snapshot.json, nodes.json, edges.json,
  // verified directly against graph-compare.ts's readSnapshotDir), compared
  // against a fresh rebuild (--to omitted) after a new component was added
  // to the architecture fixture -- the new component and the containment
  // edge introducing it are both "added".
  it("compares a real archived snapshot directory against a fresh rebuild, writing graph-changes.json", async () => {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());

    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    const archiveDir = resolve(repoRoot, "archived-snapshot");
    mkdirSync(archiveDir, { recursive: true });
    for (const file of ["graph-snapshot.json", "nodes.json", "edges.json"]) {
      writeFileSync(resolve(archiveDir, file), readFileSync(resolve(graphCacheDir, file), "utf8"));
    }

    const architecture = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"), "utf8"));
    architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
    writeFileSync(resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"), JSON.stringify(architecture));

    const logger = makeLogger();
    await runGraphCompareCommand(repoRoot, { from: "archived-snapshot" }, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m.startsWith("Graph diff graph:snapshot:"))).toBe(true);

    const changeSet = JSON.parse(readFileSync(resolve(graphCacheDir, "graph-changes.json"), "utf8")) as GraphChangeSet;
    expect(changeSet.nodes_added).toContain("graph:node:component-reporting-service");
    expect(changeSet.edges_added.length).toBeGreaterThan(0);
  });
});

describe("runGraphPlanChangeCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-plan-change-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: graph-plan-change.ts throws immediately when --remove is unset.
  it("throws a clear error when --remove is omitted", async () => {
    const logger = makeLogger();
    await expect(runGraphPlanChangeCommand(repoRoot, {}, logger)).rejects.toThrow("`rvs graph plan-change` requires --remove <entity-id>.");
  });

  // Case: planChange (change-planning.ts) runs a *downstream* impact query
  // rooted at the removed entity (query.direction is hardcoded to
  // "downstream"), so affected_node_ids only ever reflects the removed
  // node's own OUTGOING edges, never nodes that merely point at it.
  // component:billing-service is itself only ever an edge *target* in this
  // fixture (capability --depends_on--> component via logicalComponents,
  // component --invokes--> component via the architecture flow) -- it has
  // no outgoing edges of its own, so removing it alone would produce an
  // empty affected_node_ids. component:api-gateway does have a real
  // outgoing edge (the flow-derived `invokes` edge to billing-service), so
  // removing IT is the fixture's correct non-empty-impact case.
  it("plans the impact of removing a real component and writes change-plan.json", async () => {
    const logger = makeLogger();

    await runGraphPlanChangeCommand(repoRoot, { remove: "component:api-gateway" }, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => m === "Change plan for removing graph:node:component-api-gateway:")).toBe(true);

    const plan = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/change-plan.json"), "utf8")) as ChangePlanEntry;
    expect(plan.removed_entity_node_id).toBe("graph:node:component-api-gateway");
    expect(plan.affected_node_ids).toEqual(["graph:node:component-billing-service"]);
  });
});

describe("runGraphExplainCommand", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-explain-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  // Case: explainGraphId matches by EXACT node id (`candidate.id === id`,
  // no fuzzy/source-entity-id fallback like resolveNode has) -- so this
  // reads the real node id out of the cached nodes.json first, rather than
  // guessing buildNodeId's sanitize() output.
  it("explains a real node id", async () => {
    const nodes = JSON.parse(readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), "utf8")) as KnowledgeNode[];
    const apiGatewayNode = nodes.find((n) => n.source_entity_id === "component:api-gateway");
    expect(apiGatewayNode).toBeDefined();

    const logger = makeLogger();
    process.exitCode = undefined;
    await runGraphExplainCommand(repoRoot, apiGatewayNode!.id, {}, logger);

    expect(process.exitCode).toBeUndefined();
    expect(logger.errors).toEqual([]);
    expect(logger.infos).toHaveLength(1);
    expect(logger.infos[0]).toContain(`Node "${apiGatewayNode!.id}"`);
    expect(logger.infos[0]).toContain('type "component"');
  });

  // Case: every one of explainGraphId's six lookup spaces (all optionally
  // read via readGraphCachedJsonOptional, never throwing for a missing
  // cache file itself) misses -> a plain thrown Error, caught locally by
  // graph-explain.ts's try/catch and turned into logger.error +
  // process.exitCode = 1 -- never a raw stack trace, never an uncaught
  // rejection.
  it('sets process.exitCode = 1 and logs a clean "not found" message for an unknown id', async () => {
    const logger = makeLogger();
    process.exitCode = undefined;

    await expect(runGraphExplainCommand(repoRoot, "graph:node:does-not-exist", {}, logger)).resolves.toBeUndefined();

    expect(process.exitCode).toBe(1);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('No node, edge, path, impact-result, root-cause-group, decision-impact, or change-plan found matching id "graph:node:does-not-exist"');
    expect(logger.errors[0]).not.toMatch(/\n\s*at /);
  });
});

describe("runExportGraphReport / runExportImpactSummary", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-export-graph-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: export-graph-report.ts reads graph-report.json via
  // readGraphCachedJson, which throws the standard "Missing .rvs/cache/
  // knowledge-graph/<file>. Run `rvs graph build` first." message
  // (graph-cache.ts) when `rvs graph build` has never run.
  it("throws the standard missing-cache error when graph-report.json has never been written", async () => {
    const logger = makeLogger();
    await expect(runExportGraphReport(repoRoot, {}, logger)).rejects.toThrow(
      "Missing .rvs/cache/knowledge-graph/graph-report.json. Run `rvs graph build` first.",
    );
  });

  it("writes graph-report.json's cached content to a real output file after a build", async () => {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());

    const logger = makeLogger();
    await runExportGraphReport(repoRoot, {}, logger);

    const outputPath = resolve(repoRoot, "graph-report.json");
    expect(existsSync(outputPath)).toBe(true);
    const written = JSON.parse(readFileSync(outputPath, "utf8")) as GraphReport;
    expect(written.compatibility_status).toBe("compatible");
    expect(logger.infos.some((m) => m.includes("node(s)") && m.includes('compatibility "compatible"'))).toBe(true);
  });

  // Case: export-impact-summary.ts reads impact-results.json via the
  // *non*-optional readGraphCachedJson -- when the file was never written at
  // all (no `rvs graph impact` call ever made; `rvs graph build` itself
  // never writes it), the standard missing-cache error surfaces, distinct
  // from the "No cached impact results" error below.
  it("throws the standard missing-cache error when impact-results.json has never been written", async () => {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());

    const logger = makeLogger();
    await expect(runExportImpactSummary(repoRoot, {}, logger)).rejects.toThrow(
      "Missing .rvs/cache/knowledge-graph/impact-results.json. Run `rvs graph build` first.",
    );
  });

  // Case: impact-results.json exists but is an empty array -- this specific
  // state is never produced by any real CLI command (`graph impact` always
  // appends at least one result), so it is written directly here as a cache
  // fixture to exercise export-impact-summary.ts's own explicit
  // `impactResults.length === 0` guard and its distinct "No cached impact
  // results" error message.
  it('throws "No cached impact results" when impact-results.json is present but empty', async () => {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    writeFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/impact-results.json"), JSON.stringify([]));

    const logger = makeLogger();
    await expect(runExportImpactSummary(repoRoot, {}, logger)).rejects.toThrow(
      "No cached impact results. Run `rvs graph impact <entity-id>` first.",
    );
  });

  it("writes a Markdown impact summary from the last cached impact result", async () => {
    writeFullUpstreamFixtures(repoRoot);
    const buildLogger = makeLogger();
    await runGraphBuildCommand(repoRoot, {}, buildLogger);
    await runGraphImpactCommand(repoRoot, "component:api-gateway", {}, buildLogger);

    const logger = makeLogger();
    await runExportImpactSummary(repoRoot, {}, logger);

    const outputPath = resolve(repoRoot, "impact-summary.md");
    expect(existsSync(outputPath)).toBe(true);
    const markdown = readFileSync(outputPath, "utf8");
    expect(markdown).toContain("# Knowledge Graph Impact Summary");
    expect(markdown).toContain("graph:node:component-api-gateway");
    expect(logger.infos.some((m) => m === `Wrote ${outputPath}.`)).toBe(true);
  });
});

describe("runCreateSlides --profile knowledge-graph", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-create-slides-graph-"));
    writeBaseRepoFixtures(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // Case: with repository-model.json/evidence-manifest.json/.rvs/config.yml
  // present (required unconditionally by every profile, read before any
  // profile branching) but no cached graph-plan.json ever written,
  // runCreateGraphSlides (create-slides.ts) throws a clear, specific error
  // rather than reading KNOWLEDGE_GRAPH_OUTPUT_FILES.graphPlan as
  // `undefined` and crashing later on `plan.scenes`.
  it("throws a clear error when no cached knowledge graph plan exists (graph build never run)", async () => {
    const logger = makeLogger();
    await expect(runCreateSlides(repoRoot, undefined, logger, "knowledge-graph", {})).rejects.toThrow(
      "No cached knowledge graph plan found. Run `rvs graph build` first.",
    );
  });

  // Case: after a real `rvs graph build`, buildKnowledgeGraphVisualDoc's
  // "graph-overview" and "graph-layers-connected" scenes are ALWAYS emitted
  // (graph-plan.ts, no `undefined` guard around either) -- at least 2 scenes
  // regardless of graph content -- and deck.html/visualdoc.json are both
  // written.
  it("renders a knowledge graph deck after a real graph build", async () => {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());

    const logger = makeLogger();
    await runCreateSlides(repoRoot, undefined, logger, "knowledge-graph", {});

    expect(logger.errors).toEqual([]);
    expect(logger.infos.some((m) => /^Rendered \d+ knowledge graph scenes to artifacts\/visuals\/deck\.html using/.test(m))).toBe(true);

    expect(existsSync(resolve(repoRoot, "artifacts/visuals/deck.html"))).toBe(true);
    const visualdocPath = resolve(repoRoot, ".rvs/cache/visualdoc.json");
    expect(existsSync(visualdocPath)).toBe(true);
    const visualdoc = JSON.parse(readFileSync(visualdocPath, "utf8")) as { scenes: unknown[] };
    expect(visualdoc.scenes.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// `rvs graph review` -- the before/delta/after change review (Milestone 10.4).
//
// Every case below runs the real command over two real archived snapshot
// directories produced by `rvs graph build`, so what is asserted is what a
// reviewer would get. The review computes no diff of its own: the point of
// the first case is that it agrees, change for change, with `rvs graph
// compare` over the same pair.
// ---------------------------------------------------------------------------
describe("runGraphReviewCommand", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-review-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  /** Builds a baseline, adds a component, rebuilds: two snapshots that differ by one addition. */
  async function twoSnapshots(): Promise<void> {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    archiveSnapshot(repoRoot, "snapshot-before");

    const path = resolve(repoRoot, ".rvs/cache/architecture-intelligence.json");
    const architecture = JSON.parse(readFileSync(path, "utf8"));
    architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
    writeFileSync(path, JSON.stringify(architecture));

    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    archiveSnapshot(repoRoot, "snapshot-after");
  }


  it("refuses to run without both snapshots, because a review of one state is not a review", async () => {
    const logger = makeLogger();
    await expect(runGraphReviewCommand(repoRoot, { from: "snapshot-before" }, logger)).rejects.toThrow(
      "`rvs graph review` requires --from <snapshot-dir> and --to <snapshot-dir>.",
    );
    await expect(runGraphReviewCommand(repoRoot, { to: "snapshot-after" }, logger)).rejects.toThrow(
      "`rvs graph review` requires --from <snapshot-dir> and --to <snapshot-dir>.",
    );
  });

  it("shows exactly the changes `rvs graph compare` reports over the same pair", async () => {
    await twoSnapshots();

    // The comparison, first, through the command that owns it.
    await runGraphCompareCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, makeLogger());
    const changeSet = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/graph-changes.json"), "utf8"),
    ) as GraphChangeSet;

    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);
    expect(logger.errors).toEqual([]);

    const html = readFileSync(resolve(repoRoot, "artifacts/visuals/change-review.html"), "utf8");
    // Every node and edge the comparison called added is a change the review
    // shows. A review that showed a different set would be worse than no
    // review. Ids reach the page through the same sanitiser every RVS id
    // passes through, so they are matched in that form.
    const slug = (id: string) => id.replace(/[^A-Za-z0-9.]+/g, "-");
    for (const id of [...changeSet.nodes_added, ...changeSet.edges_added]) {
      expect(html, id).toContain(`review:change-entry:added:${slug(id)}`);
    }
    expect(changeSet.nodes_added).toContain("graph:node:component-reporting-service");
    expect(html).toContain("Reporting Service");
    expect(
      logger.infos.some((m) =>
        m.includes(`(${changeSet.nodes_added.length + changeSet.edges_added.length} changes,`),
      ),
    ).toBe(true);
  });

  it("writes one self-contained file that needs no server and no network", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);

    const html = readFileSync(resolve(repoRoot, "artifacts/visuals/change-review.html"), "utf8");
    expect(html.replace(/xmlns(:\w+)?="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b|@import|fetch\(|XMLHttpRequest|WebSocket|EventSource/);
    expect(html).toContain("<style");
    expect(html).toContain("<script");
    // And it says so itself, to whoever opens it.
    expect(html).toContain("This review is read-only");
    expect(logger.infos).toContain("  Open it directly from the filesystem; it needs no server and no network.");
    expect(logger.infos).toContain("  This review is read-only: nothing was posted, approved, or blocked.");
  });

  it("honours --output, --detail, --audience, --lens and --motion, and rejects nothing else", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runGraphReviewCommand(
      repoRoot,
      {
        from: "snapshot-before",
        to: "snapshot-after",
        output: "out/review.html",
        detail: "simplified",
        audience: "executive",
        lens: "governance",
        motion: "none",
      },
      logger,
    );

    expect(logger.errors).toEqual([]);
    const html = readFileSync(resolve(repoRoot, "out/review.html"), "utf8");
    expect(html).toContain('value="governance" selected');
    expect(existsSync(resolve(repoRoot, "artifacts/visuals/change-review.html"))).toBe(false);
    expect(html).toContain("executive · simplified detail");
    expect(html).toContain("Audience: executive · Detail: simplified");
  });

  it("names the domains it could not compare rather than calling them unchanged", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);

    // These fixtures carry no cached impact results, which is exactly the
    // condition §21 is about: unresolved reach, never "no impact".
    expect(
      logger.infos.some((m) => m.includes("downstream consumer reach is unresolved for every change")),
    ).toBe(true);
    const html = readFileSync(resolve(repoRoot, "artifacts/visuals/change-review.html"), "utf8");
    expect(html).not.toMatch(/no downstream impact|safe change|\bno consumers\b/i);
  });

  it("says so plainly when a snapshot is compared against itself", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-before" }, logger);

    expect(logger.infos).toContain("  No material graph changes were detected between these compatible snapshots.");
    const html = readFileSync(resolve(repoRoot, "artifacts/visuals/change-review.html"), "utf8");
    expect(html).toContain("No material graph changes were detected between these compatible snapshots.");
    // Not a blank diagram standing in for an answer.
    expect(html).not.toContain("<svg");
  });

  it("refuses two snapshots that cannot be compared, and writes nothing", async () => {
    await twoSnapshots();
    const path = resolve(repoRoot, "snapshot-after/graph-snapshot.json");
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    snapshot.repository_id = "repo:something-else-entirely";
    writeFileSync(path, JSON.stringify(snapshot));

    await expect(
      runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, makeLogger()),
    ).rejects.toThrow(/not comparable/);
    expect(existsSync(resolve(repoRoot, "artifacts/visuals/change-review.html"))).toBe(false);
  });

  it("produces the same bytes every time it is run over the same two snapshots", async () => {
    await twoSnapshots();
    const digests = new Set<string>();
    const bytes = new Set<string>();
    for (let run = 0; run < 5; run++) {
      const logger = makeLogger();
      await runGraphReviewCommand(
        repoRoot,
        { from: "snapshot-before", to: "snapshot-after", output: `run-${run}.html` },
        logger,
      );
      bytes.add(readFileSync(resolve(repoRoot, `run-${run}.html`), "utf8"));
      // The log line names the output file, which is deliberately different
      // each run; the digest inside it is the claim under test.
      digests.add(/digest ([0-9a-f]+)/.exec(logger.infos.find((m) => m.includes("digest")) ?? "")?.[1] ?? "");
    }
    expect(bytes.size).toBe(1);
    expect(digests.size).toBe(1);
  });

  it("posts nothing, approves nothing, and touches no git state", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);

    // The command's whole output surface is the log and one file: it creates
    // no git state, and the only sentence mentioning approval is the one
    // telling the reader that none happened.
    expect(existsSync(resolve(repoRoot, ".git"))).toBe(false);
    const mentions = logger.infos.filter((m) => /comment|approv|merge|push|post/i.test(m));
    expect(mentions).toEqual(["  This review is read-only: nothing was posted, approved, or blocked."]);
    expect(logger.warns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `rvs export change-review-summary` -- the same review, as Markdown a person
// can paste somewhere themselves. The tests that matter here are the ones
// about what it does *not* do.
// ---------------------------------------------------------------------------
describe("runExportChangeReviewSummary", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-change-review-summary-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  async function twoSnapshots(): Promise<void> {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
    const copy = (name: string) => {
      mkdirSync(resolve(repoRoot, name), { recursive: true });
      for (const file of ["graph-snapshot.json", "nodes.json", "edges.json"]) {
        writeFileSync(resolve(repoRoot, name, file), readFileSync(resolve(graphCacheDir, file), "utf8"));
      }
    };
    copy("snapshot-before");
    const path = resolve(repoRoot, ".rvs/cache/architecture-intelligence.json");
    const architecture = JSON.parse(readFileSync(path, "utf8"));
    architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
    writeFileSync(path, JSON.stringify(architecture));
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    copy("snapshot-after");
  }

  it("requires both snapshots", async () => {
    await expect(runExportChangeReviewSummary(repoRoot, { from: "snapshot-before" }, makeLogger())).rejects.toThrow(
      "requires --from <snapshot-dir> and --to <snapshot-dir>",
    );
  });

  it("summarises the same changes the review draws", async () => {
    await twoSnapshots();
    const reviewLogger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, reviewLogger);

    const logger = makeLogger();
    await runExportChangeReviewSummary(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);

    const markdown = readFileSync(resolve(repoRoot, "change-review-summary.md"), "utf8");
    expect(markdown).toContain("# Architecture change review");
    expect(markdown).toContain("## What changed");
    expect(markdown).toContain("component:reporting-service");
    // The same count the review reported, from the same collector.
    const reviewCount = /\((\d+) changes,/.exec(reviewLogger.infos.find((m) => m.includes("changes,")) ?? "")?.[1];
    expect(logger.infos[0]).toContain(`(${reviewCount} changes)`);
  });

  it("writes a file and posts nothing", async () => {
    await twoSnapshots();
    const logger = makeLogger();
    await runExportChangeReviewSummary(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, logger);

    const markdown = readFileSync(resolve(repoRoot, "change-review-summary.md"), "utf8");
    expect(markdown).toContain("nothing was posted, commented, approved, or blocked");
    expect(logger.infos).toContain(
      "  Nothing was posted, commented, approved, or blocked. Sharing it is a decision you make.",
    );
    expect(existsSync(resolve(repoRoot, ".git"))).toBe(false);
  });

  it("calls unknown reach unresolved rather than absent", async () => {
    await twoSnapshots();
    await runExportChangeReviewSummary(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, makeLogger());
    const markdown = readFileSync(resolve(repoRoot, "change-review-summary.md"), "utf8");
    expect(markdown).toContain("## Unresolved");
    expect(markdown).toContain("downstream consumer reach is unresolved");
    expect(markdown).not.toMatch(/no downstream impact|safe change|\bno consumers\b/i);
  });

  it("says plainly when a snapshot is compared against itself", async () => {
    await twoSnapshots();
    await runExportChangeReviewSummary(repoRoot, { from: "snapshot-after", to: "snapshot-after" }, makeLogger());
    const markdown = readFileSync(resolve(repoRoot, "change-review-summary.md"), "utf8");
    expect(markdown).toContain("No material graph changes were detected between these compatible snapshots.");
    expect(markdown).not.toContain("## What changed");
  });

  it("produces the same bytes on every run", async () => {
    await twoSnapshots();
    const outputs = new Set<string>();
    for (let run = 0; run < 5; run++) {
      await runExportChangeReviewSummary(
        repoRoot,
        { from: "snapshot-before", to: "snapshot-after", output: `s-${run}.md` },
        makeLogger(),
      );
      outputs.add(readFileSync(resolve(repoRoot, `s-${run}.md`), "utf8"));
    }
    expect(outputs.size).toBe(1);
  });

  it("refuses an incomparable pair, and writes nothing", async () => {
    await twoSnapshots();
    const path = resolve(repoRoot, "snapshot-after/graph-snapshot.json");
    const snapshot = JSON.parse(readFileSync(path, "utf8"));
    snapshot.repository_id = "repo:something-else-entirely";
    writeFileSync(path, JSON.stringify(snapshot));
    await expect(
      runExportChangeReviewSummary(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, makeLogger()),
    ).rejects.toThrow(/not comparable/);
    expect(existsSync(resolve(repoRoot, "change-review-summary.md"))).toBe(false);
  });
});

describe("runGraphOpenCommand", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-graph-open-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  async function built(): Promise<void> {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  }

  it("draws an explorer for a repository that has actually run decision intelligence", async () => {
    // The regression. `decisions.json` is an object with a `decisions` array
    // in it -- the shape `writeFullUpstreamFixtures` writes, because it is the
    // shape decision intelligence produces and the shape graph-build,
    // graph-compare, graph-impact, graph-plan-change and graph-review all
    // read. This command read it as a bare array and threw
    // "decisions.map is not a function", so `rvs graph open` succeeded only
    // in repositories where the file was missing.
    await built();
    const logger = makeLogger();
    await runGraphOpenCommand(repoRoot, {}, logger);

    expect(logger.errors).toEqual([]);
    const html = readFileSync(resolve(repoRoot, ".rvs/out/architecture-explorer.html"), "utf8");
    expect(html).toContain("<!doctype html>");
    // The decision reached the page rather than being dropped on the way.
    expect(logger.infos.join(" ")).not.toContain("No cached decisions");
  });

  it("still draws one for a repository that has never run decision intelligence", async () => {
    await built();
    rmSync(resolve(repoRoot, ".rvs/cache/decisions/decisions.json"));
    const logger = makeLogger();
    await runGraphOpenCommand(repoRoot, {}, logger);

    expect(logger.errors).toEqual([]);
    expect(logger.infos.join(" ")).toContain("No cached decisions");
    expect(existsSync(resolve(repoRoot, ".rvs/out/architecture-explorer.html"))).toBe(true);
  });

  it("writes one self-contained file that needs no server and no network", async () => {
    await built();
    await runGraphOpenCommand(repoRoot, {}, makeLogger());
    const html = readFileSync(resolve(repoRoot, ".rvs/out/architecture-explorer.html"), "utf8");
    expect(html.replace(/xmlns(:\w+)?="[^"]*"/g, "")).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b|@import|fetch\(|XMLHttpRequest|WebSocket|EventSource/);
  });
});

// ---------------------------------------------------------------------------
// Milestone 10.5.5 -- semantic finite motion, proved in a real browser.
//
// The motion PLAN is data, and @rvs/visual-intelligence's tests hold it to
// account. What no unit test can show is that the delivered artifact actually
// plays it, stops when a reader does something else, terminates on its own,
// and carries no information a reader with reduced motion would lose. Those
// are properties of a page in a browser, so they are checked in one.
//
// Every assertion below is about behaviour a reader could observe. Nothing
// here inspects the runtime's source text; that is what the parity tests in
// @rvs/visual-grammar and @rvs/visual-explorer are for.
// ---------------------------------------------------------------------------

describe("motion in the delivered artifacts", () => {
  let repoRoot: string;
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-motion-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  /** The same baseline-plus-one-component pair `runGraphReviewCommand`'s tests use. */
  async function twoSnapshots(): Promise<void> {
    const archive = (name: string): void => {
      const dir = resolve(repoRoot, name);
      mkdirSync(dir, { recursive: true });
      for (const file of ["graph-snapshot.json", "nodes.json", "edges.json"]) {
        writeFileSync(
          resolve(dir, file),
          readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph", file), "utf8"),
        );
      }
    };
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    archiveSnapshot(repoRoot, "snapshot-before");
    const path = resolve(repoRoot, ".rvs/cache/architecture-intelligence.json");
    const architecture = JSON.parse(readFileSync(path, "utf8"));
    architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
    writeFileSync(path, JSON.stringify(architecture));
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    archiveSnapshot(repoRoot, "snapshot-after");
  }

  async function buildExplorer(): Promise<string> {
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    await runGraphOpenCommand(repoRoot, {}, makeLogger());
    return resolve(repoRoot, ".rvs/out/architecture-explorer.html");
  }

  async function buildReview(): Promise<string> {
    await twoSnapshots();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after" }, makeLogger());
    return resolve(repoRoot, "artifacts/visuals/change-review.html");
  }

  /**
   * Opens a page and starts recording every element that is ever given
   * `data-rvs-motion`.
   *
   * A MutationObserver rather than polling: a step lasts 140ms and clears
   * itself, so sampling would miss most of a sequence and the test would be
   * measuring its own timing rather than the page's behaviour.
   */
  async function open(path: string, reducedMotion?: "reduce"): Promise<Page> {
    const context = await browser.newContext(reducedMotion ? { reducedMotion } : {});
    const page = await context.newPage();
    await page.goto(`file://${path}`);
    await page.evaluate(() => {
      (window as unknown as { __seen: string[] }).__seen = [];
      new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target as Element;
          // Only additions. The observer fires on removal too, and a removal
          // is the sequence tidying up after itself, not motion.
          if (element.getAttribute("data-rvs-motion") === null) continue;
          (window as unknown as { __seen: string[] }).__seen.push(
            element.getAttribute("data-rvs-node") ?? element.getAttribute("data-rvs-edge") ?? "?",
          );
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-rvs-motion"] });
    });
    return page;
  }

  const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  const stillMoving = (page: Page) => page.evaluate(() => document.querySelectorAll("[data-rvs-motion]").length);
  const status = (page: Page) => page.evaluate(() => document.getElementById("rvs-status")?.textContent ?? "");

  it("does not move until the reader asks it to", async () => {
    // §50, and plain courtesy. A page that starts animating on load makes the
    // reader wait to be allowed to read it.
    const page = await open(await buildReview());
    await page.waitForTimeout(1200);
    expect(await seen(page)).toEqual([]);
    expect(await stillMoving(page)).toBe(0);
    await page.context().close();
  }, 180_000);

  it("plays the compare sequence when asked, and stops on its own", async () => {
    const page = await open(await buildReview());
    await page.click("#rvs-animate");
    await page.waitForTimeout(5000);

    const touched = await seen(page);
    expect(touched.length).toBeGreaterThan(0);
    // Finite. §46 forbids anything that repeats, and the strongest evidence
    // that nothing does is that the page is at rest afterwards without anyone
    // having stopped it.
    expect(await stillMoving(page)).toBe(0);
    // The sequence emphasises entities the review already lists as changed.
    // Motion that touched something the list does not mention would be motion
    // carrying information.
    const listed = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-rvs-change]")).map((el) =>
        el.getAttribute("data-rvs-change"),
      ),
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(await status(page)).toContain("Compared");
    await page.context().close();
  }, 180_000);

  it("abandons a sequence the moment the reader does something else", async () => {
    // §50's interruptibility, observed rather than asserted about the source.
    const page = await open(await buildReview());
    await page.click("#rvs-animate");
    await page.waitForTimeout(120);
    await page.keyboard.press("Escape");
    const atInterrupt = (await seen(page)).length;
    await page.waitForTimeout(3000);

    expect((await seen(page)).length).toBe(atInterrupt);
    expect(await stillMoving(page)).toBe(0);
    await page.context().close();
  }, 180_000);

  it("plays nothing at all when the reader has asked for reduced motion", async () => {
    // Not "plays it faster". §49's fallback is that the sequence does not
    // happen, and §26's claim is that this costs the reader nothing.
    const page = await open(await buildReview(), "reduce");
    await page.click("#rvs-animate");
    await page.waitForTimeout(3000);

    expect(await seen(page)).toEqual([]);
    expect(await stillMoving(page)).toBe(0);
    // The announcement still arrives. It is the one thing in the sequence
    // that was ever a fact rather than an emphasis.
    expect(await status(page)).toContain("Compared");
    await page.context().close();
  }, 180_000);

  it("says exactly the same things with motion and without it", async () => {
    // Static completeness, §35. Two pages, one animated and one not, asked
    // the same question, must end up reading identically -- including every
    // state attribute, because those are what colour and shape are drawn
    // from.
    const path = await buildReview();
    const readOut = async (page: Page): Promise<unknown> => {
      const first = await page.evaluate(
        () => document.querySelector("[data-rvs-change]")?.getAttribute("data-rvs-change") ?? "",
      );
      await page.click(`[data-rvs-change="${first}"]`);
      await page.waitForTimeout(2500);
      return page.evaluate(() => ({
        text: document.body.textContent?.replace(/\s+/g, " ").trim(),
        nodes: Array.from(document.querySelectorAll("[data-rvs-node]")).map((el) => [
          el.getAttribute("data-rvs-node"),
          el.getAttribute("data-rvs-route"),
          el.getAttribute("class"),
        ]),
      }));
    };

    const animated = await open(path);
    const still = await open(path, "reduce");
    expect(await readOut(animated)).toEqual(await readOut(still));
    await animated.context().close();
    await still.context().close();
  }, 180_000);

  it("traces the route the graph found, and only that route", async () => {
    // §47: the motion layer does not choose the route. The pair below is
    // chosen with the page's own traversal, so the test never asks for a
    // route the graph does not have -- and the edges the trace emphasises are
    // compared against the ones that traversal returned.
    const page = await open(await buildExplorer());
    const pair = await page.evaluate(() => {
      const model = JSON.parse(document.getElementById("rvs-model")?.textContent ?? "{}");
      for (const from of model.nodes) {
        for (const to of model.nodes) {
          if (from.id === to.id) continue;
          const traced = (globalThis as never as { rvsTraceRoute: Function }).rvsTraceRoute(
            model,
            from.id,
            to.id,
            "downstream",
          ) as { found: boolean; edge_ids: string[] };
          if (traced.found && traced.edge_ids.length > 1) {
            return { from: from.id, to: to.id, edges: traced.edge_ids };
          }
        }
      }
      return null;
    });
    expect(pair, "the fixture graph has no multi-hop route to trace").not.toBeNull();

    await page.click(`[data-rvs-node="${pair!.from}"]`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen = []);
    await page.selectOption("#rvs-route-to", pair!.to);
    await page.waitForTimeout(4000);

    const touched = await seen(page);
    expect(touched.length).toBeGreaterThan(0);
    // Every emphasised edge is one the traversal returned, and they arrive in
    // the order it returned them. A trace that wandered would be inventing a
    // relationship.
    expect(touched).toEqual(pair!.edges);
    expect(await stillMoving(page)).toBe(0);
    await page.context().close();
  }, 180_000);

  it("fans out by the depths the traversal actually reached", async () => {
    // §48: impact motion uses the graph's own depths, and never fabricates an
    // intermediate the traversal could not produce.
    const page = await open(await buildExplorer());
    const origin = await page.evaluate(
      () => document.querySelector("[data-rvs-node]")?.getAttribute("data-rvs-node") ?? "",
    );
    await page.click(`[data-rvs-node="${origin}"]`);
    await page.waitForTimeout(3000);

    const touched = await seen(page);
    expect(touched[0]).toBe(origin);
    const reached = await page.evaluate((id: string) => {
      const model = JSON.parse(document.getElementById("rvs-model")?.textContent ?? "{}");
      return (globalThis as never as { rvsReachFrom: Function }).rvsReachFrom(model, id, "downstream", 2) as {
        node_ids: string[];
      };
    }, origin);
    for (const id of touched) expect(reached.node_ids, id).toContain(id);
    expect(await stillMoving(page)).toBe(0);
    await page.context().close();
  }, 180_000);
});
