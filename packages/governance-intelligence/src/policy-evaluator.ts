import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import type {
  ArchitectureChangeSet,
  BlastRadiusAssessment,
  BlastRadiusLevel,
  CapabilityChangeSet,
  EvidenceRef,
  ForbidApprovedClaimWithoutLineageCondition,
  ForbidComponentRemovalCondition,
  ForbidDependencyRemovalCondition,
  ForbidOperationalToPlannedRegressionCondition,
  GovernanceChangeEntry,
  GovernanceCompatibilityStatus,
  GovernanceEvaluation,
  GovernanceException,
  GovernanceFinding,
  GovernancePolicy,
  GovernancePolicyResult,
  GovernanceRule,
  GovernanceSeverity,
  LimitUnresolvedRelationshipsCondition,
  PortfolioChangeSet,
  ProductChangeSet,
  RequireCapabilityStatusAtLeastCondition,
  RequireCompatibleSnapshotCondition,
  RequireEvidenceTypeCondition,
  RequireProductRoleCondition,
  RequireRuntimeEntrypointCondition,
  RequireSharedContractForDependencyCondition,
} from "./contracts.js";
import { dedupeEvidenceRefs, sortEvidenceRefs } from "./diff-utils.js";
import { buildEvaluationId, buildFindingId } from "./ids.js";

// ---------------------------------------------------------------------------
// evaluatePolicy -- the core governance engine. One pure evaluator function
// per GovernanceRuleKind (11 kinds), dispatched from a single switch in
// `evaluateRule` below. Every evaluator is deliberately conservative: a
// change set whose own `.compatibility` is "partial"/"incompatible" (or an
// individual change whose data genuinely lacks the field a rule needs)
// yields `result: "unverifiable"`, NEVER a silently-assumed "pass" -- this is
// the single most important invariant this module implements (see
// contracts.ts's GovernancePolicyResult and the top-of-file determinism
// note).
//
// Finding shape convention used throughout: a finding tied to one real
// GovernanceChangeEntry carries that entry's own `id` as `change_id` and has
// its severity floored by that entry's `classification.governance_severity`
// (contracts.ts: "can only raise, never lower" the change's own intrinsic
// severity). A finding that summarizes a whole rule's scope (a clean "pass"
// across every matching entity, a changeset-level "unverifiable", or a
// "not_applicable" because nothing in scope exists at all) has no single
// underlying change, so it carries `change_id: undefined` and its severity
// is simply `rule.severity` (or the max across every scope entity it
// summarizes, for aggregate "pass" findings -- see `aggregateFinding`).
// ---------------------------------------------------------------------------

export interface EvaluatePolicyInput {
  policy: GovernancePolicy;
  sourceSnapshotId: string;
  targetSnapshotId: string;
  architectureChanges: ArchitectureChangeSet;
  capabilityChanges: CapabilityChangeSet;
  productChanges: ProductChangeSet;
  portfolioChanges?: PortfolioChangeSet;
  blastRadius: BlastRadiusAssessment;
  targetCompatibility: GovernanceCompatibilityStatus;
  /** Caller-supplied wall-clock timestamp for `GovernanceEvaluation.generation.generated_at` -- this package never calls Date/Math.random itself (see snapshot.ts's `generatedAt` convention). */
  generatedAt: string;
  /**
   * Caller-supplied "as of" timestamp (ISO string) used ONLY to decide
   * whether a `GovernanceException.expiry` has passed. Deliberately a
   * separate field from `generatedAt`: a caller may want to evaluate
   * exceptions as of a different reference instant than the evaluation's own
   * generation timestamp (e.g. replaying a past evaluation). Not part of the
   * brief's itemized input-shape list, but required by its own exception
   * rules ("never Date.now() inside this package") -- see this module's
   * doc comment / the stage report for this deviation.
   */
  now: string;
}

// ---------------------------------------------------------------------------
// Small local rank tables. Deliberately re-declared here rather than
// exported from change-classification.ts/diff-utils.ts, matching this
// package's established pattern (see diff-utils.ts's own file header) of
// duplicating small private tables instead of widening an already-scaffolded
// file's public surface.
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<GovernanceSeverity, number> = {
  informational: 0,
  advisory: 1,
  review_required: 2,
  blocking: 3,
};

function maxSeverity(a: GovernanceSeverity, b: GovernanceSeverity): GovernanceSeverity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

const COMPATIBILITY_RANK: Record<GovernanceCompatibilityStatus, number> = {
  compatible: 0,
  compatible_with_warnings: 1,
  partial: 2,
  incompatible: 3,
};

