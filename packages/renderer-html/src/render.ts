import { createHash } from "node:crypto";
import { GENERATOR_VERSION, type EvidenceManifest, type GeneratorStamp } from "@rvs/core";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { VisualDoc } from "@rvs/visualdoc-schema";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import { CLIENT_SCRIPT } from "./client-script.js";
import { renderCitations } from "./citations.js";
import { escapeHtml } from "./escape.js";
import { renderSceneInner } from "./scenes/index.js";
import { BASE_CSS } from "./styles.js";
import { tokensToCssVariables, type DesignTokens } from "./tokens.js";

export interface RenderOptions {
  gitCommit: string;
}

export function renderVisualDocToHtml(
  doc: VisualDoc,
  tokens: DesignTokens,
  evidence: EvidenceManifest,
  options: RenderOptions,
  workflowGraphs: WorkflowGraph[] = [],
  terraformTopologies: TerraformTopology[] = [],
): string {
  const workflowGraphsById = new Map(workflowGraphs.map((g) => [g.id, g]));
  const terraformTopologiesById = new Map(terraformTopologies.map((t) => [t.id, t]));
  const contentHash = createHash("sha256").update(JSON.stringify(doc)).digest("hex");
  const stamp: GeneratorStamp = {
    generator_version: GENERATOR_VERSION,
    git_commit: options.gitCommit,
    design_system: tokens.name,
    content_spec_hash: `sha256:${contentHash}`,
    generated_at: new Date().toISOString(),
  };

  const scenesHtml = doc.scenes
    .map((scene, index) => {
      const inner = renderSceneInner(scene, index, workflowGraphsById, terraformTopologiesById);
      const citations = renderCitations(scene.evidence, evidence);
      return `
      <section class="scene" id="scene-${index}" data-scene-index="${index}" data-scene-id="${escapeHtml(scene.id)}" data-scene-type="${scene.type}" role="group" aria-roledescription="slide" aria-label="${escapeHtml(scene.headline)}">
        <div class="scene-inner">${inner}</div>
        ${citations}
      </section>`;
    })
    .join("\n");

  const css = `:root {\n${tokensToCssVariables(tokens)}\n}\n${BASE_CSS}`;

  return `<!doctype html>
<html lang="en" data-generator-version="${stamp.generator_version}" data-git-commit="${stamp.git_commit}" data-design-system="${stamp.design_system}" data-content-spec-hash="${stamp.content_spec_hash}" data-generated-at="${stamp.generated_at}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.document.title)}</title>
<style>${css}</style>
</head>
<body>
<div class="stage-viewport">
  <div class="stage">
    ${scenesHtml}
  </div>
</div>
<div class="controls" role="toolbar" aria-label="Presentation controls">
  <button id="rvs-prev" type="button" aria-label="Previous slide">&#8592;</button>
  <span id="rvs-counter">1 / ${doc.scenes.length}</span>
  <button id="rvs-next" type="button" aria-label="Next slide">&#8594;</button>
</div>
<div id="rvs-live" class="visually-hidden" role="status" aria-live="polite"></div>
<script type="application/json" id="rvs-stamp">${JSON.stringify(stamp)}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}
