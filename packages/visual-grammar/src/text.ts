// Deterministic text measurement.
//
// Layout needs to know how wide a label is before anything is drawn, and it
// has to get the same answer on a developer's laptop, in CI, and inside the
// validator's browser. Real font metrics cannot provide that -- they depend
// on which fonts are installed -- so this module estimates from character
// classes instead. The estimate is deliberately slightly generous: a label
// that measures wider than it renders leaves whitespace, while one that
// measures narrower overflows its box, and only one of those is a defect.

/** Per-character advance at font-size 1, by character class. */
const NARROW = new Set([..."ijlIt.,;:'`|!()[]{}/\\"]);
const WIDE = new Set([..."ABCDEFGHKMNOPQRSTUVXYZmw@%&WQ"]);

const NARROW_RATIO = 0.31;
const WIDE_RATIO = 0.72;
const DEFAULT_RATIO = 0.55;

/** Estimated rendered width of `text` at `fontSize`, in canonical units. */
export function measureText(text: string, fontSize: number): number {
  let ratio = 0;
  for (const char of text) {
    ratio += NARROW.has(char) ? NARROW_RATIO : WIDE.has(char) ? WIDE_RATIO : DEFAULT_RATIO;
  }
  return Math.round(ratio * fontSize * 100) / 100;
}

/**
 * Shortens `text` to fit `maxWidth`, appending an ellipsis.
 *
 * Truncation here is a *visual* shortening only. Every call site that
 * truncates also emits the full string as the shape's `<title>`, so the
 * complete label stays available to a reader and to a screen reader. That
 * distinction matters: this is not the degradation policy -- nothing is
 * being dropped from the view, and no fidelity receipt entry is warranted
 * for a label that had to be abbreviated in its box.
 */
export function truncateToWidth(text: string, maxWidth: number, fontSize: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (measureText(flat, fontSize) <= maxWidth) return flat;
  const ellipsis = "…";
  const budget = maxWidth - measureText(ellipsis, fontSize);
  if (budget <= 0) return ellipsis;
  const chars = [...flat];
  let width = 0;
  let taken = 0;
  for (const char of chars) {
    const next = measureText(char, fontSize);
    if (width + next > budget) break;
    width += next;
    taken += 1;
  }
  return `${chars.slice(0, Math.max(1, taken)).join("").trimEnd()}${ellipsis}`;
}

/**
 * Wraps `text` into at most `maxLines` lines of `maxWidth`, truncating the
 * last line if the text still does not fit. Wrapping happens at spaces, then
 * at any character for a single word longer than the box.
 */
export function wrapToLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (measureText(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    if (lines.length === maxLines) {
      return finishOverflow(lines, [current, word, ...words.slice(words.indexOf(word) + 1)], maxWidth, fontSize, maxLines);
    }
    current = measureText(word, fontSize) <= maxWidth ? word : truncateToWidth(word, maxWidth, fontSize);
  }
  if (current !== "") lines.push(current);
  return lines.slice(0, maxLines);
}

function finishOverflow(
  lines: string[],
  remaining: readonly string[],
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  const kept = lines.slice(0, maxLines);
  const last = kept.length - 1;
  if (last >= 0) {
    kept[last] = truncateToWidth(`${kept[last]} ${remaining.slice(1).join(" ")}`.trim(), maxWidth, fontSize);
  }
  return kept;
}
