import type { EvidenceReference, InferredStatement } from "@rvs/architecture-intelligence";
import { qualifierFor } from "@rvs/architecture-intelligence";
import { escapeHtml } from "../../escape.js";

// Per-entity evidence in ArchitectureIntelligence is {path, lines?} — the
// same shape @rvs/workflow-graph and @rvs/terraform-graph attach to nodes —
// not a claim_id into the evidence manifest. It is rendered directly here,
// mirroring workflow-svg/terraform-svg's evidenceAttr() convention, rather
// than routed through renderCitations().
export function evidenceNote(refs: EvidenceReference[]): string {
  if (refs.length === 0) return "";
  const text = refs.map((r) => (r.lines ? `${r.path}:${r.lines}` : r.path)).join(", ");
  return `<cite class="arch-evidence">${escapeHtml(text)}</cite>`;
}

// Every synthesized statement must surface its inference class so
// suggested/unresolved claims are never silently presented as fact.
export function statementText(statement: InferredStatement): string {
  const qualifier = qualifierFor(statement.inference);
  return qualifier ? `${qualifier}: ${statement.value}` : statement.value;
}

export function statementListItem(statement: InferredStatement): string {
  const qualifier = qualifierFor(statement.inference);
  const cls = qualifier ? "arch-statement arch-statement-qualified" : "arch-statement";
  return `<li class="${cls}">${escapeHtml(statementText(statement))} ${evidenceNote(statement.evidence)}</li>`;
}

export function statementList(statements: InferredStatement[], emptyText = "No evidence found for this view."): string {
  if (statements.length === 0) return `<p class="arch-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="arch-statement-list">${statements.map(statementListItem).join("")}</ul>`;
}

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

const VIEW_W = 1120;
const VIEW_H = 420;
const NODE_H = 64;

export function renderBoxDiagram(nodes: DiagramNode[], edges: DiagramEdge[], ariaLabel: string): string {
  if (nodes.length === 0) return `<p class="arch-empty">No entities to diagram for this view.</p>`;

  const rows = nodes.length > 6 ? 3 : nodes.length > 3 ? 2 : 1;
  const cols = Math.ceil(nodes.length / rows);
  const cellW = VIEW_W / cols;
  const cellH = VIEW_H / rows;
  const boxW = Math.min(cellW - 40, 240);

  const laidOut = nodes.map((n, i) => ({
    ...n,
    x: cellW * (i % cols) + cellW / 2,
    y: cellH * Math.floor(i / cols) + cellH / 2,
    w: boxW,
  }));
  const byId = new Map(laidOut.map((n) => [n.id, n]));

  const edgeSvg = edges
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

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" class="architecture-svg" role="img" aria-label="${escapeHtml(ariaLabel)}">
      <defs>
        <marker id="rvs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      ${edgeSvg}
      ${nodeSvg}
    </svg>`;
}

// Applies scene.focus_ids (when non-empty) to narrow a diagram/list view to
// a named subset of entities — used by profiles that split a large model
// across multiple scenes of the same kind.
export function applyFocus<T extends { id: string }>(items: T[], focusIds: string[]): T[] {
  if (focusIds.length === 0) return items;
  const allow = new Set(focusIds);
  return items.filter((item) => allow.has(item.id));
}
