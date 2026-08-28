import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { buildReviewAssembly } from "@rvs/visual-change-review";
import type { ReviewAssembly, ReviewChange } from "@rvs/visual-change-review";
import { collectChangeReviewSource } from "./graph-review.js";

// `rvs export change-review-summary` -- the change review as Markdown.
//
// The same two snapshots, read through the same collector `rvs graph review`
// uses, rendered as text a person can paste into a pull request themselves.
// It writes one local file and nothing else: it does not post to GitHub, does
// not comment on a pull request, does not approve one and does not block one.
// Whether any of this reaches a reviewer is a decision a person makes.
//
// Nothing here re-derives a change, a severity, a decision state or a blast
// radius. Every line below is a rendering of a field that arrived from
// upstream through the assembly.

export interface ExportChangeReviewSummaryOptions {
  from?: string;
  to?: string;
  output?: string;
}

const DEFAULT_OUTPUT = "change-review-summary.md";

export async function runExportChangeReviewSummary(
  repoRoot: string,
  opts: ExportChangeReviewSummaryOptions,
  logger: Logger,
): Promise<void> {
  if (!opts.from || !opts.to) {
    throw new Error(
      "`rvs export change-review-summary` requires --from <snapshot-dir> and --to <snapshot-dir>.",
    );
  }

  const collected = collectChangeReviewSource(repoRoot, opts.from, opts.to);
  const assembly = buildReviewAssembly(collected.source);
  const markdown = buildChangeReviewSummaryMarkdown(assembly, collected.impactResultCount);

  const outputPath = resolve(repoRoot, opts.output ?? DEFAULT_OUTPUT);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);

  logger.info(`Wrote ${relative(repoRoot, outputPath)} (${assembly.changes.length} changes).`);
  logger.info(`  Nothing was posted, commented, approved, or blocked. Sharing it is a decision you make.`);
}

/** Groups changes by type in the fixed order the review uses, so two runs read alike. */
const CHANGE_TYPE_ORDER = [
  "added",
  "removed",
  "modified",
  "rerouted",
  "regressed",
  "resolved",
  "qualified",
  "unresolved",
] as const;

export function buildChangeReviewSummaryMarkdown(assembly: ReviewAssembly, impactResultCount: number): string {
  const lines: string[] = [];
  lines.push("# Architecture change review");
  lines.push("");
  lines.push(`**From:** \`${assembly.from_snapshot_id}\`  `);
  lines.push(`**To:** \`${assembly.to_snapshot_id}\`  `);
  lines.push(`**Comparability:** ${assembly.compatibility.status}`);
  if (assembly.compatibility.reasons.length > 0) {
    lines.push("");
    for (const reason of assembly.compatibility.reasons) lines.push(`> ${reason}`);
  }
  lines.push("");

  if (assembly.changes.length === 0) {
    // The no-change state, in the same words the viewer uses. Not "nothing to
    // see": a comparison that ran and found nothing is a result.
    lines.push("No material graph changes were detected between these compatible snapshots.");
    lines.push("");
  } else {
    lines.push("## What changed");
    lines.push("");
    for (const type of CHANGE_TYPE_ORDER) {
      const group = assembly.changes.filter((change) => change.change_type === type);
      if (group.length === 0) continue;
      lines.push(`### ${type} (${group.length})`);
      lines.push("");
      for (const change of group) lines.push(changeLine(change));
      lines.push("");
    }
  }

  if (assembly.governance_findings.length > 0) {
    lines.push("## Governance findings");
    lines.push("");
    // Severity and resolution are upstream's words. This file neither decides
    // that a change is safe nor that it is not.
    for (const finding of assembly.governance_findings) {
      lines.push(
        `- **${finding.severity}**${finding.resolved ? " (recorded as resolved)" : ""} — ${finding.summary}` +
          (finding.affected_entity_ids.length > 0 ? ` (${finding.affected_entity_ids.join(", ")})` : ""),
      );
    }
    lines.push("");
  }

  if (assembly.decision_impacts.length > 0) {
    lines.push("## Decision impacts");
    lines.push("");
    for (const impact of assembly.decision_impacts) {
      lines.push(`- \`${impact.decision_entity_id}\` — **${impact.state}**: ${impact.detail}`);
    }
    lines.push("");
    lines.push(
      "A decision impact records how a change relates to a recorded decision. It does not say the change is correct, and it approves and rejects nothing.",
    );
    lines.push("");
  }

  if (assembly.review_required_ids.length > 0) {
    lines.push("## Marked for review upstream");
    lines.push("");
    for (const id of assembly.review_required_ids) lines.push(`- \`${id}\``);
    lines.push("");
  }

  lines.push("## Unresolved");
  lines.push("");
  if (assembly.unresolved_impacts.length === 0 && impactResultCount > 0) {
    lines.push("Every change in this review has an evidence-backed route recorded against it.");
  } else {
    for (const unresolved of assembly.unresolved_impacts) {
      lines.push(`- ${unresolved.statement}${unresolved.boundary ? ` (${unresolved.boundary})` : ""}`);
    }
    if (impactResultCount === 0) {
      lines.push("");
      lines.push(
        "No cached impact results were available, so downstream consumer reach is unresolved for every change. Run `rvs graph impact <entity-id>` for the entities you care about.",
      );
    }
  }
  lines.push("");

  if (assembly.unavailable_domains.length > 0) {
    lines.push("## Not comparable");
    lines.push("");
    lines.push(
      `${assembly.unavailable_domains.join(", ")} could not be compared between these snapshots, so nothing is reported about them either way. That is not the same as saying nothing changed in them.`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "This summary is read-only. It was written to a file; nothing was posted, commented, approved, or blocked.",
  );
  lines.push("");
  return lines.join("\n");
}

function changeLine(change: ReviewChange): string {
  const links: string[] = [];
  if (change.capability_ids.length > 0) links.push(`capabilities: ${change.capability_ids.join(", ")}`);
  if (change.product_ids.length > 0) links.push(`products: ${change.product_ids.join(", ")}`);
  if (change.decision_ids.length > 0) links.push(`decisions: ${change.decision_ids.join(", ")}`);
  if (change.governance_finding_ids.length > 0) links.push(`findings: ${change.governance_finding_ids.join(", ")}`);
  const suffix = links.length > 0 ? ` — ${links.join(" · ")}` : "";
  const review = change.review_required ? " **[review required]**" : "";
  return `- \`${change.entity_id}\` (${change.entity_type}) — ${change.summary}${review} · blast radius: ${change.blast_radius}${suffix}`;
}
