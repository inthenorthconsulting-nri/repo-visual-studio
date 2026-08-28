import { chromium, type Browser } from "playwright";

// One place where a browser is started, and one distinction it exists to make.
//
// "The candidate is wrong" and "we could not look at the candidate" are
// different sentences, and a delivery gate that collapses them either promotes
// something nobody checked or reports a content defect that does not exist.
// Every rendered check in this package therefore launches through here, and a
// launch that fails raises a type a caller can recognise instead of a string
// it would have to pattern-match.

export interface BrowserLaunchOptions {
  /** Path to a browser binary. Used by callers pinning a specific install. */
  executablePath?: string;
  /** Milliseconds to wait for the browser to start. */
  timeout?: number;
}

/**
 * Raised when the browser could not be started at all.
 *
 * Not a validation failure: nothing about the artifact was measured. Callers
 * that gate on validation must treat this as "verification did not happen",
 * never as "verification failed".
 */
export class BrowserUnavailableError extends Error {
  readonly cause_message: string;

  constructor(causeMessage: string) {
    super(
      `Browser verification is unavailable: ${causeMessage}. ` +
        `Install the browser (\`npx playwright install chromium\`) and run again; nothing about the artifact was measured.`,
    );
    this.name = "BrowserUnavailableError";
    this.cause_message = causeMessage;
  }
}

export async function launchChromium(options: BrowserLaunchOptions = {}): Promise<Browser> {
  try {
    return await chromium.launch(options);
  } catch (error) {
    throw new BrowserUnavailableError(error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
}
