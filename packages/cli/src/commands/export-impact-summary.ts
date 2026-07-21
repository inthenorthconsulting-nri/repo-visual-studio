import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { KNOWLEDGE_GRAPH_OUTPUT_FILES } from "@rvs/knowledge-graph";
import type { ImpactResult } from "@rvs/knowledge-graph";
import { readGraphCachedJson } from "../graph-cache.js";

export interface ExportImpactSummaryOptions {
  output?: string;
}

// This command only ever WRITES a local Markdown file — it never posts,
// comments, or otherwise publishes anywhere, mirroring
// export-decision-summary.ts's identical precedent. Impact queries are
// parameterized and not automatically re-run by `export`, so this reads
// the last-run cached impact-results.json rather than running a new query.
export async function runExportImpactSummary(repoRoot: string, opts: ExportImpactSummaryOptions, logger: Logger): Promise<void> {
  const impactResults = readGraphCachedJson<ImpactResult[]>(repoRoot, KNOWLEDGE_GRAPH_OUTPUT_FILES.impactResults);
  if (impactResults.length === 0) {
    throw new Error("No cached impact results. Run `rvs graph impact <entity-id>` first.");
  }
  const result = impactResults[impactResults.length - 1];

  const markdown = buildImpactSummaryMarkdown(result);

  const outputPath = resolve(repoRoot, opts.output ?? "impact-summary.md");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);

  logger.info(`Wrote ${outputPath}.`);
}

function buildImpactSummaryMarkdown(result: ImpactResult): string {
  const lines: string[] = [];
  lines.push("# Knowledge Graph Impact Summary");
  lines.push("");
  lines.push(`**Entity:** \`${result.query.entity_node_id}\``);
  lines.push(`**Direction:** ${result.query.direction} · **Max depth:** ${result.query.max_depth}`);
  lines.push(`**Blast radius:** ${result.blast_radius_level}${result.truncated ? " (truncated)" : ""}`);
  lines.push("");
  lines.push("## Affected entities");
  lines.push("");
  lines.push(`- Directly affected: ${result.directly_affected.length}`);
  lines.push(`- Transitively affected: ${result.transitively_affected.length}`);
  lines.push(`- Products affected: ${result.products_affected.length}`);
  lines.push(`- Capabilities affected: ${result.capabilities_affected.length}`);
  lines.push(`- Decisions affected: ${result.decisions_affected.length}`);
  lines.push(`- Governance findings affected: ${result.governance_findings_affected.length}`);
  lines.push(`- Assumptions potentially invalidated: ${result.assumptions_potentially_invalidated.length}`);
  lines.push("");
  if (result.unresolved_downstream_impact) {
    lines.push("> Impact analysis reached an unresolved reference — downstream impact may be incomplete.");
    lines.push("");
  }
  lines.push("## Edge types traversed");
  lines.push("");
  lines.push(result.edge_types_traversed.length > 0 ? result.edge_types_traversed.map((type) => `\`${type}\``).join(", ") : "(none)");
  lines.push("");
  return lines.join("\n");
}
