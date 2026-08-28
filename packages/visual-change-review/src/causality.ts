import type { VisualEvidenceRef } from "@rvs/visual-intelligence";
import type { ReviewChange, ReviewPath, UnresolvedImpact } from "./contracts.js";
import { UNRESOLVED_IMPACT_STATEMENTS } from "./contracts.js";
import { buildReviewPathId, buildUnresolvedImpactId, normalizeIds } from "./ids.js";

// Causal review: the most important thing 10.4 gets right or wrong.
//
// The rule, stated once and enforced by the shape of this file: **adjacency is
// not causality.** Nothing here walks the graph. There is no traversal in this
// module, no neighbour lookup, no transitive closure -- because every one of
// those would let "these two entities are near each other" become "this change
// caused that regression", which is a claim RVS has no evidence for and a
// reviewer would act on.
//
// So a route is confirmed only when an upstream layer emitted that exact route
// as a result: an impact path from @rvs/knowledge-graph's bounded traversal, or
// a decision-impact entry recording that a decision was reached from the
// changed entity. RVS is repeating a claim somebody else made, and the route
// carries the id of the artifact it was read from so a reviewer can go and
// check.
//
// Two weaker relations exist and are labelled as weaker rather than promoted:
//
//   related     both ends cite the same evidence artifact, and no upstream
//               route connects them. That is a reason to look, not a cause.
//   unresolved  a relation exists whose far end upstream could not resolve.
//               Named so the reader knows the question was asked and not
//               answered, rather than left as a silence that reads like "no".

/** An impact path exactly as an upstream artifact recorded it. Ordered; never re-ordered here. */
export interface UpstreamImpactPath {
  /** Upstream's own id for the path. */
  id: string;
  /** The entity the traversal started from. */
  origin_entity_id: string;
  /** Entity ids in traversal order, origin first. */
  entity_ids: readonly string[];
  /** The upstream artifact this path was read from, e.g. "impact-results.json". */
  artifact_id: string;
  /** The traversal boundary upstream disclosed, when it disclosed one. */
  boundary?: string;
  /** True when upstream stopped at its own limit rather than at the end of the graph. */
  truncated?: boolean;
  evidence_refs?: readonly VisualEvidenceRef[];
}

/** A relation upstream recorded but could not resolve. Kept, never dropped. */
export interface UpstreamUnresolvedLink {
  id: string;
  /** The entity the unresolved relation starts from. */
  from_entity_id: string;
  /** What upstream was looking for, verbatim. */
  detail: string;
  boundary?: string;
}

export interface CausalityInput {
  changes: readonly ReviewChange[];
  impact_paths: readonly UpstreamImpactPath[];
  unresolved_links: readonly UpstreamUnresolvedLink[];
  /** Evidence carried by each entity, keyed by entity id, used only for the `related` classification. */
  evidence_by_entity: ReadonlyMap<string, readonly VisualEvidenceRef[]>;
}

export interface CausalityResult {
  paths: ReviewPath[];
  unresolved: UnresolvedImpact[];
}

/** Every artifact path an entity's evidence names. Paths only -- never line ranges, so two refs into one file count as the same artifact. */
function artifactsOf(refs: readonly VisualEvidenceRef[] | undefined): string[] {
  return normalizeIds((refs ?? []).map((r) => r.path).filter((p): p is string => p !== undefined));
}

/**
 * Classifies every relation this review can show between a change and a
 * consequence.
 *
 * Deterministic in full: paths sort by id, ids are digests of the ordered
 * entity list, and nothing consults input order. Shuffling `impact_paths`
 * cannot change one byte of the result.
 */
