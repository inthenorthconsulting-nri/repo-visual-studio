import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { Logger } from "@rvs/core";
import {
  assessDecisionBlastRadius,
  buildArchitectureLinks,
  buildCapabilityLinks,
  buildDecisionConflicts,
  buildDecisionCoverage,
  buildDecisionDependencies,
  buildDecisionGovernanceContext,
  buildDecisionImplementationStates,
  buildDecisionNarrative,
  buildDecisionPlan,
  buildDecisionSnapshot,
  buildDecisionSourceId,
  buildDecisionSourceIssueId,
  buildDecisionSupersession,
  buildDecisionToDecisionLinks,
  buildGovernanceLinks,
  buildPortfolioLinks,
  buildProductLinks,
  buildReportId,
  classifyDecisionClaim,
  classifyDecisionCriticality,
  classifyDecisionSource,
  detectDecisionDrift,
  detectDecisionDebt,
  detectDecisionIdentityIssues,
  detectMissingDecisions,
  detectMissingImplementation,
  discoverDecisionCandidates,
  draftStandardDecisionClaims,
  extractAlternatives,
  extractAssumptions,
  extractConsequences,
  extractDeclaredDependencies,
  extractFrontmatter,
  loadDecisionsConfig,
  normalizeDecisionFields,
  parseDecisionMarkdown,
  resolveDecisionIdentity,
} from "@rvs/decision-intelligence";
import type {
  ArchitectureDecision,
  DecisionBlastRadiusLevel,
  DecisionGovernanceStatus,
  DecisionLink,
  DecisionSourceIssue,
  EvidenceRef,
  RawParsedDecision,
} from "@rvs/decision-intelligence";
import { loadGovernanceConfig, loadPolicyFiles } from "@rvs/governance-intelligence";
import { readCachedJsonOptional } from "../cache.js";
import { writeDecisionOutputs } from "../decision-cache.js";

/**
 * Repository identity fallback hierarchy: explicit config > normalized git
 * remote identity > repository-root git metadata > directory basename.
 * Different checkout folder names for the same repo+commit must resolve to
 * the same repositoryId wherever git metadata is available -- basename is
 * the last-resort fallback, not the default (see decisions-analyze.ts's
 * prior "judgment call" comment, now replaced by this hierarchy).
 */
function resolveRepositoryId(repoRoot: string, configuredId: string | undefined): string {
  if (configuredId) return configuredId;

  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (remoteUrl) return normalizeGitRemoteIdentity(remoteUrl);
  } catch {
    // No "origin" remote (or not a git repo) -- fall through.
  }

  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (topLevel) return basename(topLevel);
  } catch {
    // Not inside a git working tree -- fall through.
  }

  return basename(repoRoot);
}

/** Strips protocol/credentials/`.git` suffix so `git@github.com:org/repo.git` and `https://github.com/org/repo` normalize to the same identity. */
function normalizeGitRemoteIdentity(remoteUrl: string): string {
  let normalized = remoteUrl.trim();
  normalized = normalized.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // strip protocol
  normalized = normalized.replace(/^[^@/]+@/, ""); // strip user@ credentials
  normalized = normalized.replace(/:/, "/"); // scp-style host:path -> host/path
  normalized = normalized.replace(/\.git$/, "");
  normalized = normalized.replace(/\/+$/, "");
  return normalized;
}

/**
 * `governance_status` (unlike `implementation_status`, which has a
 * dedicated builder) has no builder function in @rvs/decision-intelligence
 * -- per governance-links.ts's own resolution vocabulary, this local helper
 * derives it from the "excepts"/"governance" links a decision carries: no
 * governance links at all leaves it `undefined` (never evaluated, not a
 * false "aligned"), matching the package's evidence-gated-absence
 * convention throughout.
 */
function deriveGovernanceStatus(decisionId: string, governanceLinks: DecisionLink[]): DecisionGovernanceStatus | undefined {
  const scoped = governanceLinks.filter((link) => link.decision_id === decisionId);
  if (scoped.length === 0) return undefined;
  if (scoped.some((link) => link.resolution === "incompatible")) return "conflicting";
  if (scoped.some((link) => link.resolution === "unresolved")) return "review_required";
  if (scoped.some((link) => link.resolution === "ambiguous")) return "unverifiable";
  return "aligned";
}