/** Mirrors capability-diff.ts's private BUCKET_RANK. See `evaluateRequireCapabilityStatusAtLeast`'s doc comment for why this rule reads a capability's CapabilityChangeSet `domain_path` (its bucket) as the closest available, fully-structured proxy for "status". */
const CAPABILITY_BUCKET_RANK: Record<string, number> = {
  includedCapabilities: 5,
  qualifiedCapabilities: 4,
  roadmapCapabilities: 3,
  gapCapabilities: 2,
  excludedCandidates: 1,
  unresolvedCapabilities: 0,
};

const SEVERITY_FINDING_RANK: Record<GovernanceSeverity, number> = {
  blocking: 0,
  review_required: 1,
  advisory: 2,
  informational: 3,
};

// ---------------------------------------------------------------------------
// Pattern matching -- every condition's `*_pattern` field is untrusted YAML
// input (spec §47). A pattern is treated as a regular expression; an
// unparsable regex falls back to an exact-string match rather than throwing
// mid-evaluation (a malformed pattern should make a rule under-match, never
// crash a whole governance run).
// ---------------------------------------------------------------------------

function matchesPattern(id: string, pattern: string | undefined): boolean {
  if (pattern === undefined) return true;
  try {
    return new RegExp(pattern).test(id);
  } catch {
    return id === pattern;
  }
}

// ---------------------------------------------------------------------------
// Finding construction helpers
// ---------------------------------------------------------------------------

function blastRadiusLevelFor(blastRadius: BlastRadiusAssessment, changeId: string): BlastRadiusLevel | undefined {
  return blastRadius.entries.find((entry) => entry.change_id === changeId)?.level;
}

/** A finding tied to exactly one real GovernanceChangeEntry. */
function entityFinding(args: {
  rule: GovernanceRule;
  policy: GovernancePolicy;
  entry: GovernanceChangeEntry;
  result: GovernancePolicyResult;
  statement: string;
  blastRadius: BlastRadiusAssessment;
}): GovernanceFinding {
  const { rule, policy, entry, result, statement, blastRadius } = args;
  const severity = maxSeverity(rule.severity, entry.classification.governance_severity);
  return {
    // BUG FIX: this id must be scoped by rule, not just by policy -- when two
    // rules in the same policy both match the same change entry (the
    // package explicitly supports this: see adversarial.test.ts's
    // "contradictory/overlapping policy rules" scenario), the OLD
    // `buildFindingId(policy.id, entry.id)` produced byte-identical ids for
    // both rules' findings, a real collision that validation.ts's own
    // GOVERNANCE_DUPLICATE_FINDING_ID check would flag as invalid, and that
    // explain.ts's `report.findings.find((finding) => finding.id === id)`
    // would silently resolve to the wrong finding for. aggregateFinding()
    // just below already scopes its id by `rule.id`; entityFinding() must do
    // the same. `rule.id` (buildRuleId) already embeds `policy.id`, so this
    // keeps the id policy-scoped too.
    id: buildFindingId(rule.id, entry.id),
    policy_id: policy.id,
    rule_id: rule.id,
    change_id: entry.id,
    result,
    severity,
    statement,
    affected_entity_ids: [entry.entity_id],
    blast_radius: blastRadiusLevelFor(blastRadius, entry.id),
    human_review_required: result === "fail" || result === "unverifiable",
    excepted: false,
    evidence_refs: sortEvidenceRefs(dedupeEvidenceRefs(entry.evidence_refs)),
  };
}

/** A finding that summarizes a whole rule's evaluated scope rather than one specific change (not_applicable / changeset-level unverifiable / aggregate pass). */
function aggregateFinding(args: {
  rule: GovernanceRule;
  policy: GovernancePolicy;
  result: GovernancePolicyResult;
  statement: string;
  suffix: string;
  scope?: GovernanceChangeEntry[];
}): GovernanceFinding {
  const { rule, policy, result, statement, suffix, scope = [] } = args;
  const severity = scope.reduce((floor, entry) => maxSeverity(floor, entry.classification.governance_severity), rule.severity);
  const affectedEntityIds = [...new Set(scope.map((entry) => entry.entity_id))].sort();
  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(scope.flatMap((entry) => entry.evidence_refs)));
  return {
    id: buildFindingId(policy.id, `${rule.id}:${suffix}`),
    policy_id: policy.id,
    rule_id: rule.id,
    result,
    severity,
    statement,
    affected_entity_ids: affectedEntityIds,
    human_review_required: result === "fail" || result === "unverifiable",
    excepted: false,
    evidence_refs: evidenceRefs,
  };
}

// ---------------------------------------------------------------------------
// Shared shape: "scan one changeset for entities matching a domain filter,
// classify each as fail/pass/unverifiable". Used by every single-domain,
// entity-scoped rule kind (1, 2, 4, 6). Cross-domain / count-based / global
// rule kinds (3, 5, 7, 8, 9, 10, 11) have their own dedicated functions below
// since their scope/compatibility gating doesn't fit this exact shape.
// ---------------------------------------------------------------------------

