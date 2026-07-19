import type { PortfolioDecision, PortfolioPlan, PortfolioProduct, PortfolioScenePlan } from "@rvs/portfolio-intelligence";
import type { PortfolioScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// Renders the Portfolio and Ecosystem Intelligence presentation profile
// (Milestone 6). Every scene here is composed only from PortfolioPlan/
// PortfolioModel content that has already passed portfolio-intelligence's
// claim/evidence control gate — this file makes no independent claim of its
// own, mirroring showcase/render.ts's identical discipline.

function qualifiersBlock(qualifiers: string[]): string {
  if (qualifiers.length === 0) return "";
  return `<p class="showcase-qualifier-note">${qualifiers.map(escapeHtml).join(" ")}</p>`;
}

function productsById(plan: PortfolioPlan): Map<string, PortfolioProduct> {
  return new Map(plan.model.products.map((p) => [p.id, p]));
}

function renderHero(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  return `
    <div class="showcase-hero">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
      ${scene.subheadline ? `<p class="showcase-descriptor">${escapeHtml(scene.subheadline)}</p>` : ""}
      <p class="showcase-eyebrow">${escapeHtml(plan.model.displayName)}</p>
    </div>`;
}

function renderMission(scene: PortfolioScenePlan): string {
  return `
    <div class="showcase-identity">
      <h1>${escapeHtml(scene.headline)}</h1>
    </div>`;
}

function renderLandscape(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const byId = productsById(plan);
  const cards = scene.productIds
    .map((id) => byId.get(id))
    .filter((p): p is PortfolioProduct => Boolean(p))
    .map(
      (p) => `
      <div class="portfolio-product-card">
        <h3 class="portfolio-product-name">${escapeHtml(p.displayName)}</h3>
        <p class="portfolio-product-descriptor">${escapeHtml(p.descriptor)}</p>
        <span class="portfolio-role-chip">${escapeHtml(p.primaryRole)}</span>
      </div>`,
    )
    .join("");
  return `
    <div class="portfolio-landscape">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="portfolio-product-grid">${cards || `<p class="arch-empty">No products are available yet.</p>`}</div>
    </div>`;
}

function renderProductRoles(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const byId = productsById(plan);
  const products = scene.productIds.map((id) => byId.get(id)).filter((p): p is PortfolioProduct => Boolean(p));
  const byRole = new Map<string, PortfolioProduct[]>();
  for (const p of products) {
    const list = byRole.get(p.primaryRole) ?? [];
    list.push(p);
    byRole.set(p.primaryRole, list);
  }
  const groups = [...byRole.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([role, ps]) => `
      <div class="portfolio-role-group">
        <h3 class="portfolio-role-title">${escapeHtml(role)}</h3>
        <ul class="portfolio-role-product-list">${ps.map((p) => `<li>${escapeHtml(p.displayName)}</li>`).join("")}</ul>
      </div>`,
    )
    .join("");
  return `
    <div class="portfolio-product-roles">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="portfolio-role-grid">${groups || `<p class="arch-empty">No product roles are available yet.</p>`}</div>
    </div>`;
}

function renderOperatingModel(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const byId = productsById(plan);
  const stages = plan.model.operatingModel.stages
    .map(
      (s, i) => `
      <li class="showcase-layer">
        <span class="showcase-layer-index">${i + 1}</span>
        <div>
          <div class="portfolio-stage-name">${escapeHtml(s.stage)}</div>
          <div class="portfolio-stage-products">${s.productIds
            .map((id) => byId.get(id)?.displayName ?? id)
            .map(escapeHtml)
            .join(", ")}</div>
        </div>
      </li>`,
    )
    .join("");
  return `
    <div class="showcase-operating-model">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ol class="showcase-layer-list">${stages || `<li class="arch-empty">No operating-model stages are available yet.</li>`}</ol>
      ${qualifiersBlock(scene.qualifiers)}
    </div>`;
}

function renderCapabilityCoverage(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const capabilitiesById = new Map(plan.model.capabilities.map((c) => [c.id, c]));
  const chips = scene.capabilityIds
    .map((id) => capabilitiesById.get(id))
    .filter((c): c is (typeof plan.model.capabilities)[number] => Boolean(c))
    .map((c) => {
      const shared = c.coverage === "shared" || c.coverage === "overlapping" || c.coverage === "complementary";
      return `<span class="showcase-chip${shared ? " showcase-chip-qualified" : ""}">${escapeHtml(c.displayName)}${shared ? ` <span class="showcase-chip-badge">${escapeHtml(c.coverage)}</span>` : ""}</span>`;
    })
    .join("");
  return `
    <div class="showcase-capabilities">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="showcase-chip-grid">${chips || `<p class="arch-empty">No capabilities are available yet.</p>`}</div>
      ${qualifiersBlock(scene.qualifiers)}
    </div>`;
}

function renderRelationshipMap(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const byId = productsById(plan);
  const relationshipsById = new Map([...plan.model.relationships, ...plan.model.unresolvedRelationships].map((r) => [r.id, r]));
  const rows = scene.relationshipIds
    .map((id) => relationshipsById.get(id))
    .filter((r): r is (typeof plan.model.relationships)[number] => Boolean(r))
    .map(
      (r) => `
      <li class="portfolio-relationship-row">
        <span class="portfolio-relationship-type">${escapeHtml(r.type)}</span>
        <span class="portfolio-relationship-products">${escapeHtml(byId.get(r.productAId)?.displayName ?? r.productAId)} &harr; ${escapeHtml(byId.get(r.productBId)?.displayName ?? r.productBId)}</span>
        <span class="portfolio-relationship-confidence">${escapeHtml(r.confidence)}</span>
      </li>`,
    )
    .join("");
  return `
    <div class="portfolio-relationship-map">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="portfolio-relationship-list">${rows || `<p class="arch-empty">No cross-product relationships are available yet.</p>`}</ul>
      ${qualifiersBlock(scene.qualifiers)}
    </div>`;
}

function renderDependencyMap(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const nodesById = new Map(plan.model.dependencyGraph.nodes.map((n) => [n.id, n]));
  const edges = plan.model.dependencyGraph.edges.filter((e) => scene.productIds.includes(e.sourceProductId));
  const rows = edges
    .map(
      (e) => `
      <li class="portfolio-dependency-row">
        <span class="portfolio-dependency-source">${escapeHtml(nodesById.get(e.sourceProductId)?.label ?? e.sourceProductId)}</span>
        <span class="portfolio-dependency-kind">${escapeHtml(e.kind)}</span>
        <span class="portfolio-dependency-target">${escapeHtml(nodesById.get(e.targetId)?.label ?? e.targetId)}</span>
      </li>`,
    )
    .join("");
  return `
    <div class="portfolio-dependency-map">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="portfolio-dependency-list">${rows || `<p class="arch-empty">No dependency edges are available yet.</p>`}</ul>
    </div>`;
}

function renderSharedContracts(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const byId = productsById(plan);
  const relationshipsById = new Map(plan.model.relationships.map((r) => [r.id, r]));
  const rows = scene.relationshipIds
    .map((id) => relationshipsById.get(id))
    .filter((r): r is (typeof plan.model.relationships)[number] => Boolean(r))
    .map(
      (r) => `
      <li class="portfolio-relationship-row">
        <span class="portfolio-relationship-type">${escapeHtml(r.type)}</span>
        <span class="portfolio-relationship-products">${escapeHtml(byId.get(r.productAId)?.displayName ?? r.productAId)} &harr; ${escapeHtml(byId.get(r.productBId)?.displayName ?? r.productBId)}</span>
      </li>`,
    )
    .join("");
  return `
    <div class="portfolio-relationship-map">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="portfolio-relationship-list">${rows || `<p class="arch-empty">No shared platform or contract relationships are available yet.</p>`}</ul>
    </div>`;
}

function renderMaturity(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const dims = plan.model.maturity;
  const rows = (Object.keys(dims) as (keyof typeof dims)[])
    .map((key) => {
      const d = dims[key];
      const pct = Math.round(d.score * 100);
      return `
      <li class="portfolio-maturity-row">
        <div class="portfolio-maturity-label">${escapeHtml(d.label)}</div>
        <div class="portfolio-maturity-bar-track"><div class="portfolio-maturity-bar-fill" style="width:${pct}%"></div></div>
        <div class="portfolio-maturity-value">${d.numerator}/${d.denominator}</div>
      </li>`;
    })
    .join("");
  return `
    <div class="portfolio-maturity">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="portfolio-maturity-list">${rows}</ul>
    </div>`;
}

function renderGaps(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const gapsById = new Map(plan.model.gaps.map((g) => [g.id, g]));
  const items = scene.gapIds
    .map((id) => gapsById.get(id))
    .filter((g): g is (typeof plan.model.gaps)[number] => Boolean(g))
    .map((g) => `<li class="arch-statement"><span class="portfolio-gap-type">${escapeHtml(g.type)}</span> ${escapeHtml(g.statement)}</li>`)
    .join("");
  return `
    <div class="showcase-limitations">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="arch-statement-list">${items || `<li class="arch-empty">No gaps were identified.</li>`}</ul>
    </div>`;
}

function renderDecisions(scene: PortfolioScenePlan, plan: PortfolioPlan): string {
  const items = plan.decisions
    .map(
      (d: PortfolioDecision) => `
      <li class="portfolio-decision-row">
        <div class="portfolio-decision-statement">${escapeHtml(d.statement)}</div>
        <div class="portfolio-decision-meta">
          <span class="portfolio-decision-urgency portfolio-decision-urgency-${escapeHtml(d.urgency)}">${escapeHtml(d.urgency)} urgency</span>
          <span>${escapeHtml(d.recommendedOwnerType)}</span>
        </div>
      </li>`,
    )
    .join("");
  return `
    <div class="portfolio-decisions">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="portfolio-decision-list">${items || `<p class="arch-empty">No decisions are available yet.</p>`}</ul>
    </div>`;
}

function renderClosing(scene: PortfolioScenePlan): string {
  return `
    <div class="showcase-closing">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
    </div>`;
}

export function renderPortfolioScene(scene: PortfolioScene, plan: PortfolioPlan | undefined): string {
  if (!plan) {
    throw new Error(`Portfolio scene "${scene.id}" references unresolved plan_id "${scene.plan_id}"`);
  }
  const scenePlan = plan.scenes.find((s) => s.id === scene.scene_id);
  if (!scenePlan) {
    throw new Error(`Portfolio scene "${scene.id}" references unresolved scene_id "${scene.scene_id}" within plan "${scene.plan_id}"`);
  }

  const body = (() => {
    switch (scenePlan.type) {
      case "portfolio-hero":
        return renderHero(scenePlan, plan);
      case "portfolio-mission":
        return renderMission(scenePlan);
      case "portfolio-landscape":
        return renderLandscape(scenePlan, plan);
      case "portfolio-product-roles":
        return renderProductRoles(scenePlan, plan);
      case "portfolio-operating-model":
        return renderOperatingModel(scenePlan, plan);
      case "portfolio-capability-coverage":
        return renderCapabilityCoverage(scenePlan, plan);
      case "portfolio-relationship-map":
        return renderRelationshipMap(scenePlan, plan);
      case "portfolio-dependency-map":
        return renderDependencyMap(scenePlan, plan);
      case "portfolio-shared-contracts":
        return renderSharedContracts(scenePlan, plan);
      case "portfolio-maturity":
        return renderMaturity(scenePlan, plan);
      case "portfolio-gaps":
        return renderGaps(scenePlan, plan);
      case "portfolio-decisions":
        return renderDecisions(scenePlan, plan);
      case "portfolio-closing":
        return renderClosing(scenePlan);
      default: {
        const exhaustive: never = scenePlan.type;
        throw new Error(`Unhandled portfolio scene type: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return `<div class="scene-portfolio" data-scene-density="${scenePlan.density}">${body}</div>`;
}
