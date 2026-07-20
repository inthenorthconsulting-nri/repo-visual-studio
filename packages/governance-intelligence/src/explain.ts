import type { BlastRadiusEntry, ContinuousIntelligenceReport, GovernanceBaseline, GovernanceChangeEntry, GovernanceEvaluation, GovernanceEvidenceChangeEntry, GovernanceFinding, GovernancePlan } from "./contracts.js";

// ---------------------------------------------------------------------------
// explainGovernanceId -- fallback-across-id-spaces lookup, mirroring the
// pattern in packages/cli/src/commands/portfolio-explain.ts (try each id
// space in priority order, return on first match) combined with
// portfolio-intelligence/src/exporter.ts's human-readable string-building
// style (explainPortfolioClaim/explainPortfolioDecision).
//
// Unlike the portfolio precedent -- split across a CLI command (id-space
// fallback + I/O + exitCode) and exporter.ts (pure string building) --
// governance's explain.ts has no CLI layer in this package's scope, so both
// roles are merged into one pure function here. It never touches the
// filesystem and never logs; a caller-supplied `context` carries whatever
// already-loaded data (report/plan/baseline) is available, and this
// function throws a plain `Error` (matching this package's existing
// convention of no typed error hierarchy -- see e.g. showBaseline's doc
// comment in baseline.ts) when nothing resolves.
//
// Search order, exactly as specified: change id (across all 4 domain change
// sets + the evidence change set) -> finding id -> policy-evaluation id ->
// blast-radius entry id -> snapshot id (source or target) -> narrative/plan
// id (and, for completeness, report id / scene id / baseline snapshot id,
// grouped with the narrative/plan lookups since they come from the same
// `context.plan`/`context.baseline` inputs).
// ---------------------------------------------------------------------------

export interface GovernanceExplainContext {
  report?: ContinuousIntelligenceReport;
  plan?: GovernancePlan;
  baseline?: GovernanceBaseline;
}

export interface GovernanceExplanation {
  /** Human-readable, multi-sentence explanation of what the id refers to. */
  explanation: string;
  /** The resolved object itself, for callers that want to inspect it further (e.g. an `rvs governance explain --json` CLI layer, out of this package's scope). */
  resolved: unknown;
}

function reportOf(context: GovernanceExplainContext): ContinuousIntelligenceReport | undefined {
  return context.report ?? context.plan?.report;
}

function findChangeEntryById(report: ContinuousIntelligenceReport, id: string): { entry: GovernanceChangeEntry; domain: string } | undefined {
  const domains: { label: string; changes: GovernanceChangeEntry[] }[] = [
    { label: "architecture", changes: report.architecture_changes.changes },
    { label: "capability", changes: report.capability_changes.changes },
    { label: "product", changes: report.product_changes.changes },
  ];
  if (report.portfolio_changes) domains.push({ label: "portfolio", changes: report.portfolio_changes.changes });

  for (const domain of domains) {
    const entry = domain.changes.find((change) => change.id === id);
    if (entry) return { entry, domain: domain.label };
  }
  return undefined;
}

function findEvidenceChangeById(report: ContinuousIntelligenceReport, id: string): GovernanceEvidenceChangeEntry | undefined {
  return report.evidence_changes.changes.find((change) => change.id === id);
}

function findFindingById(report: ContinuousIntelligenceReport, id: string): GovernanceFinding | undefined {
  return report.findings.find((finding) => finding.id === id);
}

function findEvaluationById(report: ContinuousIntelligenceReport, id: string): GovernanceEvaluation | undefined {
  return report.evaluations.find((evaluation) => evaluation.id === id);
}

function findBlastRadiusEntryById(report: ContinuousIntelligenceReport, id: string): BlastRadiusEntry | undefined {
  return report.blast_radius.entries.find((entry) => entry.id === id);
}

