import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { defaultConfig, serializeConfig } from "@rvs/core";
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCreateSlides } from "../commands/create-slides.js";
import { runExportGraphReport } from "../commands/export-graph-report.js";
import { runExportImpactSummary } from "../commands/export-impact-summary.js";
import { runGraphBuild, runGraphBuildCommand } from "../commands/graph-build.js";
import type { GraphReport } from "../commands/graph-build.js";
import { runGraphCompareCommand } from "../commands/graph-compare.js";
import { runGraphExplainCommand } from "../commands/graph-explain.js";
import { runGraphImpactCommand } from "../commands/graph-impact.js";
import { runGraphInspectCommand } from "../commands/graph-inspect.js";
import { runGraphPathCommand } from "../commands/graph-path.js";
import { runGraphPlanChangeCommand } from "../commands/graph-plan-change.js";
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

// `rvs create slides --profile knowledge-graph` (case: create-slides)
// unconditionally calls loadConfig()/readCachedJson() for
// repository-model.json/evidence-manifest.json BEFORE any profile-specific
// branching runs (see create-slides.ts's runCreateSlides top few lines,
// shared verbatim by every profile) -- so exercising the graph-specific "no
// cached plan" error requires these three fixtures to already be in place,
// mirroring decisions-cli.test.ts's/governance-cli.test.ts's
// writeBaseRepoFixtures precedent exactly.
function writeBaseRepoFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/config.yml"), serializeConfig(defaultConfig("graph-cli-test")));
  writeFileSync(resolve(repoRoot, ".rvs/cache/repository-model.json"), JSON.stringify({ git: { commit: "abc1234" } }));
  writeFileSync(resolve(repoRoot, ".rvs/cache/evidence-manifest.json"), JSON.stringify({ claims: [] }));
}

const REPOSITORY_ID = "github.com/acme/fixture-repo";

// A minimal, self-consistent, single-domain policy file: `condition: { kind:
// forbid_component_removal }` alone is schema-valid (policy-loader.ts's
// ForbidComponentRemovalConditionSchema declares every other field
// optional) -- content/enforcement behavior is irrelevant here, only that
// loadPolicyFiles() successfully parses one GovernancePolicy so
// graph-build.ts's `governance.policies` array is non-empty and
// buildPolicyId("test-policy") deterministically yields
// "governance:policy:test-policy" (governance-intelligence/src/ids.ts) --
// the exact policy_id every fixture governance finding below must reference
// for its `policy --governs--> finding` edge to resolve.
function writePolicyFixture(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/policies"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".rvs/governance.yml"),
    "schema_version: 1\npolicies:\n  - .rvs/policies/test-policy.yml\n",
  );
  writeFileSync(
    resolve(repoRoot, ".rvs/policies/test-policy.yml"),
    [
      "schema_version: 1",
      "id: test-policy",
      "name: Test Policy",
      "rules:",
      "  - id: rule-1",
      "    title: Placeholder rule",
      "    description: Placeholder rule for fixture purposes.",
      "    kind: forbid_component_removal",
      "    condition:",
      "      kind: forbid_component_removal",
      "    severity: advisory",
      "    enabled: true",
      "",
    ].join("\n"),
  );
}

/**
 * Writes a complete, cross-consistent set of upstream cache artifacts across
 * all six knowledge-graph domains (architecture/capability/product/
 * portfolio/governance/decision), designed so that a `rvs graph build`
 * against it deterministically produces:
 *   - compatibility.status "compatible" (every domain present, consistent
 *     repository_id, no schema_version/source_generated_at fields set at
 *     all so stages 3/5 of compatibility.ts's staged assessment never
 *     trigger).
 *   - zero unresolved_reference nodes / GRAPH_REFERENCE_BROKEN findings --
 *     every cross-artifact reference below (domainId, logicalComponents,
 *     workflows, currentCapabilities, affected_entity_ids, policy_id,
 *     decision_id, target_id) points at an id defined by a fixture in this
 *     same set (verified directly against node-builder.ts/edge-builder.ts's
 *     exact field-reading behavior).
 *   - exactly one "confirmed" root-cause group: two capabilities
 *     (process-payment, refund-payment) share one capability_domain
 *     (domain:payments) via `domainId`, and two distinct governance
 *     findings each `affects` a different one of those two capabilities --
 *     root-cause.ts's traceAncestors (causal-only upstream BFS) from either
 *     capability finds domain:payments as its sole ancestor (the
 *     domain--contains-->capability edge is causal), so the two findings'
 *     ancestor sets intersect in exactly one node -> "confirmed"
 *     (root-cause.ts lines 150-166).
 *   - zero blocking validation findings (serves as the "zero blocking
 *     findings" `graph validate --ci` fixture).
 */
