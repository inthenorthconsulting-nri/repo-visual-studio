// Rendered color-independence facts.
//
// Milestone 10's closing question is not "can this state be perceived" --
// that is contrast, and something else already checks it. The question here
// is: if color perception is removed entirely, does the distinction survive?
// A state that only changes hue is invisible to a colorblind reader and to a
// greyscale print, even though its contrast ratio is fine.
//
// This module only collects what a real browser rendered for each
// `[data-rvs-node]`: its active states (`data-rvs-state`), its structured
// marker and badge channels (`data-rvs-marker`, `data-rvs-badge`), and its
// stroke pattern (the child `<rect>`'s `stroke-dasharray`). It does not
// decide what any of that *means* -- `resolveVisualState` already owns that,
// and duplicating its layer/state model here would create the second state
// taxonomy §6 forbids. The Node-side caller in validate-color-independence.ts
// does the comparison.

export interface NodeStateFacts {
  /** The node's `data-rvs-node` id. */
  id: string;
  /** Raw states from `data-rvs-state`, space-separated, parsed. Empty if the attribute is absent or blank. */
  states: string[];
  /** `data-rvs-marker`, or "" if absent/empty. */
  markerText: string;
  /** `data-rvs-badge`, or "" if absent/empty. */
  badgeText: string;
  /** The node's `<rect>` `stroke-dasharray`, or null if the rect has none or the node has no rect child. */
  strokeDasharray: string | null;
}

// Runs inside the page via page.evaluate -- must be a self-contained function
// with no references to the outer TypeScript module scope.
export function collectNodeStateFacts(): NodeStateFacts[] {
  const nodes = Array.from(document.querySelectorAll("[data-rvs-node]")) as SVGElement[] | HTMLElement[];

  const facts: NodeStateFacts[] = nodes.map((node) => {
    const id = node.getAttribute("data-rvs-node") ?? "";
    const rawStates = node.getAttribute("data-rvs-state") ?? "";
    const states = rawStates.split(/\s+/).filter((s) => s !== "");
    const markerText = (node.getAttribute("data-rvs-marker") ?? "").trim();
    const badgeText = (node.getAttribute("data-rvs-badge") ?? "").trim();
    const rect = node.querySelector("rect");
    const strokeDasharray = rect !== null ? rect.getAttribute("stroke-dasharray") : null;
    return { id, states, markerText, badgeText, strokeDasharray };
  });

  return facts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
