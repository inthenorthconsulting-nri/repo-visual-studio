import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { defaultConfig, serializeConfig } from "@rvs/core";
import { runGraphBuildCommand } from "../commands/graph-build.js";

// Upstream cache fixtures, shared by every CLI test that needs a repository
// with a real knowledge graph in it.
//
// These began inside graph-cli.test.ts and moved here unchanged when the
// verified-delivery tests needed the same repository. Duplicating them would
// have been worse than moving them: two copies of a fixture drift, and a
// delivery test passing against a graph the graph tests no longer produce
// would prove nothing about the command it claims to exercise.

export function makeLogger(): Logger & { infos: string[]; warns: string[]; errors: string[] } {
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
export function writeBaseRepoFixtures(repoRoot: string): void {
  mkdirSync(resolve(repoRoot, ".rvs/cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, ".rvs/config.yml"), serializeConfig(defaultConfig("graph-cli-test")));
  writeFileSync(resolve(repoRoot, ".rvs/cache/repository-model.json"), JSON.stringify({ git: { commit: "abc1234" } }));
  writeFileSync(resolve(repoRoot, ".rvs/cache/evidence-manifest.json"), JSON.stringify({ claims: [] }));
}

export const REPOSITORY_ID = "github.com/acme/fixture-repo";

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
export function writePolicyFixture(repoRoot: string): void {
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
export function writeFullUpstreamFixtures(repoRoot: string, repositoryId: string = REPOSITORY_ID): void {
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

/** Archives the current graph cache under `name`, the way an operator keeps a baseline. */
export function archiveSnapshot(repoRoot: string, name: string): void {
  const graphCacheDir = resolve(repoRoot, ".rvs/cache/knowledge-graph");
  const dir = resolve(repoRoot, name);
  mkdirSync(dir, { recursive: true });
  for (const file of ["graph-snapshot.json", "nodes.json", "edges.json"]) {
    writeFileSync(resolve(dir, file), readFileSync(resolve(graphCacheDir, file), "utf8"));
  }
}

/** Builds a baseline, adds a component, rebuilds: two snapshots that differ by one addition. */
export async function writeTwoSnapshots(repoRoot: string): Promise<void> {
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