type EntityVerdict = "fail" | "pass" | "unverifiable";

function evaluateEntityScopedRule(args: {
  rule: GovernanceRule;
  policy: GovernancePolicy;
  blastRadius: BlastRadiusAssessment;
  changeSetCompatibility: GovernanceCompatibilityStatus;
  allChanges: GovernanceChangeEntry[];
  scopeFilter: (entry: GovernanceChangeEntry) => boolean;
  classify: (entry: GovernanceChangeEntry) => EntityVerdict;
  statementFor: (entry: GovernanceChangeEntry, verdict: EntityVerdict) => string;
  notApplicableStatement: string;
  unverifiableStatement: string;
  aggregatePassStatement: (scope: GovernanceChangeEntry[]) => string;
}): GovernanceFinding[] {
  const { rule, policy, blastRadius } = args;

  // Compatibility gate FIRST, before scope is even trusted: a "partial"/
  // "incompatible" changeset means we cannot trust that the scope we'd
  // compute from it is even complete, so nothing downstream of it may be
  // silently treated as a clean "not_applicable" or "pass".
  if (args.changeSetCompatibility === "partial" || args.changeSetCompatibility === "incompatible") {
    return [aggregateFinding({ rule, policy, result: "unverifiable", statement: args.unverifiableStatement, suffix: "unverifiable" })];
  }

  const scope = args.allChanges.filter(args.scopeFilter);
  if (scope.length === 0) {
    return [aggregateFinding({ rule, policy, result: "not_applicable", statement: args.notApplicableStatement, suffix: "not-applicable" })];
  }

  const findings: GovernanceFinding[] = [];
  for (const entry of scope) {
    const verdict = args.classify(entry);
    if (verdict === "pass") continue;
    findings.push(entityFinding({ rule, policy, entry, result: verdict, statement: args.statementFor(entry, verdict), blastRadius }));
  }

  if (findings.length === 0) {
    findings.push(aggregateFinding({ rule, policy, result: "pass", statement: args.aggregatePassStatement(scope), suffix: "pass", scope }));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 1. forbid_component_removal
//
// Judgment call: `condition.component_type` cannot be applied as a filter.
// GovernanceChangeEntry (contracts.ts) carries no component-kind field --
// architecture-diff.ts's `makeEntry` never copies the source LogicalComponent
// `kind` onto the change entry, only `domain_path`/`entity_id`/`detail`. Since
// the brief allows "skip the filter and document that as a known scope
// narrowing if the type info isn't carried on the change entry", this
// evaluator scopes ONLY by `component_id_pattern` and ignores
// `component_type` entirely (a rule that sets it still evaluates, just
// without that extra narrowing).
// ---------------------------------------------------------------------------

function evaluateForbidComponentRemoval(rule: GovernanceRule, policy: GovernancePolicy, changes: ArchitectureChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as ForbidComponentRemovalCondition;
  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => entry.domain_path === "components" && matchesPattern(entry.entity_id, condition.component_id_pattern),
    classify: (entry) => (entry.type === "removed" ? "fail" : entry.type === "unresolved" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail"
        ? `Component "${entry.entity_id}" was removed, violating rule "${rule.title}".`
        : `Component "${entry.entity_id}"'s removal status could not be resolved (change type "unresolved").`,
    notApplicableStatement: `No architecture component matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Architecture change set compatibility is "${changes.compatibility}"; component-removal status cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} architecture component(s) in scope; none were removed.`,
  });
}

// ---------------------------------------------------------------------------
// 2. require_runtime_entrypoint
// ---------------------------------------------------------------------------

function evaluateRequireRuntimeEntrypoint(rule: GovernanceRule, policy: GovernancePolicy, changes: ArchitectureChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as RequireRuntimeEntrypointCondition;
  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => entry.domain_path.endsWith(".implementation.entryPoints") && matchesPattern(entry.entity_id, condition.entrypoint_id_pattern),
    classify: (entry) => (entry.type === "removed" ? "fail" : entry.type === "unresolved" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail" ? `Runtime entry point "${entry.entity_id}" was removed, violating rule "${rule.title}".` : `Runtime entry point "${entry.entity_id}" could not be resolved (change type "unresolved").`,
    notApplicableStatement: `No runtime entry point matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Architecture change set compatibility is "${changes.compatibility}"; runtime entry point status cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} runtime entry point(s) in scope; none were removed.`,
  });
}

