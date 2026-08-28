import { pathToFileURL } from "node:url";
import { launchChromium, type BrowserLaunchOptions } from "./browser.js";
import { MINIMUM_TEXT_SIZE_PX } from "@rvs/visual-intelligence";
import { collectSceneReports, type CollectOptions, type SceneReport } from "./checks.js";

export type ContrastLevel = "AA" | "AAA";

export interface ValidationOptions {
  minFontSizePx?: number;
  minimumContrast?: ContrastLevel;
  /**
   * Which polarity of a dual-polarity stylesheet to measure.
   *
   * Milestone 10.5 generates one stylesheet carrying both palettes, the dark
   * one behind `prefers-color-scheme: dark`. A checker that only ever sees
   * the browser's default reports on half of what ships, and contrast is
   * exactly the property that differs between the halves -- so a dark theme
   * could fail WCAG AA in every reader's browser while every run here came
   * back clean. Defaults to the browser's own preference, which keeps every
   * existing caller's behaviour unchanged.
   */
  colorScheme?: "light" | "dark";
  /**
   * Passed straight to the browser launcher.
   *
   * Exists so a caller can pin an install, and so the "browser unavailable"
   * path is reachable in a test without mocking the launcher away -- pointing
   * at an executable that is not there produces the real failure, through the
   * real code, rather than a forged one.
   */
  launchOptions?: BrowserLaunchOptions;
}

export interface ValidationSummary {
  scenes: number;
  passed: number;
  failed: number;
  warnings: number;
}

export interface ValidationReport {
  generated_at: string;
  source_file: string;
  scenes: SceneReport[];
  summary: ValidationSummary;
}

const CONTRAST_THRESHOLDS: Record<ContrastLevel, { normal: number; large: number }> = {
  AA: { normal: 4.5, large: 3.0 },
  AAA: { normal: 7.0, large: 4.5 },
};

export async function validateHtmlFile(
  htmlPath: string,
  options: ValidationOptions = {},
): Promise<ValidationReport> {
  // The floor lives in @rvs/visual-intelligence, not here. Milestone 10.5
  // introduced a token layer that also has to know the smallest legible size,
  // and two literals that must agree are two literals that eventually will
  // not. This module still owns *enforcement*; it no longer owns the number.
  const minFontSizePx = options.minFontSizePx ?? MINIMUM_TEXT_SIZE_PX;
  const contrast = CONTRAST_THRESHOLDS[options.minimumContrast ?? "AA"];

  const collectOptions: CollectOptions = {
    minFontSizePx,
    contrastThresholdNormal: contrast.normal,
    contrastThresholdLarge: contrast.large,
    largeTextPx: 24,
  };

  const browser = await launchChromium(options.launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(htmlPath).toString());
    await page.emulateMedia(
      options.colorScheme === undefined ? { media: "print" } : { media: "print", colorScheme: options.colorScheme },
    );
    await page.waitForTimeout(50); // allow layout to settle after the media-query switch

    // tsx/esbuild's dev transform wraps nested named functions with calls to a
    // `__name` helper for stack-trace fidelity. That helper lives in the
    // compiled module scope, not in collectSceneReports' own source, so once
    // Playwright serializes the function for page.evaluate it would otherwise
    // throw ReferenceError: __name is not defined. Stub it in the page first.
    await page.evaluate(() => {
      (window as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn) => fn;
    });

    const scenes = await page.evaluate(collectSceneReports, collectOptions);

    let passed = 0;
    let failed = 0;
    let warnings = 0;
    for (const scene of scenes) {
      for (const check of scene.checks) {
        if (check.status === "pass") passed += 1;
        else if (check.status === "fail") failed += 1;
        else warnings += 1;
      }
    }

    return {
      generated_at: new Date().toISOString(),
      source_file: htmlPath,
      scenes,
      summary: { scenes: scenes.length, passed, failed, warnings },
    };
  } finally {
    await browser.close();
  }
}
