// Generic semantic qualification that survives adaptive visual reduction
// (Milestone 11.3.3.2A).
//
// A caller sometimes knows something about an entity that none of this
// package's existing vocabularies can say. `resolution` says how well a
// reference was resolved. `confidence` says how well a fact was established.
// `severity` and `decision_status` say what governance found. `VisualState`
// says how the five presentation layers should be painted. None of them can
// carry "this box is here because of an outside qualification whose meaning
// this layer does not know" -- and none of them should be made to, because
// every one of them is a truth field that downstream renderers, receipts, and
// validators already read as an assertion about the architecture itself.
//
// So this module adds one deliberately thin channel instead. A semantic
// marker is transported and rendered; it is never interpreted. This package
// does not know why a marker exists, and nothing in here may ever learn --
// that is the boundary that keeps a caller's domain semantics from becoming
// M10 vocabulary.
//
// The channel's whole reason to exist is survivability. A qualification that
// disappears the moment a view exceeds its node budget is worse than no
// qualification at all, because the reader cannot tell an unmarked entity
// from a marked entity whose marker was dropped in reduction. So markers
// aggregate into stand-ins rather than being replaced by a single winner:
// see `aggregateSemanticMarkers`.

import { sanitize } from "./ids.js";

/**
 * One unit of caller-supplied semantic qualification attached to a node or an
 * edge.
 *
 * Two required fields, because the repository already needs both and neither
 * can do the other's job:
 *
 * - `key` is the stable machine identity. It lands in a space-separated
 *   `data-rvs-markers` attribute, matching the existing `data-rvs-state`
 *   convention, so it must be token-safe. Token-safe text is not human text.
 * - `label` is what a person reads and what a screen reader announces. Human
 *   text cannot be a token.
 *
 * The investigative sketch proposed a third field (`accessible_term`) beside
 * `label`. It is deliberately not here: two independently-authored human
 * strings can disagree, and a drawing whose printed tag and spoken name say
 * different things is a defect this contract should not be able to express.
 * One human string means the visible tag and the accessible name cannot
 * diverge, and it halves the surface that has to pass through escaping.
 *
 * `count` is multiplicity, not importance. It is normally absent -- an entity
 * carrying a marker carries it once -- and is populated by aggregation, where
 * "nine of these and one of those" and "one of these and nine of those" must
 * not draw identically.
 */
export interface VisualSemanticMarker {
  /** Stable token identity. Normalized with the repository's existing id `sanitize`. */
  key: string;
  /** Human-readable term, used for the visible tag and the accessible name. */
  label: string;
  /** Multiplicity. Absent means one; never below one; never a rank or a score. */
  count?: number;
}

/** Collapses internal whitespace runs so two spellings of the same label cannot both survive. */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** Multiplicity is a positive integer or nothing; anything else is read as one. */
function normalizeCount(count: number | undefined): number {
  if (count === undefined) return 1;
  if (!Number.isFinite(count)) return 1;
  const floored = Math.floor(count);
  return floored < 1 ? 1 : floored;
}

/**
 * Puts a marker list into canonical form.
 *
 * - Keys pass through the repository's existing `sanitize` -- no second id
 *   algorithm is introduced here.
 * - Labels are whitespace-normalized. Escaping is *not* done here; it happens
 *   at the single existing render boundary, so marker text cannot acquire a
 *   second, weaker escaping path.
 * - A marker with no key or no label is dropped: it qualifies nothing.
 * - Duplicate keys collapse. Multiplicity sums, and the surviving label is the
 *   lexicographically smallest of the conflicting labels -- a canonical
 *   authority, chosen precisely so that input order can never pick the winner.
 * - The result is sorted by key. Sorting is by code unit, not by locale,
 *   because a locale-sensitive comparison is a machine-dependent output.
 * - `count` is omitted when it is one, so the canonical form of a marker that
 *   occurs once is the same object shape a caller would have written by hand.
 *   That makes this function idempotent.
 *
 * Returns `undefined` for an absent or empty list, so an unmarked model keeps
 * exactly the shape it had before this channel existed.
 */
export function normalizeSemanticMarkers(
  markers: readonly VisualSemanticMarker[] | undefined,
): VisualSemanticMarker[] | undefined {
  if (markers === undefined || markers.length === 0) return undefined;

  const byKey = new Map<string, { key: string; label: string; count: number }>();
  for (const marker of markers) {
    const key = sanitize(marker.key ?? "").trim();
    const label = normalizeLabel(marker.label ?? "");
    if (key === "" || label === "") continue;
    const count = normalizeCount(marker.count);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { key, label, count });
      continue;
    }
    existing.count += count;
    if (label < existing.label) existing.label = label;
  }

  if (byKey.size === 0) return undefined;
  return [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ key, label, count }) => (count === 1 ? { key, label } : { key, label, count }));
}

/**
 * Unions several markered entities' qualifications into one.
 *
 * This is the function a stand-in uses, and it is the reason this slice
 * exists. Adaptation replaces N boxes with one box; if that box reported only
 * the "worst" or the "first" marker, reduction would silently delete
 * qualification that the reader has no way to know was ever there. So the
 * union is non-lossy by key, and multiplicity is summed rather than
 * discarded.
 *
 * Given members marked {m1}, {m2} and {m1, m3}, the result is
 * {m1 x2, m2, m3} -- never {m1}, and never one severity-like winner.
 *
 * Aggregation is deliberately just normalization over the concatenation: one
 * ordering rule, one duplicate rule, one canonical form, so a stand-in of
 * stand-ins cannot drift from a stand-in of leaves.
 */
export function aggregateSemanticMarkers(
  groups: readonly (readonly VisualSemanticMarker[] | undefined)[],
): VisualSemanticMarker[] | undefined {
  const all: VisualSemanticMarker[] = [];
  for (const group of groups) {
    if (group === undefined) continue;
    all.push(...group);
  }
  return normalizeSemanticMarkers(all);
}

/**
 * The canonical phrase for a marker set, used by every consumer so the
 * accessible name, the stand-in description and any other announcement cannot
 * word the same fact differently.
 *
 * "marked" is the verb rather than "qualified" (which already names a
 * `VisualConfidence` value) or anything that would imply a judgement. This
 * layer is stating that a qualification is attached, not what it is worth.
 */
export function describeSemanticMarkers(
  markers: readonly VisualSemanticMarker[] | undefined,
): string | undefined {
  const normalized = normalizeSemanticMarkers(markers);
  if (normalized === undefined) return undefined;
  const terms = normalized.map((m) => (m.count === undefined ? m.label : `${m.label} (${m.count})`));
  return `marked ${terms.join(", ")}`;
}

/**
 * The space-separated token form for a `data-rvs-markers` attribute, matching
 * the existing `data-rvs-state` convention. Keys only -- a data attribute is a
 * machine channel and must not become a second, unescaped text channel.
 */
export function semanticMarkerTokens(
  markers: readonly VisualSemanticMarker[] | undefined,
): string | undefined {
  const normalized = normalizeSemanticMarkers(markers);
  if (normalized === undefined) return undefined;
  return normalized.map((m) => m.key).join(" ");
}

/**
 * The short visible tag row drawn inside a marked node or beside a marked
 * edge. Labels, not keys, because the visible channel is for people; counts
 * are shown only where aggregation produced them.
 */
export function semanticMarkerTagText(
  markers: readonly VisualSemanticMarker[] | undefined,
): string | undefined {
  const normalized = normalizeSemanticMarkers(markers);
  if (normalized === undefined) return undefined;
  return normalized.map((m) => (m.count === undefined ? m.label : `${m.label} x${m.count}`)).join(" · ");
}
