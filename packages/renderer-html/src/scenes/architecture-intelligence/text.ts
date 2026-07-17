import type { ArchitectureIntelligence, ArchitectureRiskSeverity } from "@rvs/architecture-intelligence";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../../escape.js";
import { applyFocus, statementList, statementText } from "./helpers.js";

export function renderExecutiveTitle(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  return `
    <div class="scene-arch-executive-title">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
      <p class="arch-subheadline">${escapeHtml(statementText(artifact.identity.oneLineDescription))}</p>
    </div>
  `;
}

export function renderExecutiveSummary(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const statements = [artifact.purpose.problemStatement, ...artifact.capabilityDomains.map((d) => d.summary)].slice(0, 6);
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${statementList(statements, "No capability summary could be synthesized from the available evidence.")}
    </div>
  `;
}

export function renderProblemAndResponse(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const statements = [artifact.purpose.problemStatement, ...artifact.purpose.scopeBoundaries];
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${statementList(statements, "No documented problem statement or scope boundary was found.")}
    </div>
  `;
}

export function renderPlatformResponsibilities(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const responsibilities = applyFocus(artifact.responsibilities, scene.focus_ids);
  if (responsibilities.length === 0) {
    return `<div class="scene-arch-text"><h1>${escapeHtml(scene.headline)}</h1><p class="arch-empty">No responsibilities were synthesized.</p></div>`;
  }
  const items = responsibilities
    .map((r) => `<li class="arch-statement"><strong>${escapeHtml(r.label.displayLabel)}</strong> — ${escapeHtml(statementText(r.description))}</li>`)
    .join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="arch-statement-list">${items}</ul>
    </div>
  `;
}

export function renderOutcomes(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const outcomes = applyFocus(artifact.outcomes, scene.focus_ids);
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${statementList(
        outcomes.map((o) => o.statement),
        "No outcomes could be substantiated from the available evidence.",
      )}
    </div>
  `;
}

const SEVERITY_ORDER: ArchitectureRiskSeverity[] = ["high", "medium", "low"];

export function renderRiskSummary(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence, includeDependencies: boolean): string {
  const risks = [...applyFocus(artifact.risks, scene.focus_ids)].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const riskItems = risks
    .map(
      (r) =>
        `<li class="arch-statement"><span class="arch-severity arch-severity-${r.severity}">${r.severity}</span> <strong>${escapeHtml(r.label.displayLabel)}</strong> — ${escapeHtml(statementText(r.description))}</li>`,
    )
    .join("");

  const dependencySection = includeDependencies
    ? `<h2 class="arch-subheading">Dependencies</h2>${statementList(
        artifact.dependencies.map((d) => d.description),
        "No dependencies were detected.",
      )}`
    : "";

  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${riskItems ? `<ul class="arch-statement-list">${riskItems}</ul>` : `<p class="arch-empty">No risks were identified from the available evidence.</p>`}
      ${dependencySection}
    </div>
  `;
}

export function renderOperatingModel(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const groups: Array<{ label: string; statements: typeof artifact.operatingModel.deploymentEnvironments }> = [
    { label: "Deployment environments", statements: artifact.operatingModel.deploymentEnvironments },
    { label: "Release process", statements: artifact.operatingModel.releaseProcess },
    { label: "Observability", statements: artifact.operatingModel.observability },
    { label: "Approval gates", statements: artifact.operatingModel.approvalGates },
  ];
  const sections = groups
    .map((g) => `<section class="arch-operating-group"><h2 class="arch-subheading">${escapeHtml(g.label)}</h2>${statementList(g.statements, "Not evidenced.")}</section>`)
    .join("");
  return `
    <div class="scene-arch-text scene-arch-operating-model">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="arch-operating-grid">${sections}</div>
    </div>
  `;
}

export function renderDecisionOrNextStep(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): string {
  const questions = applyFocus(artifact.questions, scene.focus_ids);
  if (questions.length === 0) {
    return `
      <div class="scene-arch-text">
        <h1>${escapeHtml(scene.headline)}</h1>
        <p class="arch-empty">No open questions remain — every synthesized statement is confirmed or derived from evidence.</p>
      </div>
    `;
  }
  const items = questions.map((q) => `<li class="arch-statement">${escapeHtml(q.question)}</li>`).join("");
  return `
    <div class="scene-arch-text">
      <h1>${escapeHtml(scene.headline)}</h1>
      <ul class="arch-statement-list">${items}</ul>
    </div>
  `;
}
