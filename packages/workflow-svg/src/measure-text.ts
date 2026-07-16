// Text sizing must be fully deterministic and require no DOM/canvas/browser
// (the renderer runs headless in the CLI). We use a fixed average
// character-width estimate for the system-font stack rather than real font
// metrics — good enough for layout sizing, and stable across machines/CI.
const AVG_CHAR_WIDTH = 7.2; // px, for a 14px sans-serif label
const HORIZONTAL_PADDING = 24; // px, both sides combined
const MIN_NODE_WIDTH = 96;
const MAX_NODE_WIDTH = 280;

export function estimateLabelWidth(label: string): number {
  const raw = HORIZONTAL_PADDING + label.length * AVG_CHAR_WIDTH;
  return Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.round(raw)));
}

// Truncates a label so it fits within maxWidth at AVG_CHAR_WIDTH, appending
// an ellipsis. The full, untruncated label is always preserved separately
// (as a <title> and data attribute) so nothing is lost, only visually
// shortened.
export function truncateLabelForWidth(label: string, maxWidth: number): string {
  const flattened = label.replace(/\r?\n/g, " ").trim();
  const maxChars = Math.max(1, Math.floor((maxWidth - HORIZONTAL_PADDING) / AVG_CHAR_WIDTH));
  if (flattened.length <= maxChars) return flattened;
  return `${flattened.slice(0, Math.max(1, maxChars - 1))}…`;
}
