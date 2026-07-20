import type { GovernancePlan, GovernanceSceneContent, GovernanceSceneKind } from "@rvs/governance-intelligence";
import type { GovernanceScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// Renders the Architecture Governance and Continuous Intelligence
// presentation profile (Milestone 7). Every scene here is composed only
// from GovernanceSceneContent.data content that governance-intelligence's
// evidence-gated scene builders (governance-plan.ts) already produced — this
// file makes no independent claim of its own, mirrors, and reuses the
// shared .arch-empty/.arch-statement-list/.arch-severity styling of,
// portfolio/render.ts's identical discipline.
//
// Unlike PortfolioScenePlan (whose per-scene-type fields are individually
// typed), GovernanceSceneContent.data is intentionally
// Record<string, unknown> (see contracts.ts) -- typed narrowing happens
// here, reading only the field names governance-plan.ts's builder functions
// are documented to populate for each GovernanceSceneKind.

function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

function num(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  return typeof value === "number" ? value : 0;
}

function strArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function countRecord(data: Record<string, unknown>, key: string): Record<string, number> {
  const value = data[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return Object.fromEntries(entries);
}

function labelize(key: string): string {
  return key.replace(/_/g, " ");
}

function countList(counts: Record<string, number>, emptyText: string): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return `<p class="arch-empty">${escapeHtml(emptyText)}</p>`;
  const rows = entries
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => `<li class="governance-count-row"><span class="governance-count-label">${escapeHtml(labelize(key))}</span><span class="governance-count-value">${count}</span></li>`)
    .join("");
  return `<ul class="governance-count-list">${rows}</ul>`;
}

function idList(ids: string[], emptyText: string): string {
  if (ids.length === 0) return `<p class="arch-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="arch-statement-list">${ids.map((id) => `<li class="arch-statement governance-id">${escapeHtml(id)}</li>`).join("")}</ul>`;
}

function compatBadge(compatibility: string): string {
  if (!compatibility) return "";
  return `<span class="governance-compat governance-compat-${escapeHtml(compatibility)}">${escapeHtml(labelize(compatibility))}</span>`;
}

function severityBadges(bySeverity: Record<string, number>): string {
  const entries = Object.entries(bySeverity).filter(([, count]) => count > 0);
  if (entries.length === 0) return `<p class="arch-empty">No findings to report.</p>`;
  const badges = entries
    .map(([severity, count]) => `<span class="arch-severity arch-severity-${escapeHtml(severity)}">${escapeHtml(labelize(severity))}: ${count}</span>`)
    .join("");
  return `<div class="governance-severity-badges">${badges}</div>`;
}

function renderGovernanceHero(scene: GovernanceSceneContent): string {
  const summary = str(scene.data, "summary");
  const compatibility = str(scene.data, "compatibility");
  const findingsTotal = num(scene.data, "findings_total");
  return `
    <div class="governance-hero">
      <h1 class="display">${escapeHtml(scene.title)}</h1>
      ${summary ? `<p class="governance-hero-summary">${escapeHtml(summary)}</p>` : ""}
      <div class="governance-hero-meta">
        ${compatBadge(compatibility)}
        <span>${findingsTotal} finding${findingsTotal === 1 ? "" : "s"}</span>
      </div>
    </div>`;
}

function renderSnapshotComparison(scene: GovernanceSceneContent): string {
  const source = str(scene.data, "source_snapshot_id");
  const target = str(scene.data, "target_snapshot_id");
  const compatibility = str(scene.data, "compatibility");
  const repositoryId = str(scene.data, "repository_id");
  return `
    <div class="governance-snapshot-comparison">
      <h1>${escapeHtml(scene.title)}</h1>
      <ul class="governance-count-list">
        <li class="governance-count-row"><span class="governance-count-label">Source snapshot</span><span class="governance-count-value">${escapeHtml(source)}</span></li>
        <li class="governance-count-row"><span class="governance-count-label">Target snapshot</span><span class="governance-count-value">${escapeHtml(target)}</span></li>
        ${repositoryId ? `<li class="governance-count-row"><span class="governance-count-label">Repository</span><span class="governance-count-value">${escapeHtml(repositoryId)}</span></li>` : ""}
      </ul>
      ${compatBadge(compatibility)}
    </div>`;
}

function renderChangeSummary(scene: GovernanceSceneContent): string {
  const byDomain = countRecord(scene.data, "by_domain");
  const total = num(scene.data, "total");
  return `
    <div class="governance-change-summary">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} change${total === 1 ? "" : "s"} across domains.</p>
      ${countList(byDomain, "No changes were detected.")}
    </div>`;
}

