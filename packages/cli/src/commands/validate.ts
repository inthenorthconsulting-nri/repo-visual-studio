import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type Logger } from "@rvs/core";
import { validateHtmlFile } from "@rvs/validator";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { validateCapabilityModelStructure } from "@rvs/capability-intelligence";
import type { ProductIdentityModel, ShowcasePlan } from "@rvs/product-intelligence";
import { loadProductIdentityOverride, validateProductIdentityModel, validateShowcasePlan } from "@rvs/product-intelligence";
import { readCachedJsonOptional } from "../cache.js";

const CAPABILITY_MODEL_CACHE_FILE = "capability-model.json";
const CAPABILITY_VALIDATION_REPORT_FILE = "capability-validation-report.json";
const PRODUCT_IDENTITY_MODEL_CACHE_FILE = "product-identity-model.json";
const PRODUCT_IDENTITY_VALIDATION_REPORT_FILE = "product-identity-validation-report.json";
const SHOWCASE_PLAN_CACHE_FILE = "showcase-plan.json";
const SHOWCASE_VALIDATION_REPORT_FILE = "showcase-validation-report.json";

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

export interface ProductIdentityValidationOutcome {
  /** Whether both a product-identity-model.json and its capability-model.json cache were found. */
  ran: boolean;
  /** Whether any warning carried severity "error" (Tier 1). */
  hasError: boolean;
}

// Product identity (Milestone 5) is optional the same way capability
// intelligence is optional above: a repo/CI run that never runs `rvs
// synthesize product-identity` sees no behavior change at all. Structural
// checks (§28 Tier 1/Tier 2) run over the already-synthesized model — this
// never re-synthesizes identity and never calls an external model.
export function validateCachedProductIdentity(repoRoot: string, outputDir: string, logger: Logger): ProductIdentityValidationOutcome {
  const identityModel = readCachedJsonOptional<ProductIdentityModel>(repoRoot, PRODUCT_IDENTITY_MODEL_CACHE_FILE);
  const capabilityModel = readCachedJsonOptional<CapabilityModel>(repoRoot, CAPABILITY_MODEL_CACHE_FILE);
  if (!identityModel || !capabilityModel) return { ran: false, hasError: false };

  const override = loadProductIdentityOverride(repoRoot);
  const warnings = validateProductIdentityModel(identityModel, capabilityModel, override);
  writeFileSync(resolve(outputDir, PRODUCT_IDENTITY_VALIDATION_REPORT_FILE), JSON.stringify(warnings, null, 2));

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

  logger.info(`Validated product identity: ${errorCount} error(s), ${warningCount} warning(s).`);

  return { ran: true, hasError: errorCount > 0 };
}

// The ShowcasePlan is only present after `rvs create slides --profile
// showcase` has run at least once; likewise fully optional/backward-compatible.
export function validateCachedShowcasePlan(repoRoot: string, outputDir: string, logger: Logger): ProductIdentityValidationOutcome {
  const plan = readCachedJsonOptional<ShowcasePlan>(repoRoot, SHOWCASE_PLAN_CACHE_FILE);
  const capabilityModel = readCachedJsonOptional<CapabilityModel>(repoRoot, CAPABILITY_MODEL_CACHE_FILE);
  if (!plan || !capabilityModel) return { ran: false, hasError: false };

  const warnings = validateShowcasePlan(plan, capabilityModel);
  writeFileSync(resolve(outputDir, SHOWCASE_VALIDATION_REPORT_FILE), JSON.stringify(warnings, null, 2));

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

  logger.info(`Validated showcase plan: ${errorCount} error(s), ${warningCount} warning(s).`);

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
  const productIdentityOutcome = validateCachedProductIdentity(repoRoot, outputDir, logger);
  const showcaseOutcome = validateCachedShowcasePlan(repoRoot, outputDir, logger);

  if (ci) {
    const blocking = report.scenes.some((scene) =>
      scene.checks.some((check) => {
        if (check.status === "fail" && check.rule === "overflow") return config.quality.fail_on_overflow;
        if (check.status === "fail" && (check.rule === "contrast" || check.rule === "min-font-size")) return true;
        if (check.status === "warn" && check.rule === "missing-evidence") return config.quality.fail_on_missing_evidence;
        return false;
      }),
    );
    // Capability-model and product-identity/showcase structural errors
    // always fail --ci, unconditional on any quality flag — there is no
    // config.quality knob for these layers (checked packages/core's config
    // schema), matching the existing precedent that contrast/min-font-size
    // failures above always fail --ci regardless of the fail_on_* flags.
    if (blocking || capabilityOutcome.hasError || productIdentityOutcome.hasError || showcaseOutcome.hasError) {
      logger.error("Validation failed under --ci policy.");
      process.exitCode = 1;
    }
  }
}
