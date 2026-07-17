import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";
import { applyFocus, statementText } from "./helpers.js";

export function renderCapabilityMap(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const domains = applyFocus(artifact.capabilityDomains, scene.focus_ids);
  if (domains.length === 0) {
    return `<div class="scene-arch-text"><h1>${escapeHtml(scene.headline)}</h1><p class="arch-empty">No capability domains were synthesized.</p></div>`;
  }
  const cards = domains
    .map(
      (d) => `
        <div class="arch-card">
          <h2 class="arch-card-title">${escapeHtml(d.label.displayLabel)}</h2>
          <p>${escapeHtml(statementText(d.summary))}</p>
          <p class="arch-card-meta">${d.componentIds.length} component(s) &middot; ${d.workflowFamilyIds.length} workflow family(ies)</p>
        </div>`,
    )
    .join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-card-grid">${cards}</div>
    </div>
  `;
}

export function renderWorkflowFamilyMap(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const families = applyFocus(artifact.workflowFamilies, scene.focus_ids);
  if (families.length === 0) {
    return `<div class="scene-arch-text"><h1>${escapeHtml(scene.headline)}</h1><p class="arch-empty">No workflow automation was detected in this repository.</p></div>`;
  }
  const cards = families
    .map(
      (f) => `
        <div class="arch-card">
          <h2 class="arch-card-title">${escapeHtml(f.label.displayLabel)}</h2>
          <p>${escapeHtml(statementText(f.description))}</p>
          <p class="arch-card-meta">${f.workflowGraphIds.length} workflow(s)</p>
        </div>`,
    )
    .join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-card-grid">${cards}</div>
    </div>
  `;
}

export function renderRepositoryMap(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const components = applyFocus(artifact.components, scene.focus_ids);
  if (components.length === 0) {
    return `<div class="scene-arch-text"><h1>${escapeHtml(scene.headline)}</h1><p class="arch-empty">No logical components were synthesized.</p></div>`;
  }
  const byKind = new Map<string, typeof components>();
  for (const c of components) {
    const bucket = byKind.get(c.kind) ?? [];
    bucket.push(c);
    byKind.set(c.kind, bucket);
  }
  const sections = [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, items]) => {
      const list = items.map((c) => `<li class="arch-statement">${escapeHtml(c.label.displayLabel)} <span class="arch-card-meta">(${escapeHtml(c.sourcePaths[0] ?? "")})</span></li>`).join("");
      return `<section class="arch-operating-group"><h2 class="arch-subheading">${escapeHtml(kind)}</h2><ul class="arch-statement-list">${list}</ul></section>`;
    })
    .join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-operating-grid">${sections}</div>
    </div>
  `;
}

export function renderEvidenceConfidence(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const { confirmed, derived, suggested, unresolved, total } = artifact.metadata.confidence;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  const segments: Array<{ cls: string; label: string; count: number }> = [
    { cls: "confirmed", label: "Confirmed", count: confirmed },
    { cls: "derived", label: "Derived", count: derived },
    { cls: "suggested", label: "Suggested", count: suggested },
    { cls: "unresolved", label: "Unresolved", count: unresolved },
  ];
  const bar = segments
    .filter((s) => s.count > 0)
    .map((s) => `<div class="arch-confidence-segment arch-confidence-${s.cls}" style="flex: ${s.count}" title="${escapeHtml(s.label)}: ${s.count} (${pct(s.count)}%)"></div>`)
    .join("");
  const legend = segments
    .map((s) => `<li><span class="arch-confidence-swatch arch-confidence-${s.cls}"></span>${escapeHtml(s.label)} — ${s.count} (${pct(s.count)}%)</li>`)
    .join("");

  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-confidence-bar" role="img" aria-label="Confidence distribution across ${total} synthesized statements">${bar}</div>
      <ul class="arch-confidence-legend">${legend}</ul>
      <p class="arch-card-meta">${total} statement(s) synthesized from repository, workflow, and Terraform evidence as of ${escapeHtml(artifact.metadata.generated_at)}.</p>
    </div>
  `;
}
