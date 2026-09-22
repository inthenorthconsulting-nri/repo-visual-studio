// Provenance -> generic semantic-marker mapping (Milestone 11.3.3.2B, §16).
//
// This is the one new piece of authority this package adds: turning an
// `OverlayEntityProvenance` value already computed upstream
// (`@rvs/change-workbench`'s `buildChangeOverlay()`) into a
// `VisualSemanticMarker` the generic M10 channel can carry through
// adaptive stand-in reduction. It invents no new provenance vocabulary and
// no competing label authority -- every marker's `label` is the existing
// canonical `accessible_term` from `resolveProposalEntityProvenance()`
// (@rvs/visual-intelligence, Milestone 11.3.2). If that upstream wording
// changes, this mapping's labels change with it automatically, by
// reference, not by a second hand-maintained copy (§55).
//
// Marker keys are this package's own, separate concern from labels: they
// are the stable, caller-owned, sanitize()-safe token identity
// `aggregateSemanticMarkers()` groups and counts by. They are deliberately
// NOT derived from `accessible_term` (which is prose, not a key, and is
// free to change independently) and carry no repository-specific value.
//
// `removed` is deliberately excluded: removed entities are absent from
// projected topology (see adapt-projected.ts), so there is never a
// projected node/edge to attach a "removed" marker to (§4.1).

import type { VisualSemanticMarker } from "@rvs/visual-intelligence";
import { resolveProposalEntityProvenance } from "@rvs/visual-intelligence";

/** The three provenance values a Projected State entity/edge can carry. `removed` is excluded by construction -- see this file's header comment. */
export type ProjectedProvenanceValue = "confirmed" | "proposed" | "modified";

/**
 * Stable, sanitize()-safe, caller-owned marker keys -- ordinary lowercase
 * ASCII words and hyphens, none of which `sanitize()`
 * (`[^a-zA-Z0-9_.-]` -> `-`) rewrites, so no collision is possible between
 * these three keys or with any other marker key a future caller might
 * introduce under a different vocabulary.
 */
export const PROJECTED_PROVENANCE_MARKER_KEYS: Readonly<Record<ProjectedProvenanceValue, string>> = {
  confirmed: "provenance-confirmed",
  proposed: "provenance-proposed",
  modified: "provenance-modified",
};

/** Deterministic, explicit "provenance was missing" marker -- never silently treated as `confirmed` (§14). */
export const PROJECTED_PROVENANCE_UNRESOLVED_MARKER_KEY = "provenance-unresolved";

/** Pure lookup; the same input always yields the identical (by reference) marker. */
export function provenanceToSemanticMarker(provenance: ProjectedProvenanceValue): VisualSemanticMarker {
  const key = PROJECTED_PROVENANCE_MARKER_KEYS[provenance];
  const presentation = resolveProposalEntityProvenance(provenance);
  return { key, label: presentation.accessible_term };
}

/** For a projected entity/edge id this package cannot find provenance for -- an explicit unresolved state, never a guess. */
export function unresolvedProvenanceMarker(): VisualSemanticMarker {
  return { key: PROJECTED_PROVENANCE_UNRESOLVED_MARKER_KEY, label: "provenance unresolved" };
}
