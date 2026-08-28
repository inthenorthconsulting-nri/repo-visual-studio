import { pathToFileURL } from "node:url";
import { launchChromium, type BrowserLaunchOptions } from "./browser.js";
import {
  collectInteractionFindings,
  RENDERED_INTERACTION_CODES,
  type InteractionFinding,
  type RenderedInteractionCode,
} from "./interaction-checks.js";

export interface InteractionValidationOptions {
  launchOptions?: BrowserLaunchOptions;
  /**
   * Milliseconds to let the page's own script settle before measuring.
   *
   * The interactive artifacts build their control list on load; measuring
   * before that finished would report controls that do not exist yet.
   */
  settleMs?: number;
}

export interface InteractionReport {
  source_file: string;
  /** Every rule that ran. Listed so a passing report proves what was checked, not just that nothing was found. */
  rules: RenderedInteractionCode[];
  /** Failures only, sorted by code then subject. A run over the same bytes produces the same list in the same order. */
  findings: InteractionFinding[];
}

/**
 * Drives a rendered artifact in a real browser and reports what a keyboard
 * reader would hit.
 *
 * Deliberately not part of `validateHtmlFile`: that function measures scenes
 * and returns a per-scene report, and folding a document-wide check into a
 * per-scene shape would either invent a scene or hide the finding. Two
 * questions, two reports, one browser launcher.
 */
export async function validateInteractionHtmlFile(
  htmlPath: string,
  options: InteractionValidationOptions = {},
): Promise<InteractionReport> {
  const browser = await launchChromium(options.launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(htmlPath).toString());
    await page.waitForTimeout(options.settleMs ?? 120);

    // tsx/esbuild's dev transform wraps nested named functions with `__name`
    // calls for stack-trace fidelity, and that helper lives in the compiled
    // module scope rather than in the serialized function. Stub it first, as
    // `validateHtmlFile` does.
    await page.evaluate(() => {
      (window as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn) => fn;
    });

    const findings = await page.evaluate(collectInteractionFindings);
    return { source_file: htmlPath, rules: [...RENDERED_INTERACTION_CODES], findings };
  } finally {
    await browser.close();
  }
}
