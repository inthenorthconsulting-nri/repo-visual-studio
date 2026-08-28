// SVG emission primitives.
//
// Everything this package produces is a *string*. There is no DOM node, no
// serializer, and no template engine, which is what keeps output identical
// in the CLI, in a test, and inside a browser page.
//
// The escaping rules below are the package's security boundary. Every value
// that reaches an attribute or a text node comes from repository evidence --
// a file path, a Terraform resource name, a commit subject -- and none of it
// is trusted. A label containing `</text><script>` must land as literal
// characters a reader can see, never as markup a browser can act on.

/** Escapes text placed between tags. */
export function escapeText(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a value placed inside a double-quoted attribute. */
export function escapeAttribute(raw: string): string {
  return escapeText(raw).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Attribute values this package will never emit.
 *
 * `on*` handlers and `javascript:`/`data:` URLs are the two ways a string
 * becomes executable inside an SVG. Rather than trusting every call site to
 * remember that, attribute emission drops them centrally: a caller cannot
 * introduce an event handler even by accident, and a label that happens to
 * look like a URL is still only ever text.
 */
function isForbiddenAttribute(name: string): boolean {
  return /^on/i.test(name) || name.toLowerCase() === "xlink:href" || name.toLowerCase() === "href";
}

export type AttributeValue = string | number | undefined;

/**
 * Serialises attributes in the order given.
 *
 * Order is caller-controlled and never sorted here, because attribute order
 * is part of the byte-for-byte output a determinism proof compares.
 */
export function attributes(pairs: ReadonlyArray<readonly [string, AttributeValue]>): string {
  const parts: string[] = [];
  for (const [name, value] of pairs) {
    if (value === undefined) continue;
    if (isForbiddenAttribute(name)) continue;
    const text = typeof value === "number" ? formatNumber(value) : value;
    parts.push(`${name}="${escapeAttribute(text)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * Formats a coordinate.
 *
 * Rounded to two decimals so that a value computed as 0.1+0.2 and one
 * computed as 0.3 serialise identically. Without this, floating-point
 * association order -- which differs between two mathematically equivalent
 * layout expressions -- would leak into the output bytes and break the
 * determinism proof for reasons that have nothing to do with layout.
 * `-0` is normalised to `0` for the same reason.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function element(
  tag: string,
  attrs: ReadonlyArray<readonly [string, AttributeValue]>,
  children?: string,
): string {
  const open = `<${tag}${attributes(attrs)}`;
  return children === undefined || children === "" ? `${open}/>` : `${open}>${children}</${tag}>`;
}

/** A `<title>` child: the accessible name of the shape that contains it. */
export function title(text: string): string {
  return `<title>${escapeText(text)}</title>`;
}

/** A `<desc>` child: the longer description a screen reader reads after the title. */
export function desc(text: string): string {
  return `<desc>${escapeText(text)}</desc>`;
}

/** Builds an SVG path `d` from absolute points, formatted through `formatNumber`. */
export function polylinePath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const head = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
  const tail = rest.map((p) => `L ${formatNumber(p.x)} ${formatNumber(p.y)}`);
  return [head, ...tail].join(" ");
}