// ---------------------------------------------------------------------------
// 3. require_capability_status_at_least
//
// Judgment call: GovernanceChangeEntry carries no structured CapabilityStatus
// field (capability-diff.ts only narrates a status transition inside its
// free-text `detail`, e.g. `status regressed from "operational" to
// "planned"`, and only for "modified"/"reclassified" entries -- there is no
// reliable field to parse for "added"/"unchanged"/"removed" entries). The one
// fully-structured, always-present signal this rule CAN read is the entry's
// `domain_path`, which for a capability change is the capability's current
// bucket (includedCapabilities/qualifiedCapabilities/roadmapCapabilities/
// gapCapabilities/excludedCandidates/unresolvedCapabilities) --
// capability-diff.ts's own BUCKET_RANK already treats that bucket ordering as
// a status-like maturity ranking ("current -> qualified -> roadmap -> gap ->
// excluded -> unresolved"). This evaluator therefore requires
// `condition.minimum_status` to name one of those six bucket values and
// compares the entry's bucket rank against it -- NOT a raw CapabilityStatus
// literal like "operational"/"planned". A `minimum_status` that isn't one of
// the six known buckets makes every entity in scope "unverifiable" (the
// rule's own configuration cannot be resolved against the available data),
// never a guessed pass/fail. A "removed" capability automatically fails,
// since it no longer occupies any bucket at all.
// ---------------------------------------------------------------------------

function evaluateRequireCapabilityStatusAtLeast(rule: GovernanceRule, policy: GovernancePolicy, changes: CapabilityChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as RequireCapabilityStatusAtLeastCondition;
  const minimumRank = CAPABILITY_BUCKET_RANK[condition.minimum_status];

  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => matchesPattern(entry.entity_id, condition.capability_id_pattern),
    classify: (entry) => {
      if (minimumRank === undefined) return "unverifiable";
      if (entry.type === "removed") return "fail";
      const rank = CAPABILITY_BUCKET_RANK[entry.domain_path];
      if (rank === undefined) return "unverifiable";
      return rank < minimumRank ? "fail" : "pass";
    },
    statementFor: (entry, verdict) =>
      verdict === "fail"
        ? `Capability "${entry.entity_id}" is in bucket "${entry.domain_path}", below the required minimum status "${condition.minimum_status}".`
        : `Capability "${entry.entity_id}"'s status/bucket could not be resolved against minimum status "${condition.minimum_status}".`,
    notApplicableStatement: `No capability matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Capability change set compatibility is "${changes.compatibility}"; capability status cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} capabilit(y/ies) in scope; all meet minimum status "${condition.minimum_status}".`,
  });
}

// ---------------------------------------------------------------------------
// 4. forbid_operational_to_planned_regression
//
// Judgment call: capability-diff.ts's `type: "reclassified"` is ALREADY,
// by construction, exactly "status regressed and/or bucket regressed" (see
// capability-diff.ts's `statusRegressed || bucketRegressed` branch) -- the
// most specific, fully-structured regression signal GovernanceChangeEntry
// carries. This evaluator cannot distinguish an "operational -> planned"
// regression specifically from any other regression (e.g. "qualified ->
// gap") without parsing free-text `detail`, so -- per the brief's allowance
// to narrow scope when field-level detail isn't structurally available --
// ANY "reclassified" capability change matching `capability_id_pattern` is
// treated as a violation of this rule.
// ---------------------------------------------------------------------------

function evaluateForbidOperationalToPlannedRegression(rule: GovernanceRule, policy: GovernancePolicy, changes: CapabilityChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as ForbidOperationalToPlannedRegressionCondition;
  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => matchesPattern(entry.entity_id, condition.capability_id_pattern),
    classify: (entry) => (entry.type === "reclassified" ? "fail" : entry.type === "unresolved" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail" ? `Capability "${entry.entity_id}" regressed (${entry.detail}), violating rule "${rule.title}".` : `Capability "${entry.entity_id}"'s regression status could not be resolved (change type "unresolved").`,
    notApplicableStatement: `No capability matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Capability change set compatibility is "${changes.compatibility}"; regression status cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} capabilit(y/ies) in scope; none regressed.`,
  });
}

// ---------------------------------------------------------------------------
// 5. require_evidence_type -- the one rule kind that scans across every
// available domain (architecture/capability/product/portfolio), since
// "which entity needs which evidence type" is not itself domain-specific.
// ---------------------------------------------------------------------------

