import type { DecisionPlan, DecisionSceneContent, DecisionSceneKind } from "@rvs/decision-intelligence";
import type { DecisionScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// Renders the Architecture Decision Intelligence presentation profile
// (Milestone 8). Every scene here is composed only from
// DecisionSceneContent.body content that decision-intelligence's
// evidence-gated scene builders (decision-plan.ts) already produced — this
// file makes no independent claim of its own, mirroring
// governance/render.ts's identical discipline.
//
// Unlike GovernanceSceneContent.data (typed Record<string, unknown>),
// contracts.ts declares DecisionSceneContent.body as `unknown` — narrowed to
// Record<string, unknown> here via asRecord(), then read only by the field
// names decision-plan.ts's builder functions are documented to populate for
// each DecisionSceneKind.

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

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

function renderDecisionHero(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const summary = str(data, "summary");
  const decisionCount = num(data, "decision_count");
  const compatibility = str(data, "compatibility");
  return `
    <div class="decision-hero">
      <h1 class="display">${escapeHtml(scene.title)}</h1>
      ${summary ? `<p class="governance-hero-summary">${escapeHtml(summary)}</p>` : ""}
      <div class="governance-hero-meta">
        ${compatBadge(compatibility)}
        <span>${decisionCount} decision${decisionCount === 1 ? "" : "s"}</span>
      </div>
    </div>`;
}

/** Shared body for the "total / by_<key>" breakdown scenes (decision-landscape's by_status, decision-implementation's by_status). */
function renderCountBreakdownScene(scene: DecisionSceneContent, key: string, emptyText: string): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const breakdown = countRecord(data, key);
  return `
    <div class="decision-count-breakdown">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} decision${total === 1 ? "" : "s"}.</p>
      ${countList(breakdown, emptyText)}
    </div>`;
}

function renderDecisionStatus(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const value = data["rows"];
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const body =
    rows.length === 0
      ? `<p class="arch-empty">No decisions were found.</p>`
      : `<ul class="arch-statement-list">${rows
          .map(
            (row) =>
              `<li class="decision-status-row"><span class="decision-status-id">${escapeHtml(str(row, "id"))}</span><span class="decision-status-field">${escapeHtml(str(row, "decision_status"))}</span><span class="decision-status-field">${escapeHtml(str(row, "implementation_status"))}</span><span class="decision-status-field">${escapeHtml(str(row, "governance_status"))}</span></li>`,
          )
          .join("")}</ul>`;
  return `
    <div class="decision-status">
      <h1>${escapeHtml(scene.title)}</h1>
      ${body}
    </div>`;
}

/** Shared body for the four "total / by_resolution / decision_ids" domain-map scenes (decision-architecture-map/decision-capability-map/decision-product-map/decision-portfolio-map). */
function renderDomainMapScene(scene: DecisionSceneContent, emptyResolution: string, emptyIds: string): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byResolution = countRecord(data, "by_resolution");
  const decisionIds = strArray(data, "decision_ids");
  return `
    <div class="decision-domain-map">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} link${total === 1 ? "" : "s"}.</p>
      ${countList(byResolution, emptyResolution)}
      ${idList(decisionIds, emptyIds)}
    </div>`;
}

function renderDecisionAssumptions(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byState = countRecord(data, "by_state");
  const contradictedIds = strArray(data, "contradicted_ids");
  return `
    <div class="decision-assumptions">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} assumption${total === 1 ? "" : "s"}.</p>
      ${countList(byState, "No assumptions were recorded.")}
      ${idList(contradictedIds, "No contradicted assumptions.")}
    </div>`;
}

function renderDecisionSupersession(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const issueTotal = num(data, "issue_total");
  const byIssueKind = countRecord(data, "by_issue_kind");
  const chainTotal = num(data, "chain_total");
  const invalidChainCount = num(data, "invalid_chain_count");
  return `
    <div class="decision-supersession">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        <span>${issueTotal} issue${issueTotal === 1 ? "" : "s"}</span>
        <span>${chainTotal} chain${chainTotal === 1 ? "" : "s"}</span>
        <span>${invalidChainCount} invalid chain${invalidChainCount === 1 ? "" : "s"}</span>
      </div>
      ${countList(byIssueKind, "No supersession issues were detected.")}
    </div>`;
}

function renderDecisionConflicts(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byKind = countRecord(data, "by_kind");
  const unresolvedCount = num(data, "unresolved_count");
  return `
    <div class="decision-conflicts">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} conflict${total === 1 ? "" : "s"}, ${unresolvedCount} unresolved.</p>
      ${countList(byKind, "No conflicts were detected.")}
    </div>`;
}

function renderDecisionCoverage(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const value = data["metrics"];
  const metrics = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const body =
    metrics.length === 0
      ? `<p class="arch-empty">No coverage metrics were recorded.</p>`
      : `<ul class="arch-statement-list">${metrics
          .map(
            (metric) =>
              `<li class="decision-coverage-row"><span class="decision-coverage-dimension">${escapeHtml(str(metric, "dimension"))}</span><span class="decision-coverage-value">${num(metric, "numerator")} / ${num(metric, "denominator")}</span></li>`,
          )
          .join("")}</ul>`;
  return `
    <div class="decision-coverage">
      <h1>${escapeHtml(scene.title)}</h1>
      ${body}
    </div>`;
}

