import type { Capability, CapabilityDomain, CapabilityModel } from "@rvs/capability-intelligence";
import type { CapabilityIntelligenceOverviewScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// This scene renders the Milestone-4 evidence-gated CapabilityModel
// (@rvs/capability-intelligence) — a fundamentally DIFFERENT artifact from
// architecture-intelligence's "capability-map" kind, which renders
// ArchitectureIntelligence.capabilityDomains (a coarser Milestone-3 rollup
// with no per-capability evidence-and-maturity gate, no CapabilityStatus,
// no CapabilityInclusion, no CapabilityConfidence). The two must never be
// conflated: this file/scene type intentionally lives in its own directory
// and under its own scene "type", not as another "kind" of the existing
// architecture-intelligence scene.
//
// Mirrors exportCapabilitiesMarkdown()'s conservative default
// (includeRoadmap: false, includeExcluded: false): this scene only ever
// renders included/qualified capabilities (grouped by domain, exactly as
// CapabilityModel.domains already restricts itself to) plus known gaps —
// it never renders roadmap_only or excluded candidates.

function pluralize(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// Every rendered capability card/list item stamps data-capability-status /
// data-capability-inclusion / data-capability-confidence — the closed-enum
// values themselves never need HTML-escaping, but the attribute-building
// stays centralized here so every call site is consistent.
function capabilityDataAttrs(capability: Pick<Capability, "status" | "inclusion" | "confidence">): string {
  return `data-capability-status="${capability.status}" data-capability-inclusion="${capability.inclusion}" data-capability-confidence="${capability.confidence}"`;
}

function capabilityCard(capability: Capability): string {
  const qualifiedBadge = capability.inclusion === "include_with_qualification" ? `<span class="cap-badge cap-badge-qualified">Qualified</span>` : "";
  const qualifiers = capability.readiness.qualifiers.length > 0 ? `<p class="cap-card-meta">${escapeHtml(capability.readiness.qualifiers.join("; "))}</p>` : "";
  return `
    <div class="cap-card" ${capabilityDataAttrs(capability)}>
      <h3 class="cap-card-title">${escapeHtml(capability.displayName)}</h3>
      <p class="cap-card-badges">
        <span class="cap-badge cap-badge-status">${escapeHtml(statusLabel(capability.status))}</span>
        <span class="cap-badge cap-badge-confidence">${escapeHtml(capability.confidence)}</span>
        ${qualifiedBadge}
      </p>
      <p class="cap-card-purpose">${escapeHtml(capability.purpose)}</p>
      ${qualifiers}
    </div>`;
}

function domainSection(domain: CapabilityDomain): string {
  if (domain.capabilities.length === 0) return "";
  return `
    <section class="cap-domain">
      <h2 class="arch-subheading">${escapeHtml(domain.displayName)}</h2>
      <div class="arch-card-grid cap-card-grid">${domain.capabilities.map(capabilityCard).join("")}</div>
    </section>`;
}

function gapsSection(model: CapabilityModel): string {
  if (model.gapCapabilities.length === 0) return "";
  const items = model.gapCapabilities
    .map(
      (gap) =>
        `<li class="arch-statement" ${capabilityDataAttrs(gap)}>${escapeHtml(gap.displayName)} &mdash; ${escapeHtml(gap.gapStatement?.value ?? gap.purpose)}</li>`,
    )
    .join("");
  return `
    <section class="cap-gaps">
      <h2 class="arch-subheading">Known gaps</h2>
      <ul class="arch-statement-list">${items}</ul>
    </section>`;
}

export function renderCapabilityIntelligenceOverviewScene(scene: CapabilityIntelligenceOverviewScene, model: CapabilityModel | undefined): string {
  if (!model) {
    throw new Error(`Capability-intelligence-overview scene "${scene.id}" references unresolved model_id "${scene.model_id}"`);
  }

  const { includedCount, qualifiedCount, gapCount, totalCandidates } = model.evidenceSummary;
  const summaryLine = `${includedCount} ${pluralize(includedCount, "capability", "capabilities")} included, ${qualifiedCount} qualified, ${gapCount} known ${pluralize(gapCount, "gap", "gaps")} (of ${totalCandidates} ${pluralize(totalCandidates, "candidate", "candidates")} evaluated).`;

  const domainSections = model.domains.map(domainSection).join("");
  const hasIncludedContent = model.domains.some((d) => d.capabilities.length > 0);

  return `
    <div class="scene-arch-text cap-overview">
      <h1>${escapeHtml(scene.headline)}</h1>
      <p class="cap-summary-line">${escapeHtml(summaryLine)}</p>
      ${hasIncludedContent ? domainSections : `<p class="arch-empty">No capability has yet passed the evidence-and-maturity gate for inclusion in this view.</p>`}
      ${gapsSection(model)}
      <p class="arch-card-meta cap-limitations-note">This view only shows capabilities that passed the evidence-and-maturity gate. Candidates lacking sufficient implementation, execution, or verification evidence, and roadmap-only items, are intentionally omitted here by design.</p>
    </div>`;
}