export function classifyCausality(input: CausalityInput): CausalityResult {
  const changeByEntity = new Map<string, ReviewChange[]>();
  for (const change of input.changes) {
    changeByEntity.set(change.entity_id, [...(changeByEntity.get(change.entity_id) ?? []), change]);
  }

  const paths: ReviewPath[] = [];
  const confirmedReach = new Map<string, Set<string>>();

  // ---- confirmed: upstream emitted this route ---------------------------
  for (const upstream of input.impact_paths) {
    const changes = changeByEntity.get(upstream.origin_entity_id);
    if (changes === undefined) continue;
    const ordered = [...upstream.entity_ids];
    if (ordered.length < 2) continue;
    const destination = ordered[ordered.length - 1];
    for (const change of changes) {
      paths.push({
        id: buildReviewPathId("confirmed", [change.id, ...ordered]),
        kind: "confirmed",
        entity_ids: ordered,
        from_change_id: change.id,
        to_entity_id: destination,
        upstream_artifact_id: upstream.artifact_id,
        description: `Confirmed causal path recorded upstream in ${upstream.artifact_id}: ${ordered.join(" → ")}.`,
        evidence_refs: [...(upstream.evidence_refs ?? [])],
      });
      const reached = confirmedReach.get(change.id) ?? new Set<string>();
      for (const id of ordered.slice(1)) reached.add(id);
      confirmedReach.set(change.id, reached);
    }
  }

  // ---- related: shared evidence, no upstream route ----------------------
  //
  // Restricted to pairs of *changed* entities. Scanning every entity against
  // every other would turn a shared config file into a claim that forty
  // components are related, which is noise wearing the costume of analysis.
  const changedIds = normalizeIds(input.changes.map((c) => c.entity_id));
  for (const change of [...input.changes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const own = artifactsOf(input.evidence_by_entity.get(change.entity_id));
    if (own.length === 0) continue;
    const reached = confirmedReach.get(change.id) ?? new Set<string>();
    for (const otherId of changedIds) {
      if (otherId === change.entity_id || reached.has(otherId)) continue;
      const shared = artifactsOf(input.evidence_by_entity.get(otherId)).filter((a) => own.includes(a));
      if (shared.length === 0) continue;
      paths.push({
        id: buildReviewPathId("related", [change.id, change.entity_id, otherId]),
        kind: "related",
        entity_ids: [change.entity_id, otherId],
        from_change_id: change.id,
        to_entity_id: otherId,
        description: `Related evidence path: both entities cite ${shared.join(", ")}. No upstream route connects them, so this is a reason to look rather than an established cause.`,
        evidence_refs: shared.map((path) => ({ path })),
      });
    }
  }

  // ---- unresolved: a relation whose far end upstream could not resolve ---
  for (const link of input.unresolved_links) {
    const changes = changeByEntity.get(link.from_entity_id);
    if (changes === undefined) continue;
    for (const change of changes) {
      paths.push({
        id: buildReviewPathId("unresolved", [change.id, link.id]),
        kind: "unresolved",
        entity_ids: [change.entity_id],
        from_change_id: change.id,
        to_entity_id: link.id,
        upstream_artifact_id: link.id,
        description: `Unresolved relation recorded upstream: ${link.detail}. The far end of this relation was not determined.`,
        evidence_refs: [],
      });
    }
  }

  // ---- what could not be determined, said in the fixed wording -----------
  const unresolved: UnresolvedImpact[] = [];
  const truncatedOrigins = new Set(
    input.impact_paths.filter((p) => p.truncated === true).map((p) => p.origin_entity_id),
  );
  const boundaryOf = new Map(
    input.impact_paths
      .filter((p) => p.boundary !== undefined)
      .map((p) => [p.origin_entity_id, p.boundary as string] as const),
  );
  const unresolvedLinkOrigins = new Set(input.unresolved_links.map((l) => l.from_entity_id));

  for (const change of input.changes) {
    const hasConfirmed = (confirmedReach.get(change.id)?.size ?? 0) > 0;
    let statement: string | undefined;
    let boundary: string | undefined;

    if (change.blast_radius === "unresolved" || unresolvedLinkOrigins.has(change.entity_id)) {
      // Upstream said outright that it could not determine reach.
      statement = UNRESOLVED_IMPACT_STATEMENTS.reach_unresolved;
    } else if (truncatedOrigins.has(change.entity_id)) {
      // Upstream reached its own limit. What lies beyond it is unknown, not absent.
      statement = UNRESOLVED_IMPACT_STATEMENTS.outside_boundary;
      boundary = boundaryOf.get(change.entity_id);
    } else if (!hasConfirmed) {
      // Nothing was found. That is a statement about the evidence analyzed,
      // and it is phrased as one -- never as "no downstream impact".
      statement = UNRESOLVED_IMPACT_STATEMENTS.no_confirmed_consumers;
    }

    if (statement === undefined) continue;
    unresolved.push({
      id: buildUnresolvedImpactId(change.id, statement),
      change_id: change.id,
      statement,
      ...(boundary === undefined ? {} : { boundary }),
    });
  }

  return {
    paths: paths.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    unresolved: unresolved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
