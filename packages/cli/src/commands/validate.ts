import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { validateHtmlFile } from "@rvs/validator";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { validateCapabilityModelStructure } from "@rvs/capability-intelligence";
import { readCachedJsonOptional } from "../cache.js";

const CAPABILITY_MODEL_CACHE_FILE = "capability-model.json";
const CAPABILITY_VALIDATION_REPORT_FILE = "capability-validation-report.json";

export interface CapabilityValidationOutcome {
  /** Whether a capability-model.json cache was found at all. */
  ran: boolean;
  /** Whether any warning in the model carried severity "error". */
  hasError: boolean;
}

// Capability intelligence is optional (`rvs synthesize capabilities` is a
// separate, independently-invoked step from `rvs create slides`), so this
// must stay fully backward-compatible: a repo/CI run that never produces
// .rvs/cache/capability-model.json sees no behavior change at all — no log
// output, no report file, no effect on --ci. This mirrors the deck.html
// validation loop above but over the CapabilityModel structural warnings
// from @rvs/capability-intelligence, using the same per-item
// logger.error/logger.warn split already established by
// runSynthesizeCapabilities() for CapIntelWarning severities.
export function validateCachedCapabilityModel(repoRoot: string, outputDir: string, logger: Logger): CapabilityValidationOutcome {
  const model = readCachedJsonOptional<CapabilityModel>(repoRoot, CAPABILITY_MODEL_CACHE_FILE);
  if (!model) return { ran: false, hasError: false };

  const warnings = validateCapabilityModelStructure(model);
  writeFileSync(resolve(outputDir, CAPABILITY_VALIDATION_REPORT_FILE), JSON.stringify(warnings, null, 2));

  let errorCount = 0;
  let warningCount = 0;
  for (const warning of warnings) {
    if (warning.severity === "error") {
      logger.error(`${warning.code}: ${warning.message}`);
      errorCount += 1;
    } else {
      logger.warn(`${warning.code}: ${warning.message}`);
      warningCount += 1;
    }
  }

  logger.info(`Validated capability model: ${errorCount} error(s), ${warningCount} warning(s).`);

  return { ran: true, hasError: errorCount > 0 };
}

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

  const capabilityOutcome = validateCachedCapabilityModel(repoRoot, outputDir, logger);

  if (ci) {
    const blocking = report.scenes.some((scene) =>
      scene.checks.some((check) => {
        if (check.status === "fail" && check.rule === "overflow") return config.quality.fail_on_overflow;
        if (check.status === "fail" && (check.rule === "contrast" || check.rule === "min-font-size")) return true;
        if (check.status === "warn" && check.rule === "missing-evidence") return config.quality.fail_on_missing_evidence;
        return false;
      }),
    );
    // Capability-model structural errors always fail --ci, unconditional on
    // any quality flag — there is no config.quality knob for capability
    // intelligence (checked packages/core's config schema), and this
    // matches the existing precedent that contrast/min-font-size failures
    // above always fail --ci regardless of the fail_on_* flags.
    if (blocking || capabilityOutcome.hasError) {
      logger.error("Validation failed under --ci policy.");
      process.exitCode = 1;
    }
  }
}
