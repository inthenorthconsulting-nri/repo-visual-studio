import type { EvidenceManifest } from "@rvs/core";
import { escapeHtml } from "./escape.js";

export function renderCitations(evidenceIds: string[], evidence: EvidenceManifest): string {
  if (evidenceIds.length === 0) return "";

  const items = evidenceIds
    .map((id) => evidence.claims.find((c) => c.claim_id === id))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
    .map((claim) => {
      const source = claim.sources[0];
      const location = source ? `${source.path}${source.lines ? `:${source.lines}` : ""}` : "unknown source";
      return `<li><cite>${escapeHtml(location)}</cite> <span class="citation-confidence">(${escapeHtml(claim.confidence)})</span></li>`;
    })
    .join("");

  if (!items) return "";

  return `<footer class="citations"><h2 class="citations-heading">Sources</h2><ul>${items}</ul></footer>`;
}
