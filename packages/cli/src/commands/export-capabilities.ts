import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { CapabilityModel, CapabilitiesMarkdownOptions } from "@rvs/capability-intelligence";
import { DEFAULT_CAPABILITIES_MARKDOWN_OPTIONS, exportCapabilitiesMarkdown, exportCapabilityExclusionsJson } from "@rvs/capability-intelligence";
import { readCachedJson } from "../cache.js";

export interface ExportCapabilitiesOptions {
  output?: string;
  includePartial?: boolean;
  includeGaps?: boolean;
  includeRoadmap?: boolean;
  includeExcluded?: boolean;
}

// Pure formatting over the already-synthesized, already-gated
// capability-model.json cache — `rvs synthesize capabilities` must run
// first. This command makes no inclusion/exclusion judgment of its own; it
// only chooses which already-decided sections to render.
export async function runExportCapabilities(repoRoot: string, opts: ExportCapabilitiesOptions, logger: Logger): Promise<void> {
  const model = readCachedJson<CapabilityModel>(repoRoot, "capability-model.json");

  const options: CapabilitiesMarkdownOptions = {
    includePartial: opts.includePartial ?? DEFAULT_CAPABILITIES_MARKDOWN_OPTIONS.includePartial,
    includeGaps: opts.includeGaps ?? DEFAULT_CAPABILITIES_MARKDOWN_OPTIONS.includeGaps,
    includeRoadmap: opts.includeRoadmap ?? DEFAULT_CAPABILITIES_MARKDOWN_OPTIONS.includeRoadmap,
    includeExcluded: opts.includeExcluded ?? DEFAULT_CAPABILITIES_MARKDOWN_OPTIONS.includeExcluded,
  };

  const markdown = exportCapabilitiesMarkdown(model, options);
  const outputPath = resolve(repoRoot, opts.output ?? "CAPABILITIES.md");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown);

  if (options.includeExcluded) {
    const exclusionsPath = resolve(dirname(outputPath), "capability-exclusions.json");
    writeFileSync(exclusionsPath, exportCapabilityExclusionsJson(model));
    logger.info(`Wrote ${exclusionsPath}`);
  }

  logger.info(`Wrote ${outputPath} (${model.evidenceSummary.includedCount} included, ${model.evidenceSummary.qualifiedCount} qualified capabilities across ${model.domains.length} domains).`);
}
