import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { DecisionNarrative, DecisionPlan } from "@rvs/decision-intelligence";
import { readDecisionCachedJson } from "../decision-cache.js";

export interface ExportDecisionSummaryOptions {
  output?: string;
}

// This command only ever WRITES a local Markdown file — it never posts,
// comments, or otherwise publishes anywhere, mirroring
// export-governance-summary.ts's identical precedent.
export async function runExportDecisionSummary(repoRoot: string, opts: ExportDecisionSummaryOptions, logger: Logger): Promise<void> {
  const narrative = readDecisionCachedJson<DecisionNarrative>(repoRoot, DECISION_OUTPUT_FILES.decisionNarrative);
  const plan = readDecisionCachedJson<DecisionPlan>(repoRoot, DECISION_OUTPUT_FILES.decisionPlan);

  const markdown = buildDecisionSummaryMarkdown(narrative, plan);

  const outputPath = resolve(repoRoot, opts.output ?? "decision-summary.md");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);

  logger.info(`Wrote ${outputPath}.`);
}

function buildDecisionSummaryMarkdown(narrative: DecisionNarrative, plan: DecisionPlan): string {
  const lines: string[] = [];
  lines.push("# Architecture Decisions Summary");
  lines.push("");
  lines.push(`**Snapshot:** \`${narrative.source_snapshot_id}\``);
  if (narrative.target_snapshot_id) lines.push(`**Compared against:** \`${narrative.target_snapshot_id}\``);
  lines.push("");
  for (const section of narrative.sections) {
    lines.push(`## ${section.heading}`);
    lines.push("");
    lines.push(section.body);
    lines.push("");
  }
  lines.push("## Scenes");
  lines.push("");
  for (const scene of plan.scenes) lines.push(`- ${scene.title}`);
  lines.push("");
  return lines.join("\n");
}
