import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { validateHtmlFile } from "@rvs/validator";

export async function runValidate(repoRoot: string, ci: boolean, logger: Logger): Promise<void> {
  const config = loadConfig(repoRoot);
  const outputDir = resolve(repoRoot, config.defaults.output_dir);
  const htmlPath = resolve(outputDir, "deck.html");
  if (!existsSync(htmlPath)) {
    throw new Error("No deck.html found. Run `rvs create slides` first.");
  }

  const report = await validateHtmlFile(htmlPath, { minimumContrast: config.quality.minimum_contrast });
  writeFileSync(resolve(outputDir, "validation-report.json"), JSON.stringify(report, null, 2));

  logger.info(
    `Validated ${report.summary.scenes} scenes: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings.`,
  );

  for (const scene of report.scenes) {
    for (const check of scene.checks) {
      if (check.status === "fail") logger.error(`[${scene.scene_id}] ${check.rule}: ${check.message}`);
      else if (check.status === "warn") logger.warn(`[${scene.scene_id}] ${check.rule}: ${check.message}`);
    }
  }

  if (ci) {
    const blocking = report.scenes.some((scene) =>
      scene.checks.some((check) => {
        if (check.status === "fail" && check.rule === "overflow") return config.quality.fail_on_overflow;
        if (check.status === "fail" && (check.rule === "contrast" || check.rule === "min-font-size")) return true;
        if (check.status === "warn" && check.rule === "missing-evidence") return config.quality.fail_on_missing_evidence;
        return false;
      }),
    );
    if (blocking) {
      logger.error("Validation failed under --ci policy.");
      process.exitCode = 1;
    }
  }
}
