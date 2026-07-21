import type { KnowledgeGraphPlan, KnowledgeGraphSceneContent, KnowledgeGraphSceneKind } from "@rvs/knowledge-graph";
import type { KnowledgeGraphScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// Renders the Architecture Knowledge Graph presentation profile
// (Milestone 9). Every scene here is composed only from
// KnowledgeGraphSceneContent.body content that knowledge-graph's
// evidence-gated scene builders (graph-plan.ts) already produced — this
// file makes no independent claim of its own, mirroring
// decision/render.ts's identical discipline.
//
// contracts.ts declares KnowledgeGraphSceneContent.body as `unknown` —
// narrowed to Record<string, unknown> here via asRecord(), then read only by
// the field names graph-plan.ts's builder functions are documented to
// populate for each KnowledgeGraphSceneKind.

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

function renderGraphOverview(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const summary = str(data, "summary");
  const nodeCount = num(data, "node_count");
  const edgeCount = num(data, "edge_count");
  const repositoryId = str(data, "repository_id");
  return `
    <div class="graph-hero">
      <h1 class="display">${escapeHtml(scene.title)}</h1>
      ${summary ? `<p class="governance-hero-summary">${escapeHtml(summary)}</p>` : ""}
      <div class="governance-hero-meta">
        ${repositoryId ? `<span>${escapeHtml(repositoryId)}</span>` : ""}
        <span>${nodeCount} node${nodeCount === 1 ? "" : "s"}</span>
        <span>${edgeCount} edge${edgeCount === 1 ? "" : "s"}</span>
      </div>
    </div>`;
}

function renderGraphLayersConnected(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const value = data["upstream_artifacts"];
  const artifacts = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const body =
    artifacts.length === 0
      ? `<p class="arch-empty">No upstream intelligence artifacts were connected.</p>`
      : `<ul class="arch-statement-list">${artifacts
          .map(
            (artifact) =>
              `<li class="decision-status-row"><span class="decision-status-id">${escapeHtml(str(artifact, "source_artifact"))}</span><span class="decision-status-field">${escapeHtml(str(artifact, "provenance"))}</span></li>`,
          )
          .join("")}</ul>`;
  return `
    <div class="graph-layers-connected">
      <h1>${escapeHtml(scene.title)}</h1>
      ${body}
    </div>`;
}

/** Shared body for the "total / by_<key>" breakdown scenes (graph-entity-landscape's by_type+by_confidence, graph-relationship-landscape's by_type+by_resolution). */
function renderCountBreakdownScene(scene: KnowledgeGraphSceneContent, total: number, breakdowns: [string, Record<string, number>, string][], unit: string): string {
  return `
    <div class="graph-count-breakdown">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} ${unit}${total === 1 ? "" : "s"}.</p>
      ${breakdowns.map(([label, counts, emptyText]) => `<h2 class="decision-governance-impact-heading">${escapeHtml(label)}</h2>${countList(counts, emptyText)}`).join("")}
    </div>`;
}

function renderGraphEntityLandscape(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  return renderCountBreakdownScene(
    scene,
    total,
    [
      ["By entity type", countRecord(data, "by_type"), "No entity types were recorded."],
      ["By confidence", countRecord(data, "by_confidence"), "No confidence levels were recorded."],
    ],
    "entity",
  );
}

function renderGraphRelationshipLandscape(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  return renderCountBreakdownScene(
    scene,
    total,
    [
      ["By relationship type", countRecord(data, "by_type"), "No relationship types were recorded."],
      ["By resolution", countRecord(data, "by_resolution"), "No resolution states were recorded."],
    ],
    "relationship",
  );
}

function renderGraphDependencyPaths(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const pathCount = num(data, "path_count");
  const pathIds = strArray(data, "path_ids");
  return `
    <div class="graph-dependency-paths">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${pathCount} path${pathCount === 1 ? "" : "s"}.</p>
      ${idList(pathIds, "No dependency paths were recorded.")}
    </div>`;
}

function renderGraphComponentImpact(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const hits = num(data, "affected_component_hits");
  const byDepth = countRecord(data, "by_depth");
  return `
    <div class="graph-component-impact">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${hits} affected component hit${hits === 1 ? "" : "s"}.</p>
      ${countList(byDepth, "No component impact was recorded.")}
    </div>`;
}

function renderGraphCapabilityImpact(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const ids = strArray(data, "capability_node_ids");
  return `
    <div class="graph-capability-impact">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} capabilit${total === 1 ? "y" : "ies"} affected.</p>
      ${idList(ids, "No capabilities were affected.")}
    </div>`;
}

function renderGraphProductPortfolioReach(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const totalProducts = num(data, "total_products");
  const productIds = strArray(data, "product_node_ids");
  const portfolioWide = num(data, "portfolio_wide_query_count");
  return `
    <div class="graph-product-portfolio-reach">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        <span>${totalProducts} product${totalProducts === 1 ? "" : "s"}</span>
        <span>${portfolioWide} portfolio-wide quer${portfolioWide === 1 ? "y" : "ies"}</span>
      </div>
      ${idList(productIds, "No products were affected.")}
    </div>`;
}

function renderGraphRootCauses(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byClassification = countRecord(data, "by_classification");
  const groupIds = strArray(data, "group_ids");
  return `
    <div class="graph-root-causes">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} root-cause group${total === 1 ? "" : "s"}.</p>
      ${countList(byClassification, "No root-cause groups were formed.")}
      ${idList(groupIds, "No root-cause groups were formed.")}
    </div>`;
}

function renderGraphDecisionDependencies(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byState = countRecord(data, "by_state");
  return `
    <div class="graph-decision-dependencies">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} decision dependenc${total === 1 ? "y" : "ies"}.</p>
      ${countList(byState, "No decision dependencies were recorded.")}
    </div>`;
}

function renderGraphInvalidatedAssumptions(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const total = num(data, "total");
  const byState = countRecord(data, "by_state");
  const decisionIds = strArray(data, "decision_node_ids");
  return `
    <div class="graph-invalidated-assumptions">
      <h1>${escapeHtml(scene.title)}</h1>
      <p>${total} invalidated assumption${total === 1 ? "" : "s"}.</p>
      ${countList(byState, "No assumptions were invalidated.")}
      ${idList(decisionIds, "No decisions were affected.")}
    </div>`;
}

function renderGraphOrphansUnresolved(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const unresolvedCount = num(data, "unresolved_reference_count");
  const orphanCount = num(data, "orphan_count");
  const orphanIds = strArray(data, "orphan_node_ids");
  return `
    <div class="graph-orphans-unresolved">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        <span>${unresolvedCount} unresolved reference${unresolvedCount === 1 ? "" : "s"}</span>
        <span>${orphanCount} orphan${orphanCount === 1 ? "" : "s"}</span>
      </div>
      ${idList(orphanIds, "No orphan nodes were found.")}
    </div>`;
}

const CHANGE_SET_SECTIONS: [string, string][] = [
  ["Nodes added", "nodes_added"],
  ["Nodes removed", "nodes_removed"],
  ["Edges added", "edges_added"],
  ["Edges removed", "edges_removed"],
  ["Entity types changed", "entity_types_changed"],
  ["Relationships changed", "relationships_changed"],
  ["Dependency paths changed", "dependency_paths_changed"],
  ["Impact radius increased", "impact_radius_increased"],
  ["Impact radius decreased", "impact_radius_decreased"],
  ["New orphans", "new_orphans"],
  ["New cycles", "new_cycles"],
  ["Root causes introduced", "root_causes_introduced"],
  ["Root causes resolved", "root_causes_resolved"],
  ["Decision dependencies changed", "decision_dependencies_changed"],
  ["Governance reach changed", "governance_reach_changed"],
];

function renderGraphChanges(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const sourceId = str(data, "source_snapshot_id");
  const targetId = str(data, "target_snapshot_id");
  const body = CHANGE_SET_SECTIONS.map(([label, key]) => `<h2 class="decision-governance-impact-heading">${escapeHtml(label)}</h2>${idList(strArray(data, key), "None.")}`).join("");
  return `
    <div class="graph-changes">
      <h1>${escapeHtml(scene.title)}</h1>
      ${sourceId || targetId ? `<div class="governance-hero-meta"><span>${escapeHtml(sourceId)}</span><span>&rarr;</span><span>${escapeHtml(targetId)}</span></div>` : ""}
      ${body}
    </div>`;
}

function renderGraphReviewRequired(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const decisionImpactIds = strArray(data, "decision_impact_ids");
  const rootCauseGroupIds = strArray(data, "unresolved_root_cause_group_ids");
  const unknownConsumerIds = strArray(data, "unknown_consumer_node_ids");
  return `
    <div class="graph-review-required">
      <h1>${escapeHtml(scene.title)}</h1>
      <h2 class="decision-governance-impact-heading">Decisions needing review</h2>
      ${idList(decisionImpactIds, "No decisions need review.")}
      <h2 class="decision-governance-impact-heading">Unresolved root-cause groups</h2>
      ${idList(rootCauseGroupIds, "No unresolved root-cause groups.")}
      <h2 class="decision-governance-impact-heading">Unknown consumers</h2>
      ${idList(unknownConsumerIds, "No unknown consumers.")}
    </div>`;
}

function renderGraphValidation(scene: KnowledgeGraphSceneContent): string {
  const data = asRecord(scene.body);
  const findingTotal = num(data, "finding_total");
  const blockingCount = num(data, "blocking_count");
  const byCode = countRecord(data, "by_code");
  const value = data["non_complete_upstream_artifacts"];
  const nonComplete = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const nonCompleteBody =
    nonComplete.length === 0
      ? `<p class="arch-empty">Every upstream artifact was complete.</p>`
      : `<ul class="arch-statement-list">${nonComplete
          .map(
            (artifact) =>
              `<li class="decision-status-row"><span class="decision-status-id">${escapeHtml(str(artifact, "source_artifact"))}</span><span class="decision-status-field">${escapeHtml(str(artifact, "provenance"))}</span></li>`,
          )
          .join("")}</ul>`;
  return `
    <div class="graph-validation">
      <h1>${escapeHtml(scene.title)}</h1>
      <div class="governance-hero-meta">
        <span>${findingTotal} finding${findingTotal === 1 ? "" : "s"}</span>
        <span>${blockingCount} blocking</span>
      </div>
      ${countList(byCode, "No validation findings were recorded.")}
      <h2 class="decision-governance-impact-heading">Non-complete upstream artifacts</h2>
      ${nonCompleteBody}
    </div>`;
}

export function renderKnowledgeGraphScene(scene: KnowledgeGraphScene, plan: KnowledgeGraphPlan | undefined): string {
  if (!plan) {
    throw new Error(`Knowledge graph scene "${scene.id}" references unresolved plan_id "${scene.plan_id}"`);
  }
  const sceneContent = plan.scenes.find((s) => s.scene_id === scene.scene_id);
  if (!sceneContent) {
    throw new Error(`Knowledge graph scene "${scene.id}" references unresolved scene_id "${scene.scene_id}" within plan "${scene.plan_id}"`);
  }

  const kind: KnowledgeGraphSceneKind = sceneContent.kind;
  const body = (() => {
    switch (kind) {
      case "graph-overview":
        return renderGraphOverview(sceneContent);
      case "graph-layers-connected":
        return renderGraphLayersConnected(sceneContent);
      case "graph-entity-landscape":
        return renderGraphEntityLandscape(sceneContent);
      case "graph-relationship-landscape":
        return renderGraphRelationshipLandscape(sceneContent);
      case "graph-dependency-paths":
        return renderGraphDependencyPaths(sceneContent);
      case "graph-component-impact":
        return renderGraphComponentImpact(sceneContent);
      case "graph-capability-impact":
        return renderGraphCapabilityImpact(sceneContent);
      case "graph-product-portfolio-reach":
        return renderGraphProductPortfolioReach(sceneContent);
      case "graph-root-causes":
        return renderGraphRootCauses(sceneContent);
      case "graph-decision-dependencies":
        return renderGraphDecisionDependencies(sceneContent);
      case "graph-invalidated-assumptions":
        return renderGraphInvalidatedAssumptions(sceneContent);
      case "graph-orphans-unresolved":
        return renderGraphOrphansUnresolved(sceneContent);
      case "graph-changes":
        return renderGraphChanges(sceneContent);
      case "graph-review-required":
        return renderGraphReviewRequired(sceneContent);
      case "graph-validation":
        return renderGraphValidation(sceneContent);
      default: {
        const exhaustive: never = kind;
        throw new Error(`Unhandled knowledge graph scene kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return `<div class="scene-knowledge-graph" data-scene-kind="${escapeHtml(kind)}">${body}</div>`;
}
