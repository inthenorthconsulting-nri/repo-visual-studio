import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ShowcasePlan, ShowcaseScenePlan } from "@rvs/product-intelligence";
import type { ShowcaseScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";

// Renders the Executive Showcase presentation profile (Milestone 5). Every
// scene here is composed only from ShowcasePlan/ProductIdentity/
// ExecutiveNarrative content that has already passed product-intelligence's
// claim-control gate — this file makes no independent claim of its own and
// never renders a roadmap/excluded capability, matching
// capability-intelligence/render.ts's identical discipline.

function capabilityNamesById(model: CapabilityModel | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!model) return map;
  for (const c of [...model.includedCapabilities, ...model.qualifiedCapabilities]) map.set(c.id, c.displayName);
  return map;
}

function qualifiersBlock(qualifiers: string[]): string {
  if (qualifiers.length === 0) return "";
  return `<p class="showcase-qualifier-note">${qualifiers.map(escapeHtml).join(" ")}</p>`;
}

function renderHero(scene: ShowcaseScenePlan, plan: ShowcasePlan): string {
  return `
    <div class="showcase-hero">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
      ${scene.subheadline ? `<p class="showcase-descriptor">${escapeHtml(scene.subheadline)}</p>` : ""}
      <p class="showcase-eyebrow">${escapeHtml(plan.identity.displayName)}</p>
    </div>`;
}

function renderProblem(scene: ShowcaseScenePlan): string {
  return `
    <div class="showcase-causal">
      <h1>${escapeHtml(scene.headline)}</h1>
    </div>`;
}

function renderIdentity(scene: ShowcaseScenePlan): string {
  return `
    <div class="showcase-identity">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${scene.subheadline ? `<p class="showcase-purpose">${escapeHtml(scene.subheadline)}</p>` : ""}
    </div>`;
}

function renderOperatingModel(scene: ShowcaseScenePlan, plan: ShowcasePlan): string {
  const layers = plan.identity.valuePillars
    .slice(0, 3)
    .map((p, i) => `<li class="showcase-layer"><span class="showcase-layer-index">${i + 1}</span>${escapeHtml(p.title)}</li>`)
    .join("");
  return `
    <div class="showcase-operating-model">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ol class="showcase-layer-list">${layers}</ol>
    </div>`;
}

function renderValuePillars(scene: ShowcaseScenePlan, plan: ShowcasePlan): string {
  const cards = plan.identity.valuePillars
    .map(
      (p) => `
      <div class="showcase-pillar-card">
        <h3 class="showcase-pillar-title">${escapeHtml(p.title)}</h3>
        <p class="showcase-pillar-explanation">${escapeHtml(p.explanation)}</p>
        ${p.qualification ? `<p class="showcase-pillar-qualifier">${escapeHtml(p.qualification)}</p>` : ""}
      </div>`,
    )
    .join("");
  return `
    <div class="showcase-value-pillars">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="showcase-pillar-grid">${cards}</div>
    </div>`;
}

function renderCapabilities(scene: ShowcaseScenePlan, plan: ShowcasePlan, model: CapabilityModel | undefined): string {
  const names = capabilityNamesById(model);
  const qualifiedIds = new Set(plan.identity.qualifiedCapabilities);
  const chips = scene.capabilityIds
    .map((id) => {
      const label = names.get(id) ?? id;
      const qualified = qualifiedIds.has(id);
      return `<span class="showcase-chip${qualified ? " showcase-chip-qualified" : ""}">${escapeHtml(label)}${qualified ? ` <span class="showcase-chip-badge">Qualified</span>` : ""}</span>`;
    })
    .join("");
  return `
    <div class="showcase-capabilities">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="showcase-chip-grid">${chips}</div>
      ${qualifiersBlock(scene.qualifiers)}
    </div>`;
}

function renderDifferentiators(scene: ShowcaseScenePlan, plan: ShowcasePlan): string {
  const items = plan.identity.differentiators
    .map(
      (d) => `
      <li class="showcase-differentiator">
        <h3 class="showcase-differentiator-title">${escapeHtml(d.title)}</h3>
        <p>${escapeHtml(d.description)}</p>
      </li>`,
    )
    .join("");
  return `
    <div class="showcase-differentiators">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="showcase-differentiator-list">${items}</ul>
    </div>`;
}

function renderProof(scene: ShowcaseScenePlan, plan: ShowcasePlan): string {
  const cards = plan.metrics
    .map(
      (m) => `
      <div class="showcase-proof-card">
        <div class="showcase-proof-value">${escapeHtml(m.value)}</div>
        <div class="showcase-proof-label">${escapeHtml(m.label)}</div>
      </div>`,
    )
    .join("");
  return `
    <div class="showcase-proof">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="showcase-proof-grid">${cards || `<p class="arch-empty">No confirmed proof points are available yet.</p>`}</div>
    </div>`;
}

function renderLimitations(scene: ShowcaseScenePlan): string {
  const items = scene.qualifiers.map((q) => `<li class="arch-statement">${escapeHtml(q)}</li>`).join("");
  return `
    <div class="showcase-limitations">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="arch-statement-list">${items || `<li class="arch-empty">No qualifications were recorded.</li>`}</ul>
    </div>`;
}

function renderClosing(scene: ShowcaseScenePlan): string {
  return `
    <div class="showcase-closing">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
    </div>`;
}

function renderPortfolioOverview(scene: ShowcaseScenePlan): string {
  return `
    <div class="showcase-identity">
      <h1>${escapeHtml(scene.headline)}</h1>
    </div>`;
}

export function renderShowcaseScene(scene: ShowcaseScene, plan: ShowcasePlan | undefined, model: CapabilityModel | undefined): string {
  if (!plan) {
    throw new Error(`Showcase scene "${scene.id}" references unresolved plan_id "${scene.plan_id}"`);
  }
  const scenePlan = plan.scenes.find((s) => s.id === scene.scene_id);
  if (!scenePlan) {
    throw new Error(`Showcase scene "${scene.id}" references unresolved scene_id "${scene.scene_id}" within plan "${scene.plan_id}"`);
  }

  const body = (() => {
    switch (scenePlan.type) {
      case "showcase-hero":
        return renderHero(scenePlan, plan);
      case "showcase-problem":
        return renderProblem(scenePlan);
      case "showcase-identity":
        return renderIdentity(scenePlan);
      case "showcase-operating-model":
        return renderOperatingModel(scenePlan, plan);
      case "showcase-value-pillars":
        return renderValuePillars(scenePlan, plan);
      case "showcase-capabilities":
        return renderCapabilities(scenePlan, plan, model);
      case "showcase-differentiators":
        return renderDifferentiators(scenePlan, plan);
      case "showcase-proof":
        return renderProof(scenePlan, plan);
      case "showcase-limitations":
        return renderLimitations(scenePlan);
      case "showcase-closing":
        return renderClosing(scenePlan);
      case "portfolio-overview":
        return renderPortfolioOverview(scenePlan);
      default: {
        const exhaustive: never = scenePlan.type;
        throw new Error(`Unhandled showcase scene type: ${JSON.stringify(exhaustive)}`);
      }
    }
  })();

  return `<div class="scene-showcase" data-visual-metaphor="${scenePlan.visualMetaphor}" data-narrative-role="${scenePlan.narrativeRole}">${body}</div>`;
}