export function explainGovernanceId(id: string, context: GovernanceExplainContext): GovernanceExplanation {
  const report = reportOf(context);

  if (report) {
    const changeMatch = findChangeEntryById(report, id);
    if (changeMatch) {
      const { entry, domain } = changeMatch;
      return {
        explanation: `Change "${entry.id}" (${domain} domain, entity "${entry.entity_id}", type "${entry.type}"): ${entry.detail} Compatibility impact: "${entry.compatibility}". Evidence lineage: "${entry.lineage}".`,
        resolved: entry,
      };
    }

    const evidenceChange = findEvidenceChangeById(report, id);
    if (evidenceChange) {
      return {
        explanation: `Evidence change "${evidenceChange.id}" (${evidenceChange.type}): ${evidenceChange.detail}`,
        resolved: evidenceChange,
      };
    }

    const finding = findFindingById(report, id);
    if (finding) {
      return {
        explanation: `Finding "${finding.id}" (policy "${finding.policy_id}", rule "${finding.rule_id}"): ${finding.statement} Result: "${finding.result}". Severity: "${finding.severity}".${finding.excepted ? " This finding is currently excepted." : ""}${finding.human_review_required ? " This finding requires human review." : ""}`,
        resolved: finding,
      };
    }

    const evaluation = findEvaluationById(report, id);
    if (evaluation) {
      return {
        explanation: `Policy evaluation "${evaluation.id}" for policy "${evaluation.policy_id}" produced ${evaluation.findings.length} finding(s) comparing "${evaluation.source_snapshot_id}" to "${evaluation.target_snapshot_id}".`,
        resolved: evaluation,
      };
    }

    const blastEntry = findBlastRadiusEntryById(report, id);
    if (blastEntry) {
      return {
        explanation: `Blast radius entry "${blastEntry.id}" for change "${blastEntry.change_id}": level "${blastEntry.level}". ${blastEntry.rationale}`,
        resolved: blastEntry,
      };
    }

    if (report.source_snapshot_id === id || report.target_snapshot_id === id) {
      const role = report.source_snapshot_id === id ? "source" : "target";
      return {
        explanation: `Snapshot "${id}" is the ${role} snapshot of governance report "${report.id}" (comparing "${report.source_snapshot_id}" to "${report.target_snapshot_id}").`,
        resolved: { snapshotId: id, role, reportId: report.id },
      };
    }

    if (report.id === id) {
      return {
        explanation: `Continuous intelligence report "${report.id}" compares snapshot "${report.source_snapshot_id}" to "${report.target_snapshot_id}", with overall compatibility "${report.compatibility}" and ${report.findings.length} finding(s).`,
        resolved: report,
      };
    }
  }

  if (context.baseline && context.baseline.snapshot.id === id) {
    return {
      explanation: `Snapshot "${id}" is the currently established governance baseline (baseline id "${context.baseline.id}", established at "${context.baseline.established_at}").`,
      resolved: context.baseline,
    };
  }
  if (context.baseline && context.baseline.id === id) {
    return {
      explanation: `Baseline "${id}" was established at "${context.baseline.established_at}" over snapshot "${context.baseline.snapshot.id}".`,
      resolved: context.baseline,
    };
  }

  if (context.plan) {
    if (context.plan.id === id) {
      return { explanation: `Governance plan "${id}" for report "${context.plan.report.id}" contains ${context.plan.scenes.length} scene(s).`, resolved: context.plan };
    }
    if (context.plan.narrative.id === id) {
      return { explanation: `Governance narrative "${id}": ${context.plan.narrative.summary}`, resolved: context.plan.narrative };
    }
    const scene = context.plan.scenes.find((candidate) => candidate.scene_id === id);
    if (scene) {
      return { explanation: `Governance scene "${scene.scene_id}" (kind "${scene.kind}"): ${scene.title}`, resolved: scene };
    }
  }

  throw new Error(`No governance change, finding, policy evaluation, blast-radius entry, snapshot, baseline, narrative, plan, or scene found matching id "${id}". Run \`rvs governance compare\` first to produce a continuous intelligence report, then re-check the id against the cached report/plan.`);
}
