import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { exportHtmlToPdf } from "@rvs/exporter";
import type { VisualDoc } from "@rvs/visualdoc-schema";
import { readCachedJson } from "../cache.js";

export async function runExportPdf(repoRoot: string, logger: Logger): Promise<void> {
  const config = loadConfig(repoRoot);
  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  const htmlPath = resolve(outputDir, "deck.html");
  if (!existsSync(htmlPath)) {
    throw new Error("No deck.html found. Run `rvs create slides` first.");
  }

  const doc = readCachedJson<VisualDoc>(repoRoot, "visualdoc.json");
  const pdfPath = resolve(outputDir, "deck.pdf");
  await exportHtmlToPdf(htmlPath, pdfPath, { sceneCount: doc.scenes.length });

  logger.info(`Exported ${doc.scenes.length}-page PDF to ${config.defaults.output_dir}/deck.pdf`);
}
