import type { TerraformNodeType } from "@rvs/terraform-graph";
import type { NodeColors } from "@rvs/workflow-svg";

export const NODE_TYPE_HEIGHTS: Record<TerraformNodeType, number> = {
  "root-module": 56,
  "child-module": 56,
  "external-module": 52,
  resource: 48,
  "data-source": 48,
  provider: 48,
  variable: 40,
  output: 40,
  local: 40,
  backend: 48,
  unknown: 48,
};

export const NODE_TYPE_LABELS: Record<TerraformNodeType, string> = {
  "root-module": "Root module",
  "child-module": "Child module",
  "external-module": "External module",
  resource: "Resource",
  "data-source": "Data source",
  provider: "Provider",
  variable: "Variable",
  output: "Output",
  local: "Local value",
  backend: "Backend",
  unknown: "Unknown",
};

// Mirrors @rvs/terraform-mermaid/src/node-shapes.ts's NODE_TYPE_CLASS_DEFS
// palette (same hex values) so the Mermaid and native-SVG renderings of the
// same topology are visually consistent, without either renderer depending
// on the other.
export const DEFAULT_NODE_COLORS: Record<TerraformNodeType, NodeColors> = {
  "root-module": { fill: "#ede9fe", stroke: "#6d28d9", text: "#3b0764" },
  "child-module": { fill: "#f3e8ff", stroke: "#7c3aed", text: "#4c1d95" },
  "external-module": { fill: "#f1f5f9", stroke: "#64748b", text: "#334155" },
  resource: { fill: "#ffffff", stroke: "#334155", text: "#0f172a" },
  "data-source": { fill: "#e0f2fe", stroke: "#0284c7", text: "#0c4a6e" },
  provider: { fill: "#fef3c7", stroke: "#d97706", text: "#78350f" },
  variable: { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" },
  output: { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
  local: { fill: "#f8fafc", stroke: "#94a3b8", text: "#334155" },
  backend: { fill: "#fce7f3", stroke: "#db2777", text: "#831843" },
  unknown: { fill: "#f1f5f9", stroke: "#64748b", text: "#334155" },
};

interface ShapeAttrs {
  fill: string;
  stroke: string;
  dashed: boolean;
  strokeWidth?: number;
}

// Renders the type-distinguishing shape geometry only (fill/stroke/dash
// applied here; text is drawn separately by render.ts so it can be measured
// and truncated independently of the shape). Shape choices mirror
// @rvs/terraform-mermaid's wrapNodeShape (same 11 TerraformNodeType cases),
// translated to SVG primitives instead of Mermaid flowchart syntax.
export function renderNodeShape(type: TerraformNodeType, x: number, y: number, width: number, height: number, attrs: ShapeAttrs): string {
  const dash = attrs.dashed ? ' stroke-dasharray="5 3"' : "";
  const strokeWidth = attrs.strokeWidth ?? 1.5;
  const common = `fill="${attrs.fill}" stroke="${attrs.stroke}" stroke-width="${strokeWidth}"${dash}`;

  switch (type) {
    case "root-module":
    case "child-module": {
      const inset = 4;
      return [
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ry="8" ${common} />`,
        `<rect x="${x + inset}" y="${y + inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="5" ry="5" fill="none" stroke="${attrs.stroke}" stroke-width="1" />`,
      ].join("");
    }
    case "external-module": {
      const skew = width * 0.12;
      const points = [`${x + skew},${y}`, `${x + width},${y}`, `${x + width - skew},${y + height}`, `${x},${y + height}`].join(" ");
      return `<polygon points="${points}" ${common} stroke-dasharray="5 3" />`;
    }
    case "resource":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ry="6" ${common} />`;
    case "data-source": {
      const rx = width / 2;
      const ry = Math.min(10, height / 4);
      return [
        `<path d="M${x},${y + ry} a${rx},${ry} 0 0 1 ${width},0 v${height - ry * 2} a${rx},${ry} 0 0 1 -${width},0 z" ${common} />`,
        `<path d="M${x},${y + ry} a${rx},${ry} 0 0 0 ${width},0" fill="none" stroke="${attrs.stroke}" stroke-width="${strokeWidth}"${dash} />`,
      ].join("");
    }
    case "provider": {
      const cut = height / 3;
      const points = [
        `${x + cut},${y}`,
        `${x + width - cut},${y}`,
        `${x + width},${y + height / 2}`,
        `${x + width - cut},${y + height}`,
        `${x + cut},${y + height}`,
        `${x},${y + height / 2}`,
      ].join(" ");
      return `<polygon points="${points}" ${common} />`;
    }
    case "variable": {
      const rx = height / 2;
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" ${common} />`;
    }
    case "output": {
      const notch = height / 2;
      const points = [`${x},${y}`, `${x + width - notch},${y}`, `${x + width},${y + height / 2}`, `${x + width - notch},${y + height}`, `${x},${y + height}`].join(" ");
      return `<polygon points="${points}" ${common} />`;
    }
    case "local":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" ry="3" ${common} />`;
    case "backend": {
      const skew = width * 0.14;
      const points = [`${x},${y}`, `${x + width},${y}`, `${x + width - skew},${y + height}`, `${x + skew},${y + height}`].join(" ");
      return `<polygon points="${points}" ${common} />`;
    }
    case "unknown":
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" ry="4" ${common} stroke-dasharray="4 2" />`;
  }
}