function renderDecisionDrift(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const bySeverity = countRecord(data, "by_severity");
  const byCause = countRecord(data, "by_cause");
  return `
    <div class="decision-drift">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} drift entr${total === 1 ? "y" : "ies"}.</p>
      ${severityBadges(bySeverity)}
      ${countList(byCause, "No drift causes were recorded.")}
    </div>`;
}

function renderDecisionDebt(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byCategory = countRecord(data, "by_category");
  const openCount = num(data, "open_count");
  return `
    <div class="decision-debt">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} debt finding${total === 1 ? "" : "s"}, ${openCount} open.</p>
      ${countList(byCategory, "No decision debt was found.")}
    </div>`;
}

function renderDecisionGovernanceImpact(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const sections: [string, string][] = [
    ["Changes missing a decision", "changes_missing_decision"],
    ["Decisions with contradicted assumptions", "decisions_with_contradicted_assumptions"],
    ["Decisions active and superseded", "decisions_active_and_superseded"],
    ["Exceptions with an invalid decision reference", "exceptions_with_invalid_decision_ref"],
    ["Decisions with unresolved conflicts", "unresolved_conflict_decision_ids"],
    ["Decisions requiring review for drift", "decisions_requiring_review_for_drift"],
  ];
  const body = sections
    .map(([label, key]) => `<h2 class="decision-governance-impact-heading">${escapeHtml(label)}</h2>${idList(strArray(data, key), "None.")}`)
    .join("");
  return `
    <div class="decision-governance-impact">
      <h1>${escapeHtml(scene.title)}</h1>
      ${body}
    </div>`;
}

function renderDecisionReviewRequired(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const debtFindingIds = strArray(data, "debt_finding_ids");
  const driftIds = strArray(data, "drift_ids");
  return `
    <div class="decision-review-required">
      <h1>${escapeHtml(scene.title)}</h1>
      <h2 class="decision-governance-impact-heading">Debt findings needing review</h2>
      ${idList(debtFindingIds, "No debt findings need review.")}
      <h2 class="decision-governance-impact-heading">Drift entries needing review</h2>
      ${idList(driftIds, "No drift entries need review.")}
    </div>`;
}

function renderDecisionValidation(scene: DecisionSceneContent): string {
  const data = asRecord(scene.body);
  const compatibility = str(data, "compatibility");
  const sourceIssueCount = num(data, "source_issue_count");
  const unverifiableCount = num(data, "unverifiable_implementation_count");
  return `
    <div class="decision-validation">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        ${compatBadge(compatibility)}
        <span>${sourceIssueCount} source issue${sourceIssueCount === 1 ? "" : "s"}</span>
        <span>${unverifiableCount} unverifiable implementation state${unverifiableCount === 1 ? "" : "s"}</span>
      </div>
    </div>`;
}

export function renderDecisionScene(scene: DecisionScene, plan: DecisionPlan | undefined): string {
  if (!plan) {
    throw new Error(`Decision scene "${scene.id}" references unresolved plan_id "${scene.plan_id}"`);
  }
  const sceneContent = plan.scenes.find((s) => s.scene_id === scene.scene_id);
  if (!sceneContent) {
    throw new Error(`Decision scene "${scene.id}" references unresolved scene_id "${scene.scene_id}" within plan "${scene.plan_id}"`);
  }

  const kind: DecisionSceneKind = sceneContent.kind;
  const body = (() => {
    switch (kind) {
      case "decision-hero":
        return renderDecisionHero(sceneContent);
      case "decision-landscape":
        return renderCountBreakdownScene(sceneContent, "by_status", "No decisions were found.");
      case "decision-status":
        return renderDecisionStatus(sceneContent);
      case "decision-architecture-map":
        return renderDomainMapScene(sceneContent, "No architecture links were resolved.", "No decisions link to architecture.");
      case "decision-capability-map":
        return renderDomainMapScene(sceneContent, "No capability links were resolved.", "No decisions link to capabilities.");
      case "decision-product-map":
        return renderDomainMapScene(sceneContent, "No product links were resolved.", "No decisions link to products.");
      case "decision-portfolio-map":
        return renderDomainMapScene(sceneContent, "No portfolio links were resolved.", "No decisions link to the portfolio.");
      case "decision-implementation":
        return renderCountBreakdownScene(sceneContent, "by_status", "No implementation states were recorded.");
      case "decision-assumptions":
        return renderDecisionAssumptions(sceneContent);
      case "decision-supersession":
        return renderDecisionSupersession(sceneContent);
      case "decision-conflicts":
        return renderDecisionConflicts(sceneContent);
      case "decision-coverage":
        return renderDecisionCoverage(sceneContent);
      case "decision-drift":
        return renderDecisionDrift(sceneContent);
      case "decision-debt":
        return renderDecisionDebt(sceneContent);
      case "decision-governance-impact":
        return renderDecisionGovernanceImpact(sceneContent);
      case "decision-review-required":
        return renderDecisionReviewRequired(sceneContent);
      case "decision-validation":
        return renderDecisionValidation(sceneContent);
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unhandled decision scene kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return `<div class="scene-decision" data-scene-kind="${escapeHtml(kind)}">${body}</div>`;
}
