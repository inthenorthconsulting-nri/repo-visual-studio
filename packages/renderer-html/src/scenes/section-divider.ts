import type { SectionDividerScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

export function renderSectionDividerScene(scene: SectionDividerScene, index: number): string {
  const displayIndex = scene.index ?? index + 1;
  return `
    <div class="scene-divider">
      <span class="divider-index">${String(displayIndex).padStart(2, "0")}</span>
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
    </div>
  `;
}
