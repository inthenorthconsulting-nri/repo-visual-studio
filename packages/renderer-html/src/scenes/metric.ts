import type { MetricScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

export function renderMetricScene(scene: MetricScene): string {
  const items = scene.metrics
    .map(
      (m) => `
      <div class="metric-item">
        <span class="metric-value">${escapeHtml(m.value)}</span>
        <span class="metric-label">${escapeHtml(m.label)}</span>
      </div>`,
    )
    .join("");

  return `
    <div class="scene-metric">
      <h1>${escapeHtml(scene.headline)}</h1>
      <div class="metric-grid" style="--metric-count: ${scene.metrics.length}">${items}</div>
    </div>
  `;
}