/**
 * Runs the full decision-intelligence analysis pipeline (discover ->
 * classify/identify/normalize -> upstream links -> assumptions/consequences
 * /alternatives -> dependencies -> supersession/conflicts/implementation
 * state/coverage/criticality/drift/debt -> snapshot -> governance context ->
 * claims -> narrative -> plan -> report) and caches every
 * DECISION_OUTPUT_FILES artifact under .rvs/cache/decisions/. Shared by
 * both `rvs decisions analyze` (inspection-only) and `rvs decisions
 * validate` (adds validation on top), mirroring
 * governance-compare.ts's runGovernanceComparison precedent.
 */
export async function runDecisionAnalysis(repoRoot: string, logger: Logger) {
  const config = loadDecisionsConfig(repoRoot) ?? { schema_version: 1 as const, sources: [] };
  const generatedAt = new Date().toISOString();

  const candidates = await discoverDecisionCandidates(repoRoot, config);

  const decisions: ArchitectureDecision[] = [];
  const sourceIssues: DecisionSourceIssue[] = [];
  const frontmatterByDecisionId = new Map<string, Record<string, unknown> | undefined>();
  const parsedByDecisionId = new Map<string, RawParsedDecision>();
  const evidenceRefsByDecisionId = new Map<string, EvidenceRef[]>();
  const identityRecords: { id: string; repo_relative_path: string; content_digest: string; evidence_refs: EvidenceRef[] }[] = [];

  for (const candidate of candidates) {
    const raw = readFileSync(resolve(repoRoot, candidate.repo_relative_path), "utf8");
    const { frontmatter, body } = extractFrontmatter(raw);
    const classification = classifyDecisionSource({
      repo_relative_path: candidate.repo_relative_path,
      configured_type: candidate.configured_type,
      raw_content: raw,
      frontmatter,
    });

    if (classification.issue_kind) {
      sourceIssues.push({
        id: buildDecisionSourceIssueId(classification.issue_kind, [candidate.repo_relative_path]),
        kind: classification.issue_kind,
        affected_paths: [candidate.repo_relative_path],
        detail: `"${candidate.repo_relative_path}" could not be classified as a supported decision source (basis: "${classification.classification_basis}").`,
        evidence_refs: [{ path: candidate.repo_relative_path, source_artifact: "decision" }],
      });
      continue;
    }

    const parsed = parseDecisionMarkdown(body);
    const contentDigest = createHash("sha256").update(raw).digest("hex");
    const fallbackTitle = basename(candidate.repo_relative_path).replace(/\.[a-zA-Z0-9]+$/, "");
    const normalized = normalizeDecisionFields(parsed, frontmatter, fallbackTitle, config.status_mapping);
    const identity = resolveDecisionIdentity(
      { repo_relative_path: candidate.repo_relative_path, frontmatter, title: normalized.title, content_digest: contentDigest },
      config.identity?.prefer,
    );
    const evidenceRefs: EvidenceRef[] = [{ path: candidate.repo_relative_path, source_artifact: "decision" }];

    decisions.push({
      schema_version: 1,
      id: identity.id,
      source: {
        id: buildDecisionSourceId(candidate.repo_relative_path),
        repo_relative_path: candidate.repo_relative_path,
        source_type: classification.source_type,
        content_digest: contentDigest,
        classification_basis: classification.classification_basis,
        evidence_refs: evidenceRefs,
      },
      title: normalized.title,
      decision_status: normalized.decision_status,
      // Placeholder -- overwritten below once buildDecisionImplementationStates
      // has computed the real, link-derived status for every decision id.
      implementation_status: "unverifiable",
      scope: normalized.scope,
      context: normalized.context,
      decision_text: normalized.decision_text,
      authors: normalized.authors,
      date: normalized.date,
      supersedes: normalized.supersedes,
      superseded_by: normalized.superseded_by,
      evidence_refs: evidenceRefs,
    });

    frontmatterByDecisionId.set(identity.id, frontmatter);
    parsedByDecisionId.set(identity.id, parsed);
    evidenceRefsByDecisionId.set(identity.id, evidenceRefs);
    identityRecords.push({ id: identity.id, repo_relative_path: candidate.repo_relative_path, content_digest: contentDigest, evidence_refs: evidenceRefs });
  }

  sourceIssues.push(...detectDecisionIdentityIssues(identityRecords));
  sourceIssues.sort((a, b) => a.id.localeCompare(b.id));

  // --- Best-effort upstream artifacts (absent when their own synthesize step hasn't run yet) ---
  const architectureSnapshot = readCachedJsonOptional<unknown>(repoRoot, "architecture-intelligence.json");
  const capabilitySnapshot = readCachedJsonOptional<unknown>(repoRoot, "capability-model.json");
  const productSnapshot = readCachedJsonOptional<unknown>(repoRoot, "product-identity-model.json");
  const portfolioSnapshot = readCachedJsonOptional<unknown>(repoRoot, "portfolio-model.json");

  // --- Best-effort governance policy (absent when .rvs/governance.yml hasn't been configured) ---
  const governanceConfig = loadGovernanceConfig(repoRoot);
  const policyPaths = (governanceConfig?.policies ?? []).map((p) => resolve(repoRoot, p));
  const policies = loadPolicyFiles(policyPaths, generatedAt);

  // --- 6 link types ---
  const architectureLinks = decisions.flatMap((d) => buildArchitectureLinks(d, frontmatterByDecisionId.get(d.id), architectureSnapshot));
  const capabilityLinks = decisions.flatMap((d) => buildCapabilityLinks(d, frontmatterByDecisionId.get(d.id), capabilitySnapshot));
  const productLinks = decisions.flatMap((d) => buildProductLinks(d, frontmatterByDecisionId.get(d.id), productSnapshot));
  const portfolioLinks = decisions.flatMap((d) => buildPortfolioLinks(d, frontmatterByDecisionId.get(d.id), portfolioSnapshot));
  const governanceLinks = policies.flatMap((policy) => buildGovernanceLinks(decisions, policy, generatedAt));
  const knownDecisionIds = new Set(decisions.map((d) => d.id));
  const decisionToDecisionLinks = decisions.flatMap((d) => buildDecisionToDecisionLinks(d, frontmatterByDecisionId.get(d.id), knownDecisionIds));
  const links = [...architectureLinks, ...capabilityLinks, ...productLinks, ...portfolioLinks, ...governanceLinks, ...decisionToDecisionLinks].sort((a, b) => a.id.localeCompare(b.id));

  // --- Assumptions / consequences / alternatives ---
  const assumptions = decisions.flatMap((d) => extractAssumptions(d.id, frontmatterByDecisionId.get(d.id), parsedByDecisionId.get(d.id)!, evidenceRefsByDecisionId.get(d.id) ?? []));
  const consequences = decisions.flatMap((d) => extractConsequences(d.id, frontmatterByDecisionId.get(d.id), parsedByDecisionId.get(d.id)!, evidenceRefsByDecisionId.get(d.id) ?? []));
  const alternatives = decisions.flatMap((d) => extractAlternatives(d.id, frontmatterByDecisionId.get(d.id), parsedByDecisionId.get(d.id)!, evidenceRefsByDecisionId.get(d.id) ?? []));

  // --- Dependencies ---
  const declaredByDecisionId = new Map(decisions.map((d) => [d.id, extractDeclaredDependencies(frontmatterByDecisionId.get(d.id))]));
  const dependencyResult = buildDecisionDependencies(decisions, declaredByDecisionId, evidenceRefsByDecisionId);

  // --- Implementation state ---
  const hasUpstreamEvidence = architectureSnapshot !== undefined || capabilitySnapshot !== undefined || productSnapshot !== undefined || portfolioSnapshot !== undefined;
  const implementationStates = buildDecisionImplementationStates(decisions, links, { hasUpstreamEvidence });
  const missingImplementationFindings = detectMissingImplementation(implementationStates);

  // Merge the link-derived implementation_status and governance_status back
  // onto each decision now that both are known -- these two axes are
  // computed, never author-declared, unlike decision_status (see the
  // three-status-axes convention this package follows throughout).
  const implementationStatusByDecisionId = new Map(implementationStates.map((s) => [s.decision_id, s.status]));
  const governanceStatusByDecisionId = new Map(decisions.map((d) => [d.id, deriveGovernanceStatus(d.id, governanceLinks)]));
  const finalDecisions: ArchitectureDecision[] = decisions
    .map((d) => ({
      ...d,
      implementation_status: implementationStatusByDecisionId.get(d.id) ?? d.implementation_status,
      governance_status: governanceStatusByDecisionId.get(d.id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Blast radius ---
  // This CLI pipeline always runs all 6 link builders and always computes
  // dependencyResult regardless of upstream artifact availability -- neither
  // step is ever skipped -- so `linksAvailable`/`dependenciesAvailable` are
  // unconditionally true here. blast-radius.ts's "unavailable" gate
  // (`!linksAvailable && !dependenciesAvailable` -> every decision
  // "unresolved") exists for callers who skip link/dependency resolution
  // entirely, which this pipeline never does; a link/dependency array that
  // is merely empty (e.g. no upstream snapshot resolved anything, or a
  // decision has zero declared links) still means resolution "ran" for that
  // decision, which is what these two flags represent -- a confirmed,
  // data-backed absence of connections is "isolated", never "unresolved".
  const blastRadius = assessDecisionBlastRadius({
    decisions: finalDecisions,
    links,
    dependencies: dependencyResult.dependencies,
    sourceIssues,
    linksAvailable: true,
    dependenciesAvailable: true,
  });
  const blastRadiusIdByDecisionId = new Map(blastRadius.map((b) => [b.decision_id, b.id]));

  // --- Supersession / conflicts / missing-decisions / coverage / criticality ---
  const supersession = buildDecisionSupersession(finalDecisions, evidenceRefsByDecisionId);
  const conflicts = buildDecisionConflicts(finalDecisions, links, dependencyResult.dependencies, evidenceRefsByDecisionId);
  const decisionStatusById = new Map(finalDecisions.map((d) => [d.id, d.decision_status]));
  const missingDecisionRules = (config.missing_decision_rules ?? []).map((r) => ({ rule_kind: r.rule_kind, affected_entity_ids: r.affected_entity_ids }));
  const missingDecisionFindings = detectMissingDecisions(missingDecisionRules, links, decisionStatusById, []);
  const coverage = buildDecisionCoverage(
    links,
    { architectureSnapshot, capabilitySnapshot, productSnapshot, portfolioSnapshot, governancePolicy: policies.length > 0 ? policies : undefined },
    finalDecisions.flatMap((d) => d.evidence_refs),
  );

  // --- Criticality ---
  // Real signals, built from config (.rvs/decisions.yml's `criticality`
  // block), decision frontmatter (`criticality: critical|elevated|standard`),
  // and resolved links into governance/architecture/portfolio/capability --
  // replacing the previous `{ signalsAvailable: false }` placeholder that
  // made every decision resolve "unresolved" regardless of what was actually
  // knowable.
  const configuredCriticalDecisionIds = new Set(config.criticality?.critical_decision_ids ?? []);
  const frontmatterCriticalityByDecisionId = new Map<string, "critical" | "elevated" | "standard">();
  for (const d of finalDecisions) {
    const raw = frontmatterByDecisionId.get(d.id)?.["criticality"];
    if (raw === "critical" || raw === "elevated" || raw === "standard") frontmatterCriticalityByDecisionId.set(d.id, raw);
  }
  const sharedContractEntityIds = new Set(config.criticality?.shared_contract_entity_ids ?? []);
  const runtimeEntrypointEntityIds = new Set(config.criticality?.runtime_entrypoint_entity_ids ?? []);
  const portfolioDependencyEntityIds = new Set(config.criticality?.portfolio_dependency_entity_ids ?? []);
  const criticalCapabilityEntityIds = new Set(config.criticality?.critical_capability_entity_ids ?? []);

  // Any governance link at all counts as "linked to a critical policy":
  // governance-links.ts only ever produces a link when a policy exception's
  // decision_ref names this decision, and its link carries no policy
  // severity reference to check further -- so "has a resolved/partially-
  // resolved governance link" is the closest honestly-scoped predicate
  // available without additional plumbing out of scope for this phase.
  const linkedCriticalPolicyDecisionIds = new Set(
    governanceLinks.filter((l) => l.resolution === "resolved" || l.resolution === "partially_resolved").map((l) => l.decision_id),
  );
  const linkedSharedContractDecisionIds = new Set(
    architectureLinks.filter((l) => l.target_id && sharedContractEntityIds.has(l.target_id)).map((l) => l.decision_id),
  );
  const linkedRuntimeEntrypointDecisionIds = new Set(
    architectureLinks.filter((l) => l.target_id && runtimeEntrypointEntityIds.has(l.target_id)).map((l) => l.decision_id),
  );
  const linkedPortfolioDependencyDecisionIds = new Set(
    portfolioLinks.filter((l) => l.target_id && portfolioDependencyEntityIds.has(l.target_id)).map((l) => l.decision_id),
  );
  const linkedCriticalCapabilityDecisionIds = new Set(
    capabilityLinks.filter((l) => l.target_id && criticalCapabilityEntityIds.has(l.target_id)).map((l) => l.decision_id),
  );

  const criticalityInputs = {
    configuredCriticalDecisionIds,
    frontmatterCriticalityByDecisionId,
    linkedCriticalPolicyDecisionIds,
    linkedSharedContractDecisionIds,
    linkedRuntimeEntrypointDecisionIds,
    linkedPortfolioDependencyDecisionIds,
    linkedCriticalCapabilityDecisionIds,
    signalsAvailable:
      configuredCriticalDecisionIds.size > 0 ||
      frontmatterCriticalityByDecisionId.size > 0 ||
      linkedCriticalPolicyDecisionIds.size > 0 ||
      sharedContractEntityIds.size > 0 ||
      runtimeEntrypointEntityIds.size > 0 ||
      portfolioDependencyEntityIds.size > 0 ||
      criticalCapabilityEntityIds.size > 0,
  };
  const criticalityAssessments = classifyDecisionCriticality(finalDecisions, criticalityInputs);
  const criticalityByDecisionId = new Map(criticalityAssessments.map((a) => [a.decision_id, a.criticality]));

  // --- Drift / debt ---
  const drift = detectDecisionDrift({
    decisions: finalDecisions,
    assumptions,
    links,
    conflicts,
    supersessionIssues: supersession.issues,
    sourceIssues,
    criticalityByDecisionId,
    implementationStatusByDecisionId,
    governanceStatusByDecisionId,
  });
  // Post-process drift with the blast-radius id now known for each decision
  // (mirrors the finalDecisions merge-after pattern above) -- every
  // downstream consumer of drift uses finalDrift from this point on.
  const finalDrift = drift.map((entry) => ({ ...entry, blast_radius_id: blastRadiusIdByDecisionId.get(entry.decision_id) }));
  const debtFindings = detectDecisionDebt({
    decisions: finalDecisions,
    implementationStates,
    drift: finalDrift,
    conflicts,
    supersessionIssues: supersession.issues,
    missingDecisionFindings,
    assumptions,
    sourceIssues,
    links,
    dependencies: dependencyResult.dependencies,
    governanceStatusByDecisionId,
    criticalityByDecisionId,
    blastRadiusIdByDecisionId,
    now: generatedAt,
  });

  // --- Snapshot ---
  const repositoryId = resolveRepositoryId(repoRoot, config.repository?.id);
  const snapshot = buildDecisionSnapshot({ repositoryId, generatedAt, decisions: finalDecisions, sourceIssues });

  // --- Governance policy extension ---
  const governanceContext = buildDecisionGovernanceContext({ missingDecisionFindings, assumptions, conflicts, governanceLinks, drift: finalDrift });

  // --- Claims ---
  const decisionsById = new Map(finalDecisions.map((d) => [d.id, d]));
  const claimContext = { decisionsById, assumptions, conflicts, supersessionIssues: supersession.issues, links, snapshotCompatibility: snapshot.compatibility };
  const claims = finalDecisions
    .flatMap((d) => draftStandardDecisionClaims(d).map((draft) => classifyDecisionClaim(draft, claimContext)))
    .sort((a, b) => a.id.localeCompare(b.id));

  // --- Narrative / plan ---
  const narrative = buildDecisionNarrative({
    snapshot,
    implementationStates,
    assumptions,
    conflicts,
    supersessionIssues: supersession.issues,
    coverage,
    debtFindings,
    drift: finalDrift,
    governanceContext,
    blastRadius,
    generatedAt,
  });
  const plan = buildDecisionPlan({
    snapshot,
    narrative,
    links,
    implementationStates,
    assumptions,
    supersessionIssues: supersession.issues,
    supersessionChains: supersession.chains,
    conflicts,
    coverage,
    drift: finalDrift,
    debtFindings,
    governanceContext,
    blastRadius,
    generatedAt,
  });

  // --- Report ---
  // No single builder function exists for DecisionIntelligenceReport (like
  // ContinuousIntelligenceReport before it) -- hand-assembled here from the
  // pieces above. `unresolved_count` mirrors decision-plan.ts's own
  // conflicts-scene definition of "unresolved" (status !== "resolved"),
  // the only other place this codebase uses that exact term.
  const findingsBySeverity = { blocking: 0, review_required: 0, advisory: 0, informational: 0 };
  for (const entry of finalDrift) findingsBySeverity[entry.severity] += 1;
  const blastRadiusByLevel: Record<DecisionBlastRadiusLevel, number> = { isolated: 0, local: 0, cross_component: 0, cross_layer: 0, portfolio_wide: 0, unresolved: 0 };
  for (const entry of blastRadius) blastRadiusByLevel[entry.level] += 1;
  const report = {
    schema_version: 1 as const,
    id: buildReportId(snapshot.id),
    generated_at: generatedAt,
    snapshot_id: snapshot.id,
    decision_count: finalDecisions.length,
    coverage,
    findings_by_severity: findingsBySeverity,
    blast_radius_by_level: blastRadiusByLevel,
    unresolved_count: conflicts.filter((c) => c.status !== "resolved").length,
  };

  // Alternatives has no dedicated DECISION_OUTPUT_FILES entry (unlike
  // assumptions/consequences), so it is folded into decisions.json here.
  // Likewise missing-implementation/missing-decision findings have no
  // dedicated files -- folded into the output file of the artifact that
  // consumes them (implementation state / decision debt respectively).
  const alternativesByDecisionId: Record<string, typeof alternatives> = {};
  for (const alternative of alternatives) {
    (alternativesByDecisionId[alternative.decision_id] ??= []).push(alternative);
  }

  writeDecisionOutputs(repoRoot, {
    decisionSnapshot: snapshot,
    decisions: { decisions: finalDecisions, alternatives_by_decision_id: alternativesByDecisionId },
    decisionLinks: links,
    assumptions,
    consequences,
    dependencies: dependencyResult,
    supersession,
    conflicts,
    implementationState: { states: implementationStates, missing_implementation_findings: missingImplementationFindings },
    coverage,
    drift: finalDrift,
    decisionDebt: { findings: debtFindings, missing_decision_findings: missingDecisionFindings },
    decisionGovernanceContext: governanceContext,
    decisionBlastRadius: blastRadius,
    decisionClaims: claims,
    decisionNarrative: narrative,
    decisionPlan: plan,
    decisionReport: report,
  });

  logger.info(`Discovered ${candidates.length} decision candidate(s); parsed ${finalDecisions.length} decision(s), ${sourceIssues.length} source issue(s).`);

  return {
    snapshot,
    links,
    assumptions,
    consequences,
    alternatives,
    dependencies: dependencyResult,
    supersession,
    conflicts,
    implementationStates,
    missingImplementationFindings,
    missingDecisionFindings,
    coverage,
    criticality: criticalityAssessments,
    drift: finalDrift,
    debtFindings,
    blastRadius,
    governanceContext,
    claims,
    narrative,
    plan,
    report,
  };
}

export interface DecisionsAnalyzeOptions {}

export async function runDecisionsAnalyze(repoRoot: string, _opts: DecisionsAnalyzeOptions, logger: Logger): Promise<void> {
  const result = await runDecisionAnalysis(repoRoot, logger);
  logger.info(`Analyzed ${result.snapshot.decisions.length} decision(s) (compatibility: "${result.snapshot.compatibility}").`);
  logger.info(
    `Findings: ${result.drift.length} drift, ${result.debtFindings.length} debt, ${result.conflicts.length} conflict(s), ${result.supersession.issues.length} supersession issue(s).`,
  );
  logger.info("Cached decision outputs to .rvs/cache/decisions/.");
}
