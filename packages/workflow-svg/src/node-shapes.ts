import type { WorkflowNodeType } from "@rvs/workflow-graph";

export const NODE_TYPE_HEIGHTS: Record<WorkflowNodeType, number> = {
  trigger: 48,
  job: 56,
  step: 40,
  "reusable-workflow": 56,
  environment: 48,
  approval: 48,
  artifact: 44,
  unknown: 48,
};

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: "Trigger",
  job: "Job",
  step: "Step",
  "reusable-workflow": "Reusable workflow",
  environment: "Environment",
  approval: "Approval",
  artifact: "Artifact",
  unknown: "Unknown",
};

export interface NodeColors {
  fill: string;
  stroke: string;
  text: string;
}

// A fixed, self-contained palette matching @rvs/workflow-mermaid's classDefs
// for visual family resemblance across renderers, without either renderer
// depending on the other. Callers that have a live DesignTokens instance
// (e.g. renderer-html) may override via RenderSvgOptions.colors.
export const DEFAULT_NODE_COLORS: Record<WorkflowNodeType, NodeColors> = {
  trigger: { fill: "#e0f2fe", stroke: "#0284c7", text: "#0c4a6e" },
  job: { fill: "#ffffff", stroke: "#334155", text: "#0f172a" },
  step: { fill: "#f8fafc", stroke: "#94a3b8", text: "#334155" },
  "reusable-workflow": { fill: "#ede9fe", stroke: "#7c3aed", text: "#4c1d95" },
  environment: { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" },
  approval: { fill: "#fef9c3", stroke: "#ca8a04", text: "#713f12" },
  artifact: { fill: "#fee2e2", stroke: "#dc2626", text: "#7f1d1d" },
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
// and truncated independently of the shape).
export function renderNodeShape(type: WorkflowNodeType, x: number, y: number, width: number, height: number, attrs: ShapeAttrs): string {
  const dash = attrs.dashed ? ' stroke-dasharray="5 3"' : "";
  const strokeWidth = attrs.strokeWidth ?? 1.5;
  const common = `fill="${attrs.fill}" stroke="${attrs.stroke}" stroke-width="${strokeWidth}"${dash}`;

  switch (type) {
    case "trigger": {
      const rx = height / 2;
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" ${common} />`;
    }
    case "job":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ry="8" ${common} />`;
    case "step":
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ry="6" ${common} />`;
    case "reusable-workflow": {
      const inset = 4;
      return [
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" ry="8" ${common} />`,
        `<rect x="${x + inset}" y="${y + inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="5" ry="5" fill="none" stroke="${attrs.stroke}" stroke-width="1" />`,
      ].join("");
    }
    case "environment": {
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
    case "approval": {
      const points = [`${x + width / 2},${y}`, `${x + width},${y + height / 2}`, `${x + width / 2},${y + height}`, `${x},${y + height / 2}`].join(" ");
      return `<polygon points="${points}" ${common} />`;
    }
    case "artifact": {
      const skew = width * 0.12;
      const points = [`${x + skew},${y}`, `${x + width},${y}`, `${x + width - skew},${y + height}`, `${x},${y + height}`].join(" ");
      return `<polygon points="${points}" ${common} />`;
    }
    case "unknown":
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" ry="4" ${common} stroke-dasharray="4 2" />`;
  }
}