function evaluateRequireEvidenceType(rule: GovernanceRule, policy: GovernancePolicy, ctx: DomainChangeSets, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as RequireEvidenceTypeCondition;

  const domains: { label: string; changes: { compatibility: GovernanceCompatibilityStatus; changes: GovernanceChangeEntry[] } | undefined }[] = [
    { label: "architecture", changes: ctx.architectureChanges },
    { label: "capability", changes: ctx.capabilityChanges },
    { label: "product", changes: ctx.productChanges },
    { label: "portfolio", changes: ctx.portfolioChanges },
  ];

  const findings: GovernanceFinding[] = [];
  let anyScope = false;
  let anyUnverifiableDomain = false;

  for (const domain of domains) {
    if (!domain.changes) continue;
    if (domain.changes.compatibility === "partial" || domain.changes.compatibility === "incompatible") {
      anyUnverifiableDomain = true;
      continue;
    }
    const scope = domain.changes.changes.filter((entry) => entry.type !== "unchanged" && matchesPattern(entry.entity_id, condition.entity_id_pattern));
    if (scope.length === 0) continue;
    anyScope = true;
    for (const entry of scope) {
      const hasRequiredEvidence = entry.evidence_refs.some((ref) => ref.source_artifact === condition.required_evidence_source);
      if (!hasRequiredEvidence) {
        findings.push(
          entityFinding({
            rule,
            policy,
            entry,
            result: "fail",
            statement: `"${entry.entity_id}" (${domain.label}) has no evidence sourced from "${condition.required_evidence_source}", violating rule "${rule.title}".`,
            blastRadius,
          }),
        );
      }
    }
  }

  if (findings.length > 0) return findings;
  if (anyUnverifiableDomain && !anyScope) {
    return [aggregateFinding({ rule, policy, result: "unverifiable", statement: `One or more domain change sets have compatibility "partial"/"incompatible"; required-evidence-type status cannot be verified.`, suffix: "unverifiable" })];
  }
  if (!anyScope) {
    return [aggregateFinding({ rule, policy, result: "not_applicable", statement: `No entity matching this rule's scope is present in this comparison.`, suffix: "not-applicable" })];
  }
  return [aggregateFinding({ rule, policy, result: "pass", statement: `All entities in scope carry evidence sourced from "${condition.required_evidence_source}".`, suffix: "pass" })];
}

// ---------------------------------------------------------------------------
// 6. forbid_dependency_removal
// ---------------------------------------------------------------------------

function evaluateForbidDependencyRemoval(rule: GovernanceRule, policy: GovernancePolicy, changes: ArchitectureChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as ForbidDependencyRemovalCondition;
  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => entry.domain_path === "dependencies" && matchesPattern(entry.entity_id, condition.dependency_id_pattern),
    classify: (entry) => (entry.type === "removed" ? "fail" : entry.type === "unresolved" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail" ? `Dependency "${entry.entity_id}" was removed, violating rule "${rule.title}".` : `Dependency "${entry.entity_id}"'s removal status could not be resolved (change type "unresolved").`,
    notApplicableStatement: `No architecture dependency matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Architecture change set compatibility is "${changes.compatibility}"; dependency-removal status cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} dependenc(y/ies) in scope; none were removed.`,
  });
}

// ---------------------------------------------------------------------------
// 7. require_shared_contract_for_dependency
//
// Judgment call: "shared contract" is a portfolio-level relationship concept
// (see portfolio-diff.ts's file header: `relationships` entries of type
// "shared_contract"), but there is no id linkage between an architecture
// `dependencies` entity and a portfolio `relationships` entity in the data
// this evaluator receives -- architecture component/dependency ids and
// portfolio product ids are different namespaces, and PortfolioChangeSet
// carries no cross-reference back into architecture-domain ids. The closest
// available, fully-structured signal is whether the flagged dependency's OWN
// `evidence_refs` include at least one ref sourced from the "portfolio"
// artifact (`EvidenceRef.source_artifact === "portfolio"`) -- i.e. evidence
// that a portfolio-level relationship documents this dependency. When no
// portfolio change set is available at all, the rule cannot be checked and
// is "unverifiable" rather than guessed.
// ---------------------------------------------------------------------------

function evaluateRequireSharedContractForDependency(rule: GovernanceRule, policy: GovernancePolicy, ctx: DomainChangeSets, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as RequireSharedContractForDependencyCondition;
  const changes = ctx.architectureChanges;

  if (!ctx.portfolioChanges) {
    const scope = changes.changes.filter((entry) => entry.domain_path === "dependencies" && matchesPattern(entry.entity_id, condition.dependency_id_pattern));
    if (scope.length === 0) {
      return [aggregateFinding({ rule, policy, result: "not_applicable", statement: `No architecture dependency matching this rule's scope is present in this comparison.`, suffix: "not-applicable" })];
    }
    return [aggregateFinding({ rule, policy, result: "unverifiable", statement: `No portfolio change set is available; shared-contract backing cannot be verified.`, suffix: "unverifiable" })];
  }

  const worstCompatibility: GovernanceCompatibilityStatus = COMPATIBILITY_RANK[changes.compatibility] >= COMPATIBILITY_RANK[ctx.portfolioChanges.compatibility] ? changes.compatibility : ctx.portfolioChanges.compatibility;

  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: worstCompatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => entry.domain_path === "dependencies" && matchesPattern(entry.entity_id, condition.dependency_id_pattern) && entry.type !== "removed",
    classify: (entry) => (entry.evidence_refs.some((ref) => ref.source_artifact === "portfolio") ? "pass" : "fail"),
    statementFor: () => `Dependency lacks evidence sourced from the portfolio artifact (no declared shared-contract relationship found), violating rule "${rule.title}".`,
    notApplicableStatement: `No architecture dependency matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Architecture/portfolio change set compatibility is "${worstCompatibility}"; shared-contract backing cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} dependenc(y/ies) in scope; all carry portfolio-sourced (shared-contract) evidence.`,
  }).map((finding) => (finding.result === "fail" ? { ...finding, statement: finding.statement.replace("Dependency lacks", `Dependency "${finding.affected_entity_ids[0]}" lacks`) } : finding));
}

