import type { ArchitectureScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

const VIEW_W = 1120;
const VIEW_H = 480;
const NODE_H = 64;

interface LaidOutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
}

function layoutNodes(nodes: ArchitectureScene["nodes"]): LaidOutNode[] {
  const rows = nodes.length > 5 ? 2 : 1;
  const cols = Math.ceil(nodes.length / rows);
  const cellW = VIEW_W / cols;
  const cellH = VIEW_H / rows;
  const boxW = Math.min(cellW - 40, 240);

  return nodes.map((node, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      id: node.id,
      label: node.label,
      x: cellW * col + cellW / 2,
      y: cellH * row + cellH / 2,
      w: boxW,
    };
  });
}

export function renderArchitectureScene(scene: ArchitectureScene): string {
  const laidOut = layoutNodes(scene.nodes);
  const byId = new Map(laidOut.map((n) => [n.id, n]));

  const edgeSvg = scene.edges
    .map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return "";
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="architecture-edge" marker-end="url(#rvs-arrow)" />`;
    })
    .join("");

  const nodeSvg = laidOut
    .map(
      (n) => `
      <g class="architecture-node" transform="translate(${n.x - n.w / 2}, ${n.y - NODE_H / 2})">
        <rect width="${n.w}" height="${NODE_H}" rx="8" />
        <text x="${n.w / 2}" y="${NODE_H / 2}" dominant-baseline="middle" text-anchor="middle">${escapeHtml(n.label)}</text>
      </g>`,
    )
    .join("");

  const ariaLabel = `Architecture diagram: ${scene.nodes.map((n) => n.label).join(", ")}`;

  return `
    <div class="scene-architecture">
      <h1>${escapeHtml(scene.headline)}</h1>
      <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" class="architecture-svg" role="img" aria-label="${escapeHtml(ariaLabel)}">
        <defs>
          <marker id="rvs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        ${edgeSvg}
        ${nodeSvg}
      </svg>
    </div>
  `;
}
