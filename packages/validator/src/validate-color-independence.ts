import { pathToFileURL } from "node:url";
import { resolveVisualState, VISUAL_STATES, type VisualState, type VisualStateLayer } from "@rvs/visual-intelligence";
import { launchChromium, type BrowserLaunchOptions } from "./browser.js";
import { collectNodeStateFacts, type NodeStateFacts } from "./color-independence-checks.js";

// Rendered color independence.
//
// §4's distinction, made checkable: contrast asks whether a color can be
// perceived; this asks whether the *distinction* survives when color
// perception is removed. A state that resolves a different hue and nothing
// else fails this even at perfect contrast, because a colorblind reader or a
// greyscale print sees the same shape as every other state in its layer.
//
// The check stays a comparison against `resolveVisualState`, never a second
// opinion about what a state means (§6, §8): for each layer a rendered node's
// states resolved into, there is exactly one channel that layer is
// responsible for landing on the page, and this asks only whether that
// channel actually arrived.
//
//   lifecycle    -> a marker glyph        (data-rvs-marker)
//   governance   -> a badge               (data-rvs-badge)
//   confidence   -> a non-solid stroke    (the rect's stroke-dasharray)
//   availability -> a badge               (data-rvs-badge)
//
// `interaction` is deliberately not checked here. Every interaction state
// that carries a genuine non-color channel (focused, selected -> focus_ring)
// is realized client-side via CSS classes that this static render never
// emits, so there is nothing in the document for this validator to read, and
// a validator that can never fail is not proof of anything. The states that
// *are* reachable through this render path (hovered, route, related, dimmed,
// normal) are transient pointer/hierarchy effects rather than persisted
// entity facts, or -- for dimmed -- change only opacity, which is itself a
// brightness channel and therefore not a qualifying non-color cue (§9). A
// dedicated focus-visibility validator, once one exists, is the right owner
// for the interaction layer.

export type RenderedColorIndependenceCode = "RENDERED_COLOR_ONLY_STATE";

export const RENDERED_COLOR_INDEPENDENCE_CODES: readonly RenderedColorIndependenceCode[] = [
  "RENDERED_COLOR_ONLY_STATE",
] as const;

/** The specific rendered channel a layer is responsible for landing on the page. */
export type ColorIndependenceChannel = "marker" | "badge" | "stroke_pattern";

export interface ColorIndependenceFinding {
  code: RenderedColorIndependenceCode;
  /** The node's `data-rvs-node` id. */
  subject: string;
  /** The semantic state that lost its non-color cue. */
  state: VisualState;
  /** Which layer resolved this state. */
  layer: VisualStateLayer;
  /** The channel class this layer's meaning is supposed to survive in. */
  expected_channel: ColorIndependenceChannel;
  /** What the render actually carried for this node, for evidence. */
  observed: {
    states: string[];
    markerText: string;
    badgeText: string;
    strokeDasharray: string | null;
  };
  /** Which validator family this belongs to, for delivery-pipeline routing. */
  family: "accessibility";
  message: string;
}

const LAYER_CHANNEL: Partial<Record<VisualStateLayer, ColorIndependenceChannel>> = {
  lifecycle: "marker",
  governance: "badge",
  confidence: "stroke_pattern",
  availability: "badge",
};

function channelPresent(channel: ColorIndependenceChannel, fact: NodeStateFacts): boolean {
  switch (channel) {
    case "marker":
      return fact.markerText !== "";
    case "badge":
      return fact.badgeText !== "";
    case "stroke_pattern":
      return fact.strokeDasharray !== null;
  }
}

const KNOWN_STATES: ReadonlySet<string> = new Set(VISUAL_STATES);

/**
 * Compares each rendered node's active states against what `resolveVisualState`
 * says those states should have landed as non-color channels, per layer.
 *
 * Node-side, not browser-side: `resolveVisualState` is the single canonical
 * source of state meaning (§6), and importing it into the page would mean
 * shipping a second copy of it into the artifact just to validate the first.
 */
export function evaluateColorIndependence(facts: readonly NodeStateFacts[]): {
  findings: ColorIndependenceFinding[];
  checks: number;
} {
  const findings: ColorIndependenceFinding[] = [];
  let checks = 0;

  for (const fact of facts) {
    const validStates = fact.states.filter((s): s is VisualState => KNOWN_STATES.has(s));
    if (validStates.length === 0) continue;

    const resolved = resolveVisualState(validStates);
    for (const layer of resolved.layers) {
      const channel = LAYER_CHANNEL[layer.layer];
      if (channel === undefined) continue; // interaction: out of scope, see module comment.

      checks += 1;
      if (channelPresent(channel, fact)) continue;

      findings.push({
        code: "RENDERED_COLOR_ONLY_STATE",
        subject: fact.id,
        state: layer.state,
        layer: layer.layer,
        expected_channel: channel,
        observed: {
          states: fact.states,
          markerText: fact.markerText,
          badgeText: fact.badgeText,
          strokeDasharray: fact.strokeDasharray,
        },
        family: "accessibility",
        message:
          `Node "${fact.id}" resolved state "${layer.state}" (${layer.layer} layer) but its rendered ` +
          `${channel} channel is empty. With color removed, this state is indistinguishable from a node ` +
          `without it.`,
      });
    }
  }

  return {
    findings: findings.sort((a, b) =>
      a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.state < b.state ? -1 : a.state > b.state ? 1 : 0,
    ),
    checks,
  };
}

export interface ColorIndependenceValidationOptions {
  launchOptions?: BrowserLaunchOptions;
  /** Milliseconds to let the page's own script settle before measuring. */
  settleMs?: number;
}

export interface ColorIndependenceReport {
  source_file: string;
  /** Every rule that ran. Listed so a passing report proves what was checked, not just that nothing was found. */
  rules: RenderedColorIndependenceCode[];
  /** Total layer-level checks evaluated, across every node -- for validator_summary.checks_run accounting. */
  checks: number;
  /** Failures only, sorted by subject then state. A run over the same bytes produces the same list in the same order. */
  findings: ColorIndependenceFinding[];
}

/**
 * Drives a rendered artifact in a real browser and reports which resolved
 * semantic states, layer by layer, are communicated by color alone.
 */
export async function validateColorIndependenceHtmlFile(
  htmlPath: string,
  options: ColorIndependenceValidationOptions = {},
): Promise<ColorIndependenceReport> {
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

    const facts = await page.evaluate(collectNodeStateFacts);
    const { findings, checks } = evaluateColorIndependence(facts);
    return { source_file: htmlPath, rules: [...RENDERED_COLOR_INDEPENDENCE_CODES], checks, findings };
  } finally {
    await browser.close();
  }
}
