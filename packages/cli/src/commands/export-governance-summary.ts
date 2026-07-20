import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { GOVERNANCE_OUTPUT_FILES } from "@rvs/governance-intelligence";
import type { ContinuousIntelligenceReport, GovernanceChangeEntry, GovernanceFinding, GovernanceNarrative } from "@rvs/governance-intelligence";
import { readGovernanceCachedJson } from "../governance-cache.js";

export interface ExportGovernanceSummaryOptions {
  output?: string;
}

// This command only ever WRITES a local Markdown file — it never posts,
// comments, or otherwise publishes anywhere (no GitHub/GitLab/Slack API
// calls); the caller's own CI pipeline is responsible for attaching/pasting
// the written file to a PR, per spec §51.
export async function runExportGovernanceSummary(repoRoot: string, opts: ExportGovernanceSummaryOptions, logger: Logger): Promise<void> {
  const report = readGovernanceCachedJson<ContinuousIntelligenceReport>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceReport);
  const narrative = readGovernanceCachedJson<GovernanceNarrative>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceNarrative);

  const markdown = buildGovernanceSummaryMarkdown(report, narrative);

  const outputPath = resolve(repoRoot, opts.output ?? "governance-summary.md");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);

  logger.info(`Wrote ${outputPath}.`);
}

function changeCountsByDomain(report: ContinuousIntelligenceReport): [string, number][] {
  const countOf = (changes: GovernanceChangeEntry[]) => changes.filter((c) => c.type !== "unchanged").length;
  const domains: [string, number][] = [
    ["architecture", countOf(report.architecture_changes.changes)],
    ["capability", countOf(report.capability_changes.changes)],
    ["product", countOf(report.product_changes.changes)],
  ];
  if (report.portfolio_changes) domains.push(["portfolio", countOf(report.portfolio_changes.changes)]);
  return domains;
}

function findingsTable(findings: GovernanceFinding[]): string {
  const rows = findings.filter((f) => f.severity === "blocking" || f.severity === "review_required");
  if (rows.length === 0) return "_No blocking or review-required findings._\n";
  const header = "| Severity | Policy | Statement | Affected entities |\n| --- | --- | --- | --- |\n";
  const body = rows.map((f) => `| ${f.severity} | ${f.policy_id} | ${f.statement.replace(/\|/g, "\\|")} | ${f.affected_entity_ids.join(", ")} |`).join("\n");
  return `${header}${body}\n`;
}

function buildGovernanceSummaryMarkdown(report: ContinuousIntelligenceReport, narrative: GovernanceNarrative): string {
  const capabilityRegressions = report.capability_changes.changes.filter((c) => c.type === "reclassified" || c.type === "removed");
  const evidenceRegressions = report.evidence_changes.changes.filter((c) => c.type !== "added");
  const blastByLevel: Record<string, number> = {};
  for (const entry of report.blast_radius.entries) blastByLevel[entry.level] = (blastByLevel[entry.level] ?? 0) + 1;
  const exceptions = report.findings.filter((f) => f.excepted);

  const lines: string[] = [];
  lines.push("# Architecture Governance Summary");
  lines.push("");
  lines.push(`**Baseline snapshot:** \`${report.source_snapshot_id}\``);
  lines.push(`**Current snapshot:** \`${report.target_snapshot_id}\``);
  lines.push(`**Compatibility:** ${report.compatibility}`);
  lines.push("");
  lines.push("## Change counts by domain");
  lines.push("");
  for (const [domain, count] of changeCountsByDomain(report)) lines.push(`- ${domain}: ${count}`);
  lines.push("");
  lines.push("## Blocking and review-required findings");
  lines.push("");
  lines.push(findingsTable(report.findings));
  lines.push("## Capability regressions");
  lines.push("");
  lines.push(capabilityRegressions.length > 0 ? capabilityRegressions.map((c) => `- \`${c.entity_id}\`: ${c.detail}`).join("\n") : "_None._");
  lines.push("");
  lines.push("## Evidence regressions");
  lines.push("");
  lines.push(evidenceRegressions.length > 0 ? evidenceRegressions.map((c) => `- \`${c.evidence_ref.path}\`: ${c.detail}`).join("\n") : "_None._");
  lines.push("");
  lines.push("## Blast radius");
  lines.push("");
  lines.push(
    Object.keys(blastByLevel).length > 0
      ? Object.entries(blastByLevel)
          .map(([level, count]) => `- ${level}: ${count}`)
          .join("\n")
      : "_No blast radius entries assessed._",
  );
  lines.push("");
  lines.push("## Exceptions applied");
  lines.push("");
  lines.push(
    exceptions.length > 0
      ? exceptions.map((f) => `- \`${f.id}\` (${f.policy_id}/${f.rule_id}): ${f.exception?.reason ?? ""} (approval: ${f.exception?.approval_reference ?? "n/a"})`).join("\n")
      : "_None._",
  );
  lines.push("");
  lines.push("## Narrative summary");
  lines.push("");
  lines.push(narrative.summary);
  lines.push("");
  lines.push(narrative.whatChanged);
  lines.push("");
  lines.push(narrative.whyItMatters);
  lines.push("");
  lines.push(narrative.riskAssessment);
  lines.push("");
  lines.push(narrative.recommendedActions);
  lines.push("");
  return lines.join("\n");
}