// ---------------------------------------------------------------------------
// 8. forbid_approved_claim_without_lineage
//
// Judgment call: ProductChangeSet never diffs "claims" at all -- product-
// diff.ts's own file header documents that ProductClaim[] lives on
// ExecutiveNarrative/ShowcasePlan, an artifact this package's snapshot never
// fingerprints (see snapshot.ts's parseProductForSnapshot, which reads
// ProductIdentityModel only). The closest claim-shaped, evidence/lineage-
// bearing entities ProductChangeSet DOES carry are `identity.valuePillars`
// and `identity.differentiators` (each an id-bearing entity with its own
// evidenceIds -> lineage, per product-diff.ts's idBearingLists loop) -- this
// evaluator treats those two domain_paths as the claim-bearing scope.
// "Approved" status (GovernanceClaimStatus) likewise has no home on
// GovernanceChangeEntry, so the rule is checked purely on lineage: `lineage
// === "broken"` (evidence support entirely gone) is a violation; "preserved"
// /"strengthened"/"weakened" (still has SOME lineage) passes; "unverifiable"
// lineage is, unsurprisingly, unverifiable.
// ---------------------------------------------------------------------------

const CLAIM_BEARING_DOMAIN_PATHS = new Set(["identity.valuePillars", "identity.differentiators"]);

function evaluateForbidApprovedClaimWithoutLineage(rule: GovernanceRule, policy: GovernancePolicy, changes: ProductChangeSet, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as ForbidApprovedClaimWithoutLineageCondition;
  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: changes.compatibility,
    allChanges: changes.changes,
    scopeFilter: (entry) => CLAIM_BEARING_DOMAIN_PATHS.has(entry.domain_path) && matchesPattern(entry.entity_id, condition.claim_id_pattern),
    classify: (entry) => (entry.lineage === "broken" ? "fail" : entry.lineage === "unverifiable" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail" ? `Claim-bearing entity "${entry.entity_id}" has no supporting lineage (broken), violating rule "${rule.title}".` : `Claim-bearing entity "${entry.entity_id}"'s lineage could not be determined.`,
    notApplicableStatement: `No claim-bearing product entity matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Product change set compatibility is "${changes.compatibility}"; claim lineage cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} claim-bearing entit(y/ies) in scope; all retain supporting lineage.`,
  });
}

// ---------------------------------------------------------------------------
// 9. require_product_role
//
// Judgment call: PortfolioModel's `products[]` DOES carry `primaryRole`/
// `secondaryRoles` (packages/portfolio-intelligence/src/contracts.ts), but
// portfolio-diff.ts's "products" group diffs each PortfolioProduct record as
// a single opaque `sameValue` comparison (see its GroupSpec for
// domainPath: "products") and never surfaces which field changed --
// GovernanceChangeEntry.detail is just the literal string "Entry changed."
// for a modified product, with no structured before/after role value. This
// evaluator therefore cannot verify a specific `required_role` VALUE from
// the data it receives; the one thing it CAN verify deterministically is
// whether the product identified by `product_id_pattern` is still PRESENT in
// the portfolio at all. A product matching the pattern that was "removed"
// fails (it can no longer hold any role); a product present (added/
// modified/unchanged) passes as a presence check, with role-value
// verification itself left genuinely out of scope (documented here rather
// than silently guessed).
// ---------------------------------------------------------------------------

