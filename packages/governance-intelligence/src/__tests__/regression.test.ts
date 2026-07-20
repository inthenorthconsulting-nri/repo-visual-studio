import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";
import { diffCapability } from "../capability-diff.js";
import { assessBlastRadius } from "../blast-radius.js";
import { evaluatePolicy } from "../policy-evaluator.js";
import { buildPolicyId, buildRuleId } from "../ids.js";
import type { CapabilityChangeSet, GovernancePolicy, GovernanceRule, ProductChangeSet } from "../contracts.js";

// ---------------------------------------------------------------------------
// Regression tests: exact severity + blast-radius outcomes for concrete,
// named scenarios, run through the REAL diff engines / real assessBlastRadius
// / real evaluatePolicy (not hand-built GovernanceChangeEntry fixtures), so
// these tests exercise the actual wiring between stages, not just each
// stage's isolated unit behavior (which policy-evaluator.test.ts and the
// per-domain diff test files already cover extensively).
//
// NOTE on a bug this file's first pass uncovered and that architecture-diff
// .ts/capability-diff.ts/product-diff.ts/portfolio-diff.ts now fix: each diff
// engine's changeset-level `.compatibility` field used to fold in every
// entry's OWN `classification.compatibility_impact` (via `worstCompatibility
// ([domainCompatibility(...), ...changes.map(c => c.classification.
// compatibility_impact)])`), so a single removed runtime entity (always
// compatibility_impact "incompatible") poisoned the WHOLE changeset to
// "incompatible" -- which made policy-evaluator.ts's evaluateEntityScopedRule
// gate (deliberately conservative: a "partial"/"incompatible" changeset means
// the computed scope can't be trusted) mask the exact removal that rules like
// require_runtime_entrypoint/forbid_component_removal/forbid_dependency_
// removal exist to catch, forcing "unverifiable" instead of "fail" for the
// one thing they're supposed to detect. See each diff engine's fix comment
// for the full rationale. Without this fix, real end-to-end runs of these
// rules could never actually fail on the violation they exist to catch --
// only hand-built test fixtures with an explicit `compatibility: "compatible"
// ` override could. This file's tests below now pass against the fixed
// behavior and would fail against the pre-fix behavior (asserting "fail",
// not "unverifiable").
// ---------------------------------------------------------------------------

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [`${id}:main`] },
    ...overrides,
  };
}

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: [component("component:api")],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: [{ id: "dependency:postgres", label: label("Postgres"), kind: "runtime", description: { value: "Primary datastore.", inference: "confirmed", evidence: [] }, evidence: [{ path: "infra/postgres.tf" }] }],
    questions: [],
    workflowFamilies: [],
    metadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: GENERATED_AT, workflow_graph_count: 0, terraform_topology_count: 0, assist_used: false },
    ...overrides,
  };
}

function archSnapshotFor(architecture: unknown) {
  return buildIntelligenceSnapshot({ architecture, generatedAt: GENERATED_AT });
}

function capability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: id,
    shortDescription: `${id} short description`,
    purpose: `${id} purpose`,
    domainId: "domain:core",
    status: "operational",
    confidence: "confirmed",
    inclusion: "include",
    readiness: { score: 90, implementationScore: 90, executionScore: 90, verificationScore: 90, documentationScore: 90, adoptionScore: 90, blockers: [], qualifiers: [] },
    actors: [],
    workflows: [],
    logicalComponents: ["component:api"],
    externalSystems: [],
    evidence: [{ id: `${id}:ev1`, type: "implementation", sourcePath: `src/${id}.ts`, description: "impl", strength: "strong", confidence: "confirmed" }],
    matchedIncompleteSignals: [],
    naming: { sourceLabel: id, basis: "title-case" },
    granularity: "capability",
    ...overrides,
  };
}