/** Shared body for the five "total / by_type / change_ids" scene kinds (architecture-change-map, capability-regression, product-change, portfolio-change, evidence-regression). */
function renderChangeListScene(scene: GovernanceSceneContent, emptyByType: string, emptyIds: string): string {
  const total = num(scene.data, "total");
  const byType = countRecord(scene.data, "by_type");
  const changeIds = strArray(scene.data, "change_ids");
  return `
    <div class="governance-change-list">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} change${total === 1 ? "" : "s"}.</p>
      ${countList(byType, emptyByType)}
      ${idList(changeIds, emptyIds)}
    </div>`;
}

/** capability-regression carries no by_type breakdown (see governance-plan.ts), so it renders total + change_ids only. */
function renderIdOnlyScene(scene: GovernanceSceneContent, idsKey: string, emptyIds: string): string {
  const total = num(scene.data, "total");
  const ids = strArray(scene.data, idsKey);
  return `
    <div class="governance-id-scene">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} item${total === 1 ? "" : "s"}.</p>
      ${idList(ids, emptyIds)}
    </div>`;
}

function renderBlastRadius(scene: GovernanceSceneContent): string {
  const total = num(scene.data, "total");
  const byLevel = countRecord(scene.data, "by_level");
  return `
    <div class="governance-blast-radius">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} assessed change${total === 1 ? "" : "s"}.</p>
      ${countList(byLevel, "No blast-radius entries were assessed.")}
    </div>`;
}

function renderPolicyFindings(scene: GovernanceSceneContent): string {
  const total = num(scene.data, "total");
  const bySeverity = countRecord(scene.data, "by_severity");
  const byResult = countRecord(scene.data, "by_result");
  return `
    <div class="governance-policy-findings">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} finding${total === 1 ? "" : "s"}.</p>
      ${severityBadges(bySeverity)}
      ${countList(byResult, "No policy evaluations were recorded.")}
    </div>`;
}

function renderGovernanceValidation(scene: GovernanceSceneContent): string {
  const compatibility = str(scene.data, "compatibility");
  const unverifiableCount = num(scene.data, "unverifiable_finding_count");
  const unverifiableIds = strArray(scene.data, "unverifiable_finding_ids");
  return `
    <div class="governance-validation">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        ${compatBadge(compatibility)}
        <span>${unverifiableCount} unverifiable finding${unverifiableCount === 1 ? "" : "s"}</span>
      </div>
      ${idList(unverifiableIds, "No unverifiable findings.")}
    </div>`;
}

export function renderGovernanceScene(scene: GovernanceScene, plan: GovernancePlan | undefined): string {
  if (!plan) {
    throw new Error(`Governance scene "${scene.id}" references unresolved plan_id "${scene.plan_id}"`);
  }
  const sceneContent = plan.scenes.find((s) => s.scene_id === scene.scene_id);
  if (!sceneContent) {
    throw new Error(`Governance scene "${scene.id}" references unresolved scene_id "${scene.scene_id}" within plan "${scene.plan_id}"`);
  }

  const kind: GovernanceSceneKind = sceneContent.kind;
  const body = (() => {
    switch (kind) {
      case "governance-hero":
        return renderGovernanceHero(sceneContent);
      case "snapshot-comparison":
        return renderSnapshotComparison(sceneContent);
      case "change-summary":
        return renderChangeSummary(sceneContent);
      case "architecture-change-map":
        return renderChangeListScene(sceneContent, "No architecture changes were detected.", "No architecture change ids are available.");
      case "capability-regression":
        return renderIdOnlyScene(sceneContent, "change_ids", "No capability regressions were detected.");
      case "product-change":
        return renderChangeListScene(sceneContent, "No product changes were detected.", "No product change ids are available.");
      case "portfolio-change":
        return renderChangeListScene(sceneContent, "No portfolio changes were detected.", "No portfolio change ids are available.");
      case "evidence-regression":
        return renderChangeListScene(sceneContent, "No evidence regressions were detected.", "No evidence change ids are available.");
      case "blast-radius":
        return renderBlastRadius(sceneContent);
      case "policy-findings":
        return renderPolicyFindings(sceneContent);
      case "exceptions":
        return renderIdOnlyScene(sceneContent, "finding_ids", "No active governance exceptions.");
      case "decision-required":
        return renderIdOnlyScene(sceneContent, "finding_ids", "No decisions are required.");
      case "governance-validation":
        return renderGovernanceValidation(sceneContent);
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unhandled governance scene kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return `<div class="scene-governance" data-scene-kind="${escapeHtml(kind)}">${body}</div>`;
}