function evaluateRequireProductRole(rule: GovernanceRule, policy: GovernancePolicy, portfolioChanges: PortfolioChangeSet | undefined, blastRadius: BlastRadiusAssessment): GovernanceFinding[] {
  const condition = rule.condition as RequireProductRoleCondition;

  if (!portfolioChanges) {
    return [aggregateFinding({ rule, policy, result: "not_applicable", statement: `No portfolio change set is available in this comparison.`, suffix: "not-applicable" })];
  }

  return evaluateEntityScopedRule({
    rule,
    policy,
    blastRadius,
    changeSetCompatibility: portfolioChanges.compatibility,
    allChanges: portfolioChanges.changes,
    scopeFilter: (entry) => entry.domain_path === "products" && matchesPattern(entry.entity_id, condition.product_id_pattern),
    classify: (entry) => (entry.type === "removed" ? "fail" : entry.type === "unresolved" ? "unverifiable" : "pass"),
    statementFor: (entry, verdict) =>
      verdict === "fail"
        ? `Product "${entry.entity_id}" was removed from the portfolio; required role "${condition.required_role}" can no longer be held.`
        : `Product "${entry.entity_id}"'s presence could not be resolved (change type "unresolved").`,
    notApplicableStatement: `No portfolio product matching this rule's scope is present in this comparison.`,
    unverifiableStatement: `Portfolio change set compatibility is "${portfolioChanges.compatibility}"; product role presence cannot be verified.`,
    aggregatePassStatement: (scope) => `${scope.length} product(s) in scope remain present in the portfolio (role VALUE itself is not verifiable from available change data -- see rule doc comment).`,
  });
}

// ---------------------------------------------------------------------------
// 10. limit_unresolved_relationships -- a count-based, whole-rule aggregate
// (never per-entity), scanning PortfolioChangeSet's "unresolvedRelationships"
// bucket for entries still present (not "removed") in the target snapshot.
// ---------------------------------------------------------------------------

function evaluateLimitUnresolvedRelationships(rule: GovernanceRule, policy: GovernancePolicy, portfolioChanges: PortfolioChangeSet | undefined): GovernanceFinding[] {
  const condition = rule.condition as LimitUnresolvedRelationshipsCondition;

  if (!portfolioChanges) {
    return [aggregateFinding({ rule, policy, result: "not_applicable", statement: `No portfolio change set is available in this comparison.`, suffix: "not-applicable" })];
  }
  if (portfolioChanges.compatibility === "partial" || portfolioChanges.compatibility === "incompatible") {
    return [aggregateFinding({ rule, policy, result: "unverifiable", statement: `Portfolio change set compatibility is "${portfolioChanges.compatibility}"; unresolved-relationship count cannot be verified.`, suffix: "unverifiable" })];
  }

  const unresolved = portfolioChanges.changes.filter((entry) => entry.domain_path === "unresolvedRelationships" && entry.type !== "removed");
  if (unresolved.length > condition.max_unresolved) {
    return [
      aggregateFinding({
        rule,
        policy,
        result: "fail",
        statement: `${unresolved.length} unresolved relationship(s) present in the target snapshot, exceeding the configured maximum of ${condition.max_unresolved}.`,
        suffix: "fail",
        scope: unresolved,
      }),
    ];
  }
  return [
    aggregateFinding({
      rule,
      policy,
      result: "pass",
      statement: `${unresolved.length} unresolved relationship(s) present, within the configured maximum of ${condition.max_unresolved}.`,
      suffix: "pass",
      scope: unresolved,
    }),
  ];
}

// ---------------------------------------------------------------------------
// 11. require_compatible_snapshot -- checks the top-level
// `targetCompatibility` input directly; never scans a change set.
// ---------------------------------------------------------------------------

