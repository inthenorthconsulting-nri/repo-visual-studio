import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";
import { applyFocus, evidenceNote, renderBoxDiagram, statementText, type DiagramEdge, type DiagramNode } from "./helpers.js";

// system-context: the system itself plus every actor and external system it
// touches, connected by the flows evidenced between them — the "system in
// its environment" view (Level 2).
export function renderSystemContext(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const nodes: DiagramNode[] = [
    { id: artifact.identity.id, label: artifact.identity.name.displayLabel },
    ...artifact.actors.map((a) => ({ id: a.id, label: a.label.displayLabel })),
    ...artifact.externalSystems.map((e) => ({ id: e.id, label: e.label.displayLabel })),
  ];
  const focused = applyFocus(nodes, scene.focus_ids);
  const focusedIds = new Set(focused.map((n) => n.id));
  const edges: DiagramEdge[] = artifact.flows
    .filter((f) => focusedIds.has(f.fromId) && focusedIds.has(f.toId))
    .map((f) => ({ from: f.fromId, to: f.toId, label: f.label.shortLabel }));

  return `
    <div class="scene-arch-diagram">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${renderBoxDiagram(focused, edges, `System context: ${focused.map((n) => n.label).join(", ")}`)}
    </div>
  `;
}

// logical-architecture: the system's own components and the internal flows
// between them — deliberately excludes actors/external systems, which
// belong to system-context. Also excludes components whose only evidence is
// "there happened to be a top-level source directory with this name" —
// those are Level 3/4 engineering detail (see repository-map) and read as
// a file listing, not an architecture, at Level 1/2.
export function renderLogicalArchitecture(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const architecturalComponents = artifact.components.filter((c) => c.origin !== "repository-directory");
  const source = architecturalComponents.length > 0 ? architecturalComponents : artifact.components;
  const nodes: DiagramNode[] = applyFocus(
    source.map((c) => ({ id: c.id, label: c.label.displayLabel })),
    scene.focus_ids,
  );
  const focusedIds = new Set(nodes.map((n) => n.id));
  const edges: DiagramEdge[] = artifact.flows
    .filter((f) => focusedIds.has(f.fromId) && focusedIds.has(f.toId))
    .map((f) => ({ from: f.fromId, to: f.toId, label: f.label.shortLabel }));

  return `
    <div class="scene-arch-diagram">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${renderBoxDiagram(nodes, edges, `Logical architecture: ${nodes.map((n) => n.label).join(", ")}`)}
    </div>
  `;
}

// architecture-flow: every evidenced flow across the whole model, rendered
// as a diagram over the union of its endpoints.
export function renderArchitectureFlow(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const flows = applyFocus(artifact.flows, scene.focus_ids);
  const allEntities = new Map<string, string>();
  for (const c of artifact.components) allEntities.set(c.id, c.label.displayLabel);
  for (const a of artifact.actors) allEntities.set(a.id, a.label.displayLabel);
  for (const e of artifact.externalSystems) allEntities.set(e.id, e.label.displayLabel);
  allEntities.set(artifact.identity.id, artifact.identity.name.displayLabel);

  const endpointIds = new Set<string>();
  for (const f of flows) {
    endpointIds.add(f.fromId);
    endpointIds.add(f.toId);
  }
  const nodes: DiagramNode[] = [...endpointIds].map((id) => ({ id, label: allEntities.get(id) ?? id }));
  const edges: DiagramEdge[] = flows.map((f) => ({ from: f.fromId, to: f.toId, label: f.label.shortLabel }));

  const evidenceList = flows
    .map((f) => `<li class="arch-statement">${escapeHtml(f.label.displayLabel)} (${f.kind}) — ${escapeHtml(statementText(f.description))} ${evidenceNote(f.evidence)}</li>`)
    .join("");

  return `
    <div class="scene-arch-diagram">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${renderBoxDiagram(nodes, edges, `Architecture flows: ${flows.map((f) => f.label.displayLabel).join(", ")}`)}
      ${evidenceList ? `<ul class="arch-statement-list arch-flow-list">${evidenceList}</ul>` : ""}
    </div>
  `;
}

// boundary-map: boundaries are containment relationships, better read as
// grouped cards than as an arrow diagram.
export function renderBoundaryMap(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const boundaries = applyFocus(artifact.boundaries, scene.focus_ids);
  if (boundaries.length === 0) {
    return `<div class="scene-arch-text"><h1>${escapeHtml(scene.headline)}</h1><p class="arch-empty">No deployment or trust boundaries were evidenced.</p></div>`;
  }
  const componentLabelById = new Map(artifact.components.map((c) => [c.id, c.label.displayLabel]));
  const cards = boundaries
    .map((b) => {
      const members = b.containedComponentIds.map((id) => componentLabelById.get(id) ?? id).join(", ") || "No components attributed";
      return `
        <div class="arch-card">
          <h2 class="arch-card-title">${escapeHtml(b.label.displayLabel)} <span class="arch-card-kind">${escapeHtml(b.kind)}</span></h2>
          <p>${escapeHtml(statementText(b.description))} ${evidenceNote(b.evidence)}</p>
          <p class="arch-card-meta">${escapeHtml(members)}</p>
        </div>`;
    })
    .join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-card-grid">${cards}</div>
    </div>
  `;
}
