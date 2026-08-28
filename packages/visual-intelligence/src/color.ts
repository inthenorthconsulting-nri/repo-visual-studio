// Colour arithmetic, with no DOM and no dependency.
//
// @rvs/validator already computes contrast, but it does so inside a function
// Playwright serialises into a page, which cannot reference anything outside
// its own body. That constraint forces a second copy of the formula rather
// than inviting one, so this module is the authoring-time copy and
// `colour-parity.test.ts` asserts the two agree on a table of pairs -- the
// same two-copy discipline the explorer and change-review runtimes already
// use for their algorithms.
//
// The thresholds themselves are not restated here. They live in
// @rvs/validator, which is the source of truth §32 names, and
// `accessibility.ts` takes them as input.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

/**
 * Parses a colour this system is prepared to reason about, or returns
 * undefined.
 *
 * Undefined rather than a black default on purpose: a caller that cannot read
 * a colour must be able to say so. Silently returning black would let an
 * unreadable theme value pass a contrast check by accident.
 */
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim();
  const short = HEX3.exec(text);
  if (short) {
    return {
      r: Number.parseInt(`${short[1]}${short[1]}`, 16),
      g: Number.parseInt(`${short[2]}${short[2]}`, 16),
      b: Number.parseInt(`${short[3]}${short[3]}`, 16),
    };
  }
  const long = HEX8.exec(text) ?? HEX6.exec(text);
  if (long) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
    };
  }
  const fn = RGB_FN.exec(text);
  if (fn) {
    const parts = [fn[1], fn[2], fn[3]].map(Number);
    if (parts.some((n) => Number.isNaN(n))) return undefined;
    return { r: clampChannel(parts[0]), g: clampChannel(parts[1]), b: clampChannel(parts[2]) };
  }
  return undefined;
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.x contrast ratio, always >= 1, rounded to two places so two runs agree byte for byte. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a) + 0.05;
  const l2 = relativeLuminance(b) + 0.05;
  const ratio = l1 > l2 ? l1 / l2 : l2 / l1;
  return Math.round(ratio * 100) / 100;
}

/** Contrast between two colour strings, or undefined if either cannot be read. */
export function contrastBetween(a: string, b: string): number | undefined {
  const left = parseColor(a);
  const right = parseColor(b);
  if (left === undefined || right === undefined) return undefined;
  return contrastRatio(left, right);
}

/** Whether a colour sits on the light side of the mid-luminance line. Used to pick a theme's polarity, never to pick a hue. */
export function isLight(color: Rgb): boolean {
  return relativeLuminance(color) > 0.18;
}

/**
 * Linear sRGB-space mix, `t` of `b` into `a`.
 *
 * Deliberately linear in the 0-255 channel space rather than perceptually
 * uniform. A perceptual mix would look better and be harder to reproduce
 * exactly across two implementations; every derived token in this system is
 * checked for contrast afterwards, so exactness matters more than elegance.
 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const f = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * f),
    g: Math.round(a.g + (b.g - a.g) * f),
    b: Math.round(a.b + (b.b - a.b) * f),
  };
}

export function toHex(color: Rgb): string {
  const part = (v: number): string => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/** Mixes two colour strings, returning `undefined` if either is unreadable rather than guessing. */
export function mixHex(a: string, b: string, t: number): string | undefined {
  const left = parseColor(a);
  const right = parseColor(b);
  if (left === undefined || right === undefined) return undefined;
  return toHex(mix(left, right, t));
}
