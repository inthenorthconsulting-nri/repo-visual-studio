// XML-safe escaping for text placed inside SVG <text>/<title>/<desc>
// elements and inside quoted attribute values.
export function escapeSvgText(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