function writeFullUpstreamFixtures(repoRoot: string, repositoryId: string = REPOSITORY_ID): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  mkdirSync(resolve(repoRoot, ".rvs/cache/governance"), { recursive: true });
  mkdirSync(resolve(repoRoot, ".rvs/cache/decisions"), { recursive: true });

  writeFileSync(
    resolve(repoRoot, ".rvs/cache/architecture-intelligence.json"),
    JSON.stringify({
      identity: { id: repositoryId, name: { displayLabel: "Fixture Repo" } },
      components: [
        {
          id: "component:api-gateway",
          label: { displayLabel: "API Gateway" },
          implementation: { entryPoints: ["src/gateway/main.ts"] },
        },
        { id: "component:billing-service", label: { displayLabel: "Billing Service" } },
      ],
      workflowFamilies: [{ id: "workflow:checkout", label: { displayLabel: "Checkout" } }],
      flows: [
        {
          id: "flow:gateway-to-billing",
          label: "Gateway calls Billing",
          fromId: "component:api-gateway",
          toId: "component:billing-service",
        },
      ],
    }),
  );

  writeFileSync(
    resolve(repoRoot, ".rvs/cache/capability-model.json"),
    JSON.stringify({
      domains: [{ id: "domain:payments", displayName: "Payments" }],
      includedCapabilities: [
        {
          id: "capability:process-payment",
          displayName: "Process Payment",
          domainId: "domain:payments",
          logicalComponents: ["component:billing-service"],
          workflows: ["workflow:checkout"],
        },
        {
          id: "capability:refund-payment",
          displayName: "Refund Payment",
          domainId: "domain:payments",
          logicalComponents: ["component:billing-service"],
        },
      ],
    }),
  );

  writeFileSync(
    resolve(repoRoot, ".rvs/cache/product-identity-model.json"),
    JSON.stringify({
      identity: {
        displayName: "Fixture Product",
        currentCapabilities: ["capability:process-payment"],
        qualifiedCapabilities: ["capability:refund-payment"],
        evidence: [{ id: "evidence:product-overview", sourcePath: "docs/product.md", text: "Fixture product overview." }],
      },
    }),
  );

  writeFileSync(
    resolve(repoRoot, ".rvs/cache/portfolio-model.json"),
    JSON.stringify({
      products: [{ id: "product:fixture-app", displayName: "Fixture App", currentCapabilityIds: ["capability:process-payment"] }],
    }),
  );

  writePolicyFixture(repoRoot);
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/governance/governance-report.json"),
    JSON.stringify({
      repository_id: repositoryId,
      findings: [
        {
          id: "finding:process-payment-review",
          policy_id: "governance:policy:test-policy",
          statement: "Process Payment capability requires additional review.",
          affected_entity_ids: ["capability:process-payment"],
        },
        {
          id: "finding:refund-payment-review",
          policy_id: "governance:policy:test-policy",
          statement: "Refund Payment capability requires additional review.",
          affected_entity_ids: ["capability:refund-payment"],
        },
      ],
    }),
  );

  writeFileSync(resolve(repoRoot, ".rvs/cache/decisions/decision-snapshot.json"), JSON.stringify({ repository_id: repositoryId }));
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/decisions/decisions.json"),
    JSON.stringify({ decisions: [{ id: "decision:use-stripe", title: "Use Stripe for payments", decision_status: "accepted" }] }),
  );
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/decisions/assumptions.json"),
    JSON.stringify([{ id: "assumption:stripe-uptime", decision_id: "decision:use-stripe", statement: "Stripe maintains high uptime." }]),
  );
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/decisions/consequences.json"),
    JSON.stringify([{ id: "consequence:stripe-lockin", decision_id: "decision:use-stripe", statement: "Vendor lock-in to Stripe APIs." }]),
  );
  writeFileSync(
    resolve(repoRoot, ".rvs/cache/decisions/decision-links.json"),
    JSON.stringify([
      {
        id: "link:decision-to-capability",
        decision_id: "decision:use-stripe",
        target_id: "capability:process-payment",
        link_type: "implements",
        resolution: "resolved",
        detail: "Decision implements the Process Payment capability.",
      },
    ]),
  );
}

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