function evaluateRequireCompatibleSnapshot(rule: GovernanceRule, policy: GovernancePolicy, targetCompatibility: GovernanceCompatibilityStatus): GovernanceFinding[] {
  const condition = rule.condition as RequireCompatibleSnapshotCondition;
  const meetsMinimum = COMPATIBILITY_RANK[targetCompatibility] <= COMPATIBILITY_RANK[condition.minimum_status];
  return [
    aggregateFinding({
      rule,
      policy,
      result: meetsMinimum ? "pass" : "fail",
      statement: meetsMinimum
        ? `Target snapshot compatibility "${targetCompatibility}" meets the required minimum "${condition.minimum_status}".`
        : `Target snapshot compatibility "${targetCompatibility}" is below the required minimum "${condition.minimum_status}".`,
      suffix: meetsMinimum ? "pass" : "fail",
    }),
  ];
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface DomainChangeSets {
  architectureChanges: ArchitectureChangeSet;
  capabilityChanges: CapabilityChangeSet;
  productChanges: ProductChangeSet;
  portfolioChanges?: PortfolioChangeSet;
}

function evaluateRule(rule: GovernanceRule, policy: GovernancePolicy, ctx: DomainChangeSets, blastRadius: BlastRadiusAssessment, targetCompatibility: GovernanceCompatibilityStatus): GovernanceFinding[] {
  switch (rule.kind) {
    case "forbid_component_removal":
      return evaluateForbidComponentRemoval(rule, policy, ctx.architectureChanges, blastRadius);
    case "require_runtime_entrypoint":
      return evaluateRequireRuntimeEntrypoint(rule, policy, ctx.architectureChanges, blastRadius);
    case "require_capability_status_at_least":
      return evaluateRequireCapabilityStatusAtLeast(rule, policy, ctx.capabilityChanges, blastRadius);
    case "forbid_operational_to_planned_regression":
      return evaluateForbidOperationalToPlannedRegression(rule, policy, ctx.capabilityChanges, blastRadius);
    case "require_evidence_type":
      return evaluateRequireEvidenceType(rule, policy, ctx, blastRadius);
    case "forbid_dependency_removal":
      return evaluateForbidDependencyRemoval(rule, policy, ctx.architectureChanges, blastRadius);
    case "require_shared_contract_for_dependency":
      return evaluateRequireSharedContractForDependency(rule, policy, ctx, blastRadius);
    case "forbid_approved_claim_without_lineage":
      return evaluateForbidApprovedClaimWithoutLineage(rule, policy, ctx.productChanges, blastRadius);
    case "require_product_role":
      return evaluateRequireProductRole(rule, policy, ctx.portfolioChanges, blastRadius);
    case "limit_unresolved_relationships":
      return evaluateLimitUnresolvedRelationships(rule, policy, ctx.portfolioChanges);
    case "require_compatible_snapshot":
      return evaluateRequireCompatibleSnapshot(rule, policy, targetCompatibility);
  }
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

function isExceptionExpired(exception: GovernanceException, now: string): boolean {
  if (!exception.expiry) return false;
  const expiry = new Date(exception.expiry).getTime();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(expiry) || Number.isNaN(nowMs)) return false;
  return expiry < nowMs;
}

/** An exception with a `scope` applies only when at least one of the finding's affected entities matches that scope (regex, same convention as every other `*_pattern` field); an exception with no `scope` applies to every finding under its policy_id/rule_id (never implicit beyond that -- policy_id/rule_id/reason/approval_reference are always required, per contracts.ts's GovernanceException doc comment). */
function exceptionApplies(exception: GovernanceException, finding: GovernanceFinding, now: string): boolean {
  if (exception.policy_id !== finding.policy_id || exception.rule_id !== finding.rule_id) return false;
  if (isExceptionExpired(exception, now)) return false;
  if (exception.scope === undefined) return true;
  return finding.affected_entity_ids.some((id) => matchesPattern(id, exception.scope));
}

function applyExceptions(findings: GovernanceFinding[], exceptions: GovernanceException[], now: string): GovernanceFinding[] {
  return findings.map((finding) => {
    const match = exceptions.find((exception) => exceptionApplies(exception, finding, now));
    if (!match) return finding;
    return { ...finding, result: "excepted" as const, excepted: true, exception: match };
  });
}

// ---------------------------------------------------------------------------
// Sorting (contracts.ts: "Sorted by severity rank (blocking, review_required,
// advisory, informational), then id")
// ---------------------------------------------------------------------------

function sortFindings(findings: GovernanceFinding[]): GovernanceFinding[] {
  return [...findings].sort((a, b) => {
    if (SEVERITY_FINDING_RANK[a.severity] !== SEVERITY_FINDING_RANK[b.severity]) return SEVERITY_FINDING_RANK[a.severity] - SEVERITY_FINDING_RANK[b.severity];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function evaluatePolicy(input: EvaluatePolicyInput): GovernanceEvaluation {
  const ctx: DomainChangeSets = {
    architectureChanges: input.architectureChanges,
    capabilityChanges: input.capabilityChanges,
    productChanges: input.productChanges,
    portfolioChanges: input.portfolioChanges,
  };

  const rawFindings: GovernanceFinding[] = [];
  for (const rule of input.policy.rules) {
    if (!rule.enabled) continue; // disabled rules produce zero findings, not even not_applicable
    rawFindings.push(...evaluateRule(rule, input.policy, ctx, input.blastRadius, input.targetCompatibility));
  }

  const withExceptions = applyExceptions(rawFindings, input.policy.exceptions, input.now);
  const findings = sortFindings(withExceptions);
  const evidenceRefs = sortEvidenceRefs(dedupeEvidenceRefs(findings.flatMap((finding) => finding.evidence_refs)));

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildEvaluationId(input.policy.id, input.sourceSnapshotId, input.targetSnapshotId),
    policy_id: input.policy.id,
    source_snapshot_id: input.sourceSnapshotId,
    target_snapshot_id: input.targetSnapshotId,
    findings,
    evidence_refs: evidenceRefs,
    generation: { generated_at: input.generatedAt },
  };
}