function makeCapabilityModel(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    systemIdentity: { displayName: "Acme Widget" },
    includedCapabilities: [capability("capintel:capability:sync")],
    qualifiedCapabilities: [],
    excludedCandidates: [],
    roadmapCapabilities: [],
    gapCapabilities: [],
    unresolvedCapabilities: [],
    generationMetadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_architecture_intelligence_generated_at: GENERATED_AT, assist_used: false, candidateCount: 1 },
    ...overrides,
  };
}

function capabilitySnapshotFor(capabilityModel: unknown) {
  return buildIntelligenceSnapshot({ capability: capabilityModel, generatedAt: GENERATED_AT });
}

function emptyProductChangeSet(): ProductChangeSet {
  return { schema_version: 1, id: "changeset:product", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function emptyCapabilityChangeSet(): CapabilityChangeSet {
  return { schema_version: 1, id: "changeset:capability", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

function makeRule(kind: GovernanceRule["kind"], condition: GovernanceRule["condition"], overrides: Partial<GovernanceRule> = {}): GovernanceRule {
  const policyId = buildPolicyId("regression-test-policy");
  return {
    id: buildRuleId(policyId, overrides.id ?? kind),
    title: overrides.title ?? kind,
    description: overrides.description ?? `Rule for ${kind}`,
    kind,
    condition,
    severity: overrides.severity ?? "review_required",
    enabled: overrides.enabled ?? true,
    ...overrides,
  };
}

function makePolicy(rules: GovernanceRule[]): GovernancePolicy {
  return { schema_version: 1, id: buildPolicyId("regression-test-policy"), name: "Regression Test Policy", rules, exceptions: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } };
}

describe("regression: require_runtime_entrypoint fires with the exact expected severity on a removed entrypoint", () => {
  it("floors severity at 'review_required' (not the rule's own lower configured severity) because the removed entrypoint's evidence lineage is 'broken'", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ components: [component("component:api", { implementation: { filePaths: [`src/component:api/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [] } })] });

    const architectureChanges = diffArchitecture({ sourceSnapshot: archSnapshotFor(source), targetSnapshot: archSnapshotFor(target), sourceArtifact: source, targetArtifact: target });
    const removedEntry = architectureChanges.changes.find((c) => c.type === "removed" && c.domain_path.endsWith(".implementation.entryPoints"));
    expect(removedEntry).toBeDefined();
    // Confirms the exact deriveSeverity() path this scenario hits:
    // changeType "removed" + isRuntimeEntity raises to "advisory", then
    // lineage "broken" raises further to "review_required" -- never
    // "blocking" (classifyChange never returns blocking; only policy
    // evaluation may raise a floor to blocking).
    expect(removedEntry!.classification.governance_severity).toBe("review_required");
    expect(removedEntry!.lineage).toBe("broken");

    const rule = makeRule("require_runtime_entrypoint", { kind: "require_runtime_entrypoint" }, { severity: "advisory" });
    const result = evaluatePolicy({
      policy: makePolicy([rule]),
      sourceSnapshotId: architectureChanges.source_snapshot_id,
      targetSnapshotId: architectureChanges.target_snapshot_id,
      architectureChanges,
      capabilityChanges: emptyCapabilityChangeSet(),
      productChanges: emptyProductChangeSet(),
      blastRadius: { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      targetCompatibility: "compatible",
      generatedAt: GENERATED_AT,
      now: GENERATED_AT,
    });

    const finding = result.findings.find((f) => f.change_id === removedEntry!.id);
    expect(finding?.result).toBe("fail");
    // The rule's own configured severity ("advisory") is LOWER than the
    // change's intrinsic floor ("review_required"), so the finding's final
    // severity is raised to the floor, never lowered to the rule's setting.
    expect(finding?.severity).toBe("review_required");
  });
});

describe("regression: forbid_operational_to_planned_regression fires at the exact expected severity, and never on forward progression", () => {
  it("fires with severity floored at 'advisory' when a capability regresses from operational to partial with evidence unchanged", () => {
    const sharedEvidence = [{ id: "capintel:sync:ev1", type: "implementation", sourcePath: "src/sync.ts", description: "impl", strength: "strong", confidence: "confirmed" }];
    const source = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:sync", { status: "operational", evidence: sharedEvidence })] });
    const target = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:sync", { status: "partial", evidence: sharedEvidence })] });

    const capabilityChanges = diffCapability({ sourceSnapshot: capabilitySnapshotFor(source), targetSnapshot: capabilitySnapshotFor(target), sourceArtifact: source, targetArtifact: target });
    const reclassified = capabilityChanges.changes.find((c) => c.entity_id === "capintel:capability:sync");
    expect(reclassified?.type).toBe("reclassified");
    // Evidence held constant, so lineage stays "preserved" -- only the
    // reclassified-and-runtime-entity rules raise the floor, landing at
    // exactly "advisory" (never "review_required"/"blocking", since nothing
    // here weakens or breaks lineage).
    expect(reclassified?.classification.governance_severity).toBe("advisory");
    expect(reclassified?.lineage).toBe("preserved");

    const rule = makeRule("forbid_operational_to_planned_regression", { kind: "forbid_operational_to_planned_regression" }, { severity: "informational" });
    const result = evaluatePolicy({
      policy: makePolicy([rule]),
      sourceSnapshotId: capabilityChanges.source_snapshot_id,
      targetSnapshotId: capabilityChanges.target_snapshot_id,
      architectureChanges: { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      capabilityChanges,
      productChanges: emptyProductChangeSet(),
      blastRadius: { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      targetCompatibility: "compatible",
      generatedAt: GENERATED_AT,
      now: GENERATED_AT,
    });

    const finding = result.findings.find((f) => f.change_id === reclassified!.id);
    expect(finding?.result).toBe("fail");
    expect(finding?.severity).toBe("advisory");
  });

  it("never flags forward progression (planned to operational) as a regression -- the rule passes, and no entry is ever typed 'reclassified' for an improvement", () => {
    const sharedEvidence = [{ id: "capintel:sync:ev1", type: "implementation", sourcePath: "src/sync.ts", description: "impl", strength: "strong", confidence: "confirmed" }];
    const source = makeCapabilityModel({ roadmapCapabilities: [capability("capintel:capability:sync", { status: "planned", evidence: sharedEvidence })], includedCapabilities: [] });
    const target = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:sync", { status: "operational", evidence: sharedEvidence })], roadmapCapabilities: [] });

    const capabilityChanges = diffCapability({ sourceSnapshot: capabilitySnapshotFor(source), targetSnapshot: capabilitySnapshotFor(target), sourceArtifact: source, targetArtifact: target });
    const improved = capabilityChanges.changes.find((c) => c.entity_id === "capintel:capability:sync");
    // Forward progression (status AND bucket both improve) must never be
    // typed "reclassified" -- that type is reserved for regressions.
    expect(improved?.type).not.toBe("reclassified");

    const rule = makeRule("forbid_operational_to_planned_regression", { kind: "forbid_operational_to_planned_regression" });
    const result = evaluatePolicy({
      policy: makePolicy([rule]),
      sourceSnapshotId: capabilityChanges.source_snapshot_id,
      targetSnapshotId: capabilityChanges.target_snapshot_id,
      architectureChanges: { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      capabilityChanges,
      productChanges: emptyProductChangeSet(),
      blastRadius: { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      targetCompatibility: "compatible",
      generatedAt: GENERATED_AT,
      now: GENERATED_AT,
    });

    expect(result.findings.every((f) => f.result !== "fail")).toBe(true);
  });
});

describe("regression: require_evidence_type fails correctly on the capability domain (not just architecture)", () => {
  it("fails a capability entity whose evidence is all capability-sourced when the rule requires an architecture-sourced evidence type", () => {
    // capability-diff.ts's capabilityEvidenceRefs() always tags every ref
    // `source_artifact: "capability"` -- there is structurally no way for a
    // capability entity to ever carry "architecture"-sourced evidence, so
    // this deterministically fails for ANY non-unchanged, evidence-bearing
    // capability entity in scope, filling the gap that the existing
    // policy-evaluator.test.ts coverage (architecture-domain only) leaves.
    const source = makeCapabilityModel({ includedCapabilities: [capability("capintel:capability:sync", { evidence: [{ id: "ev1", type: "implementation", sourcePath: "src/sync.ts", description: "impl", strength: "strong", confidence: "confirmed" }] })] });
    const target = makeCapabilityModel({
      includedCapabilities: [
        capability("capintel:capability:sync", {
          evidence: [
            { id: "ev1", type: "implementation", sourcePath: "src/sync.ts", description: "impl", strength: "strong", confidence: "confirmed" },
            { id: "ev2", type: "implementation", sourcePath: "src/sync-v2.ts", description: "impl v2", strength: "strong", confidence: "confirmed" },
          ],
        }),
      ],
    });

    const capabilityChanges = diffCapability({ sourceSnapshot: capabilitySnapshotFor(source), targetSnapshot: capabilitySnapshotFor(target), sourceArtifact: source, targetArtifact: target });
    const modified = capabilityChanges.changes.find((c) => c.entity_id === "capintel:capability:sync");
    expect(modified?.type).toBe("modified");
    expect(modified!.evidence_refs.length).toBeGreaterThan(0);
    expect(modified!.evidence_refs.every((r) => r.source_artifact === "capability")).toBe(true);

    const rule = makeRule("require_evidence_type", { kind: "require_evidence_type", required_evidence_source: "architecture" });
    const result = evaluatePolicy({
      policy: makePolicy([rule]),
      sourceSnapshotId: capabilityChanges.source_snapshot_id,
      targetSnapshotId: capabilityChanges.target_snapshot_id,
      architectureChanges: { schema_version: 1, id: "changeset:architecture", source_snapshot_id: "source", target_snapshot_id: "target", compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      capabilityChanges,
      productChanges: emptyProductChangeSet(),
      blastRadius: { schema_version: 1, id: "blast-radius:test", source_snapshot_id: "source", target_snapshot_id: "target", entries: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      targetCompatibility: "compatible",
      generatedAt: GENERATED_AT,
      now: GENERATED_AT,
    });

    expect(result.findings.some((f) => f.change_id === modified!.id && f.result === "fail")).toBe(true);
  });
});

describe("regression: forbid_dependency_removal fires end-to-end with real diffing + real blast radius, blast radius reflecting the dependency removal as unresolved", () => {
  it("fails the rule, and assessBlastRadius marks the removed dependency 'unresolved' (never 'isolated'), since ArchitectureDependency carries no consumer-linkage field at all", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ dependencies: [] });

    const sourceSnapshot = archSnapshotFor(source);
    const targetSnapshot = archSnapshotFor(target);
    const architectureChanges = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const removedDependency = architectureChanges.changes.find((c) => c.domain_path === "dependencies" && c.type === "removed");
    expect(removedDependency).toBeDefined();

    const blastRadius = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges,
      capabilityChanges: emptyCapabilityChangeSet(),
      productChanges: emptyProductChangeSet(),
      sourceArchitectureArtifact: source,
      targetArchitectureArtifact: target,
      sourceCapabilityArtifact: undefined,
      targetCapabilityArtifact: undefined,
      sourcePortfolioArtifact: undefined,
      targetPortfolioArtifact: undefined,
    });
    const blastEntry = blastRadius.entries.find((e) => e.change_id === removedDependency!.id);
    expect(blastEntry?.level).toBe("unresolved");
    expect(blastEntry?.level).not.toBe("isolated");

    const rule = makeRule("forbid_dependency_removal", { kind: "forbid_dependency_removal" });
    const result = evaluatePolicy({
      policy: makePolicy([rule]),
      sourceSnapshotId: architectureChanges.source_snapshot_id,
      targetSnapshotId: architectureChanges.target_snapshot_id,
      architectureChanges,
      capabilityChanges: emptyCapabilityChangeSet(),
      productChanges: emptyProductChangeSet(),
      blastRadius,
      targetCompatibility: "compatible",
      generatedAt: GENERATED_AT,
      now: GENERATED_AT,
    });

    const finding = result.findings.find((f) => f.change_id === removedDependency!.id);
    expect(finding?.result).toBe("fail");
    expect(finding?.blast_radius).toBe("unresolved");
  });
});

describe("regression: blast radius is 'unresolved' -- NEVER 'isolated' -- for a portfolio product change when no relationship/dependency linkage data exists at all", () => {
  it("assesses a changed product as 'unresolved' when the portfolio artifact carries no `relationships` field and no `dependencyGraph.edges` on either side (structural absence of linkage data, not a confirmed zero-neighbor lookup)", () => {
    // This is the single most important invariant this package guarantees
    // (blast-radius.ts's own file-header comment): a STRUCTURAL absence of
    // any way to even ask "does anything depend on this?" must be
    // "unresolved", never guessed as "isolated" (which blast-radius.ts
    // reserves for a POSITIVE, confirmed absence of neighbors from data that
    // is actually present). blast-radius.test.ts already covers this
    // invariant for the architecture `dependencies` domain_path; this test
    // covers the analogous but structurally distinct portfolio `products`
    // domain_path case, where the deciding signal is whether `relationships`
    // is present as a field AT ALL (see blast-radius.ts's portfolioLevel()).
    const sourceSnapshot = buildIntelligenceSnapshot({ generatedAt: GENERATED_AT });
    const targetSnapshot = buildIntelligenceSnapshot({ generatedAt: GENERATED_AT });

    const portfolioChanges = {
      schema_version: 1 as const,
      id: "changeset:portfolio",
      source_snapshot_id: sourceSnapshot.id,
      target_snapshot_id: targetSnapshot.id,
      compatibility: "compatible" as const,
      changes: [
        {
          id: "governance:change:portfolio:added:product-widget",
          domain_path: "products",
          entity_id: "product:widget",
          entity_label: "Widget",
          type: "added" as const,
          compatibility: "compatible" as const,
          lineage: "preserved" as const,
          classification: {
            domain: "portfolio" as const,
            materiality: "material" as const,
            confidence: "confirmed" as const,
            governance_severity: "informational" as const,
            compatibility_impact: "compatible" as const,
            evidence_impact: "preserved" as const,
            runtime_impact: "none" as const,
            consumer_impact: "unresolved" as const,
            portfolio_impact: "affected" as const,
          },
          detail: "Added to products.",
          evidence_refs: [],
        },
      ],
      evidence_refs: [],
      generation: { generated_at: GENERATED_AT },
    };

    // Deliberately an EMPTY object -- no `relationships` key at all (not
    // even an empty array), and no `dependencyGraph` key at all -- to
    // reproduce the "structurally no way to even ask" case exactly.
    const portfolioArtifact = { portfolioId: "portfolio:acme", displayName: "Acme Portfolio" };

    const blastRadius = assessBlastRadius({
      sourceSnapshot,
      targetSnapshot,
      architectureChanges: { schema_version: 1, id: "changeset:architecture", source_snapshot_id: sourceSnapshot.id, target_snapshot_id: targetSnapshot.id, compatibility: "compatible", changes: [], evidence_refs: [], generation: { generated_at: GENERATED_AT } },
      capabilityChanges: emptyCapabilityChangeSet(),
      productChanges: emptyProductChangeSet(),
      portfolioChanges,
      sourceArchitectureArtifact: undefined,
      targetArchitectureArtifact: undefined,
      sourceCapabilityArtifact: undefined,
      targetCapabilityArtifact: undefined,
      sourcePortfolioArtifact: portfolioArtifact,
      targetPortfolioArtifact: portfolioArtifact,
    });

    const entry = blastRadius.entries.find((e) => e.change_id === "governance:change:portfolio:added:product-widget");
    expect(entry?.level).toBe("unresolved");
    expect(entry?.level).not.toBe("isolated");
  });
});
