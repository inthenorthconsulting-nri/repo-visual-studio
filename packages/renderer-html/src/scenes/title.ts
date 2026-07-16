import type { TitleScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

export function renderTitleScene(scene: TitleScene): string {
  return `
    <div class="scene-title">
      <h1 class="display">${escapeHtml(scene.headline)}</h1>
      ${scene.subheadline ? `<p class="subheadline">${escapeHtml(scene.subheadline)}</p>` : ""}
    </div>
  `;
}
