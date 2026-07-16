import type { HeadlineScene } from "@rvs/visualdoc-schema";
import { escapeHtml } from "../escape.js";

export function renderHeadlineScene(scene: HeadlineScene): string {
  const items = scene.body.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  return `
    <div class="scene-headline">
      <h1>${escapeHtml(scene.headline)}</h1>
      ${items ? `<ul class="body-list">${items}</ul>` : ""}
    </div>
  `;
}
