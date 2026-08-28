import type {
  VisualChange,
  VisualChangeKind,
  VisualEdge,
  VisualEvidenceRef,
  VisualGraphModel,
  VisualNode,
  VisualResolution,
} from "@rvs/visual-intelligence";
import { emptyVisualGraphModel, normalizeVisualGraphModel } from "@rvs/visual-intelligence";
import type {
  ReviewBlastRadius,
  ReviewChange,
  ReviewChangeType,
  ReviewCompatibility,
  ReviewDecisionImpact,
  ReviewGovernanceFinding,
  ReviewPath,
  ReviewResolutionStatus,
  UnresolvedImpact,
} from "./contracts.js";
import { classifyCausality, type UpstreamImpactPath, type UpstreamUnresolvedLink } from "./causality.js";
import { buildDerivedChangeId, digestOf, normalizeIds } from "./ids.js";

// Turning already-computed comparison artifacts into a reviewable model.
//
// The intake shapes below are *structural*. This package imports nothing from
// @rvs/knowledge-graph, @rvs/governance-intelligence or
// @rvs/decision-intelligence; the CLI, which already reads those caches,
// passes plain objects in. Same zero-cross-import convention as every
// intelligence layer, and it is what lets the review be tested against
// fixtures rather than against a built repository.
//
// What this module does *not* do, stated so a future edit has to argue with
// it rather than drift past it:
//
//   * It does not diff two snapshots. `GraphChangeSet` arrives already
//     computed by `rvs graph compare`; the only comparisons here are lookups
//     ("is this id in the before set?") needed to place a change on a panel.
//   * It does not decide capability regression. `regressed` is emitted only
//     where an upstream governance change entry already recorded a reduced or
//     lost runtime impact.
//   * It does not decide governance severity, decision state, impact paths,
//     or blast radius. All four are copied.
//   * It does not scan repository source. Evidence references arrive from
//     upstream and are rendered as text.

// ---------------------------------------------------------------------------
// Structural intake
// ---------------------------------------------------------------------------

/** A knowledge-graph node, structurally. Field names match `nodes.json`. */
export interface ReviewSourceNode {
  id: string;
  node_type: string;
  label: string;
  source_entity_id: string;
  resolution_status: string;
  confidence: string;
  evidence_refs?: readonly VisualEvidenceRef[];
}

/** A knowledge-graph edge, structurally. Field names match `edges.json`. */
export interface ReviewSourceEdge {
  id: string;
  edge_type: string;
  from_node_id: string;
  to_node_id: string;
  resolution_status: string;
  detail?: string;
}

/** One side of the comparison, exactly as a `graph-snapshot.json` directory holds it. */
export interface ReviewSnapshot {
  snapshot_id: string;
  nodes: readonly ReviewSourceNode[];
  edges: readonly ReviewSourceEdge[];
}

/**
 * `GraphChangeSet`, structurally.
 *
 * Every field is an id list @rvs/knowledge-graph's `diffGraphs` already
 * produced. Optional throughout, because a comparison that ran without
 * `--impact`/`--path` queries genuinely has nothing to say about those
 * facets, and an empty list is the truthful representation of that.
 */
export interface ReviewGraphChangeSet {
  id?: string;
  source_snapshot_id?: string;
  target_snapshot_id?: string;
  nodes_added?: readonly string[];
  nodes_removed?: readonly string[];
  edges_added?: readonly string[];
  edges_removed?: readonly string[];
  entity_types_changed?: readonly string[];
  relationships_changed?: readonly string[];
  dependency_paths_changed?: readonly string[];
}

/**
 * `GovernanceChangeEntry`, structurally.
 *
 * The second upstream change source, and the only one that carries a runtime
 * or materiality judgement. Those judgements are what `regressed` and
 * `qualified` are read from -- this package never forms either on its own.
 */
export interface ReviewGovernanceChangeEntry {
  id: string;
  entity_id: string;
  entity_label?: string;
  type: string;
  detail?: string;
  domain_path?: string;
  evidence_refs?: readonly VisualEvidenceRef[];
  classification?: {
    materiality?: string;
    runtime_impact?: string;
    consumer_impact?: string;
    evidence_impact?: string;
  };
}

/** A governance finding, structurally. Field names match `governance-findings.json`. */
export interface ReviewSourceFinding {
  id: string;
  severity: "blocking" | "review_required" | "advisory" | "informational";
  statement: string;
  affected_entity_ids: readonly string[];
  human_review_required?: boolean;
  blast_radius?: string;
  /** Set by the caller when upstream recorded the finding as no longer open in the target snapshot. */
  resolved?: boolean;
  evidence_refs?: readonly VisualEvidenceRef[];
}

/** A decision impact, structurally. Field names match `decision-impact.json`. */
export interface ReviewSourceDecisionImpact {
  id: string;
  decision_node_id: string;
  target_entity_node_id: string;
  state: string;
  detail: string;
  evidence_refs?: readonly VisualEvidenceRef[];
}

/** A link an upstream layer established between a changed entity and a capability or product. Never inferred here. */
export interface ReviewEntityLink {
  entity_id: string;
  capability_ids?: readonly string[];
  product_ids?: readonly string[];
}

export interface ChangeReviewSourceInput {
  before: ReviewSnapshot;
  after: ReviewSnapshot;
  compatibility: ReviewCompatibility;
  graph_changes?: ReviewGraphChangeSet;
  governance_changes?: readonly ReviewGovernanceChangeEntry[];
  findings?: readonly ReviewSourceFinding[];
  decision_impacts?: readonly ReviewSourceDecisionImpact[];
  impact_paths?: readonly UpstreamImpactPath[];
  unresolved_links?: readonly UpstreamUnresolvedLink[];
  entity_links?: readonly ReviewEntityLink[];
  /** Changes or entities the reader asked about. They become focal and are never adapted away. */
  focal_entity_ids?: readonly string[];
  /** Domains the caller could not compare at all, so the page says "not comparable" rather than "no change". */
  unavailable_domains?: readonly string[];
}

// ---------------------------------------------------------------------------
// Vocabulary mapping
// ---------------------------------------------------------------------------

/**
 * `ReviewChangeType` in the drawing vocabulary.
 *
 * `modified` is `changed` and everything else keeps its own name -- the two
 * vocabularies were written against the same list, and the one difference is
 * spelling rather than meaning. No mapping here softens a term: `removed`
 * stays `removed`.
 */
const VISUAL_KIND: Record<ReviewChangeType, VisualChangeKind> = {
  added: "added",
  removed: "removed",
  modified: "changed",
  rerouted: "rerouted",
  regressed: "regressed",
  resolved: "resolved",
  qualified: "qualified",
  unresolved: "unresolved",
};

const BLAST_RADIUS_VALUES = new Set<string>([
  "isolated",
  "local",
  "cross_component",
  "cross_layer",
  "product_wide",
  "cross_product",
  "portfolio_wide",
  "unresolved",
]);

/**
 * Blast radius, copied.
 *
 * Two upstream layers use overlapping but not identical vocabularies
 * (@rvs/knowledge-graph has `cross_layer`; @rvs/governance-intelligence has
 * `product_wide` and `cross_product`), so `ReviewBlastRadius` is the union of
 * both and each value survives verbatim. A value in neither vocabulary is not
 * mapped onto a neighbour -- that would be this package assigning a reach
 * nobody measured -- so it becomes `unresolved`, which is what "we do not
 * know how far this goes" already means.
 */
function blastRadiusOf(value: string | undefined): ReviewBlastRadius {
  if (value === undefined) return "unresolved";
  return BLAST_RADIUS_VALUES.has(value) ? (value as ReviewBlastRadius) : "unresolved";
}

function resolutionOf(value: string | undefined): ReviewResolutionStatus {
  return value === "unresolved" || value === "partial" ? value : "resolved";
}

function visualResolution(value: string): VisualResolution {
  return value === "unresolved" || value === "partial" ? value : "resolved";
}

function visualConfidence(value: string): VisualNode["confidence"] {
  return value === "qualified" || value === "unverifiable" ? value : "confirmed";
}

/**
 * A governance change entry's review change type.
 *
 * Precedence is stated here rather than left to reading order, because it is
 * the one place this package chooses between two upstream facts:
 *
 *  1. `added` and `removed` win outright. Both are facts about presence, and
 *     a removal that also reduced runtime is still, first, a removal. Calling
 *     it `regressed` would hide the entity's disappearance behind its
 *     consequence.
 *  2. Otherwise a recorded runtime reduction or loss is `regressed`. Upstream
 *     wrote down that something the system did, it now does less of or not at
 *     all; that is the regression, and this package neither computes nor
 *     second-guesses it.
 *  3. Otherwise a materiality of `qualified` is `qualified`, upstream's own
 *     word for "still there, but we are less sure of it".
 *  4. Otherwise `renamed` and `reclassified` join `modified`: all three mean
 *     the entity persisted and something about it differs.
 *  5. `unchanged` is not a change and produces no entry at all.
 */
function governanceChangeType(entry: ReviewGovernanceChangeEntry): ReviewChangeType | undefined {
  if (entry.type === "unchanged") return undefined;
  if (entry.type === "added") return "added";
  if (entry.type === "removed") return "removed";
  const runtime = entry.classification?.runtime_impact;
  if (runtime === "reduced" || runtime === "lost") return "regressed";
  if (entry.classification?.materiality === "qualified") return "qualified";
  if (entry.type === "unresolved") return "unresolved";
  if (entry.type === "modified" || entry.type === "renamed" || entry.type === "reclassified") return "modified";
  return undefined;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Everything the review knows before composition attaches a spec and a receipt. */
export interface ReviewAssembly {
  from_snapshot_id: string;
  to_snapshot_id: string;
  compatibility: ReviewCompatibility;
  before_entity_ids: string[];
  after_entity_ids: string[];
  /** Everything the baseline contained -- entities and relationships -- so a relationship change can be checked against the side it belongs to. */
  before_ids: string[];
  /** Everything the target contained, same reason. */
  after_ids: string[];
  changes: ReviewChange[];
  governance_findings: ReviewGovernanceFinding[];
  decision_impacts: ReviewDecisionImpact[];
  confirmed_paths: ReviewPath[];
  unresolved_impacts: UnresolvedImpact[];
  review_required_ids: string[];
  unavailable_domains: string[];
  /** The union model both panels are drawn from. */
  visual: VisualGraphModel;
  /** Digest of everything the assembly is a pure function of. Never a clock. */
  input_digest: string;
  /** Change types that arrived and were not recognised, for validation to report. */
  unsupported_change_types: Array<{ id: string; type: string }>;
  /** Change ids that arrived more than once, for validation to report. */
  duplicate_change_ids: string[];
}

interface EntityIndex {
  /** Node by its graph node id and by its source entity id, so either identifier resolves. */
  byAnyId: Map<string, ReviewSourceNode>;
  bySourceEntity: Map<string, ReviewSourceNode>;
  edgeByAnyId: Map<string, ReviewSourceEdge>;
}

function indexOf(snapshot: ReviewSnapshot): EntityIndex {
  const byAnyId = new Map<string, ReviewSourceNode>();
  const bySourceEntity = new Map<string, ReviewSourceNode>();
  for (const node of snapshot.nodes) {
    byAnyId.set(node.id, node);
    if (!byAnyId.has(node.source_entity_id)) byAnyId.set(node.source_entity_id, node);
    bySourceEntity.set(node.source_entity_id, node);
  }
  const edgeByAnyId = new Map<string, ReviewSourceEdge>();
  for (const edge of snapshot.edges) edgeByAnyId.set(edge.id, edge);
  return { byAnyId, bySourceEntity, edgeByAnyId };
}

/**
 * The entity id a change is about, in the identifier the rest of the review
 * uses.
 *
 * Upstream layers name entities two ways -- @rvs/knowledge-graph by node id,
 * @rvs/governance-intelligence by the upstream artifact's own entity id --
 * and both resolve to the same node. Resolving to `source_entity_id` here
 * means one entity has one identity across the whole review, rather than two
 * that a reader would have to notice were the same thing.
 *
 * An id that resolves in neither snapshot is returned unchanged, so a
 * dangling change stays visible to validation instead of being quietly
 * dropped.
 */
function entityIdOf(rawId: string, before: EntityIndex, after: EntityIndex): string {
  return (before.byAnyId.get(rawId) ?? after.byAnyId.get(rawId))?.source_entity_id ?? rawId;
}

function entityTypeOf(rawId: string, before: EntityIndex, after: EntityIndex, fallback: string): string {
  const node = before.byAnyId.get(rawId) ?? after.byAnyId.get(rawId);
  if (node !== undefined) return node.node_type;
  const edge = before.edgeByAnyId.get(rawId) ?? after.edgeByAnyId.get(rawId);
  if (edge !== undefined) return edge.edge_type;
  return fallback;
}

function evidenceOf(rawId: string, before: EntityIndex, after: EntityIndex): VisualEvidenceRef[] {
  const node = after.byAnyId.get(rawId) ?? before.byAnyId.get(rawId);
  return [...(node?.evidence_refs ?? [])];
}

interface DraftChange {
  id: string;
  change_type: ReviewChangeType;
  raw_id: string;
  entity_id: string;
  entity_type: string;
  summary: string;
  evidence_refs: VisualEvidenceRef[];
}

/**
 * Builds the whole reviewable model from already-computed comparison output.
 *
 * Deterministic end to end: every list is sorted by a stable key before it is
 * returned, every derived id is a digest of content rather than a position,
 * and nothing consults input order. Shuffling any input array produces a
 * byte-identical assembly.
 */
export function buildReviewAssembly(input: ChangeReviewSourceInput): ReviewAssembly {
  const before = indexOf(input.before);
  const after = indexOf(input.after);
  const beforeEntityIds = normalizeIds(input.before.nodes.map((n) => n.source_entity_id));
  const afterEntityIds = normalizeIds(input.after.nodes.map((n) => n.source_entity_id));

  const drafts: DraftChange[] = [];
  const unsupported: Array<{ id: string; type: string }> = [];

  const push = (changeType: ReviewChangeType, rawId: string, summary: string, fallbackType: string, id?: string) => {
    drafts.push({
      id: id ?? buildDerivedChangeId(changeType, rawId),
      change_type: changeType,
      raw_id: rawId,
      entity_id: entityIdOf(rawId, before, after),
      entity_type: entityTypeOf(rawId, before, after, fallbackType),
      summary,
      evidence_refs: evidenceOf(rawId, before, after),
    });
  };

  // ---- from the graph change set ---------------------------------------
  //
  // Each list below is a fact @rvs/knowledge-graph's `diffGraphs` already
  // established. The mapping is deliberately literal: `relationships_changed`
  // holds edges whose resolution status or detail differs, which is a
  // modification, not a reroute -- the edge still runs between the same two
  // endpoints. Reroutes come from `dependency_paths_changed`, where upstream
  // recorded that the shortest route between two entities is now a different
  // route, which is what "rerouted" means.
  const gcs = input.graph_changes ?? {};
  for (const id of gcs.nodes_added ?? []) {
    push("added", id, "Present in the target snapshot and absent from the baseline.", "entity");
  }
  for (const id of gcs.nodes_removed ?? []) {
    push("removed", id, "Present in the baseline snapshot and absent from the target.", "entity");
  }
  for (const id of gcs.edges_added ?? []) {
    push("added", id, "Relationship present in the target snapshot and absent from the baseline.", "relationship");
  }
  for (const id of gcs.edges_removed ?? []) {
    push("removed", id, "Relationship present in the baseline snapshot and absent from the target.", "relationship");
  }
  for (const id of gcs.entity_types_changed ?? []) {
    push("modified", id, "Entity type differs between the two snapshots.", "entity");
  }
  for (const id of gcs.relationships_changed ?? []) {
    push("modified", id, "Relationship resolution status or detail differs between the two snapshots.", "relationship");
  }
  // `dependency_paths_changed` entries are keyed `from->to`: upstream asked
  // for the shortest route between a pair and got a different route this time.
  // The change is anchored on the origin, which is a real entity in at least
  // one snapshot, rather than on the composite key -- a change hanging off an
  // id that exists in neither snapshot could not be drawn, selected, or
  // reached from the panels, and would read as dangling to validation.
  for (const key of gcs.dependency_paths_changed ?? []) {
    const arrow = key.indexOf("->");
    const origin = arrow === -1 ? key : key.slice(0, arrow);
    const destination = arrow === -1 ? undefined : key.slice(arrow + 2);
    drafts.push({
      id: buildDerivedChangeId("rerouted", key),
      change_type: "rerouted",
      raw_id: origin,
      entity_id: entityIdOf(origin, before, after),
      entity_type: entityTypeOf(origin, before, after, "entity"),
      summary:
        destination === undefined
          ? "The shortest dependency route from this entity is a different route in the target snapshot."
          : `The shortest dependency route from this entity to ${destination} is a different route in the target snapshot.`,
      evidence_refs: evidenceOf(origin, before, after),
    });
  }

  // ---- from governance comparison --------------------------------------
  for (const entry of input.governance_changes ?? []) {
    const changeType = governanceChangeType(entry);
    if (changeType === undefined) {
      if (entry.type !== "unchanged") unsupported.push({ id: entry.id, type: entry.type });
      continue;
    }
    drafts.push({
      id: entry.id,
      change_type: changeType,
      raw_id: entry.entity_id,
      entity_id: entityIdOf(entry.entity_id, before, after),
      entity_type: entityTypeOf(entry.entity_id, before, after, entry.domain_path ?? "entity"),
      summary: entry.detail ?? `${entry.entity_label ?? entry.entity_id}: ${entry.type}.`,
      evidence_refs: [...(entry.evidence_refs ?? evidenceOf(entry.entity_id, before, after))],
    });
  }

  // ---- from resolved governance findings --------------------------------
  //
  // The only honest source of `resolved`. A `GraphChangeSet` cannot express
  // it: two snapshots differing tells you an entity changed, not that a
  // concern somebody raised about it is now closed. That judgement belongs to
  // @rvs/governance-intelligence, and this reads it back rather than deciding
  // it. One entry per (finding, entity) pair, because a finding closing
  // against one of the three entities it named is a different fact from the
  // whole finding closing.
  for (const finding of input.findings ?? []) {
    if (finding.resolved !== true) continue;
    for (const rawId of finding.affected_entity_ids) {
      drafts.push({
        id: buildDerivedChangeId("resolved", `${finding.id}:${rawId}`),
        change_type: "resolved",
        raw_id: rawId,
        entity_id: entityIdOf(rawId, before, after),
        entity_type: entityTypeOf(rawId, before, after, "entity"),
        summary: `A governance finding recorded against this entity is no longer open: ${finding.statement}`,
        evidence_refs: [...(finding.evidence_refs ?? evidenceOf(rawId, before, after))],
      });
    }
  }

  // ---- de-duplicate on id ----------------------------------------------
  //
  // Two entries claiming one id would make the model's order depend on which
  // arrived first. The first by sort order wins and the collision is reported
  // rather than silently resolved.
  const duplicates: string[] = [];
  const byId = new Map<string, DraftChange>();
  for (const draft of [...drafts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (byId.has(draft.id)) {
      duplicates.push(draft.id);
      continue;
    }
    byId.set(draft.id, draft);
  }

  // ---- overlays --------------------------------------------------------
  const findings: ReviewGovernanceFinding[] = (input.findings ?? [])
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      summary: f.statement,
      affected_entity_ids: normalizeIds(f.affected_entity_ids.map((id) => entityIdOf(id, before, after))),
      resolved: f.resolved === true,
      evidence_refs: [...(f.evidence_refs ?? [])],
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const decisionImpacts: ReviewDecisionImpact[] = (input.decision_impacts ?? [])
    .map((d) => ({
      id: d.id,
      decision_entity_id: entityIdOf(d.decision_node_id, before, after),
      state: (d.state as ReviewDecisionImpact["state"]) ?? "unverifiable",
      detail: d.detail,
      subject_entity_ids: normalizeIds([entityIdOf(d.target_entity_node_id, before, after)]),
      evidence_refs: [...(d.evidence_refs ?? [])],
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const findingsByEntity = new Map<string, string[]>();
  const reviewRequiredEntities = new Set<string>();
  for (const finding of findings) {
    for (const entityId of finding.affected_entity_ids) {
      findingsByEntity.set(entityId, [...(findingsByEntity.get(entityId) ?? []), finding.id]);
      if (!finding.resolved && (finding.severity === "blocking" || finding.severity === "review_required")) {
        reviewRequiredEntities.add(entityId);
      }
    }
  }
  const findingRadiusByEntity = new Map<string, string>();
  for (const finding of input.findings ?? []) {
    if (finding.blast_radius === undefined) continue;
    for (const entityId of finding.affected_entity_ids) {
      findingRadiusByEntity.set(entityIdOf(entityId, before, after), finding.blast_radius);
    }
  }

  const decisionsByEntity = new Map<string, string[]>();
  for (const impact of decisionImpacts) {
    for (const entityId of impact.subject_entity_ids) {
      decisionsByEntity.set(entityId, [...(decisionsByEntity.get(entityId) ?? []), impact.decision_entity_id]);
      if (impact.state !== "unaffected") reviewRequiredEntities.add(entityId);
    }
  }

  const linksByEntity = new Map<string, ReviewEntityLink>();
  for (const link of input.entity_links ?? []) {
    linksByEntity.set(entityIdOf(link.entity_id, before, after), link);
  }

  const pathsByEntity = new Map<string, string[]>();
  for (const path of input.impact_paths ?? []) {
    const origin = entityIdOf(path.origin_entity_id, before, after);
    pathsByEntity.set(origin, [...(pathsByEntity.get(origin) ?? []), path.id]);
  }

  // ---- the changes -----------------------------------------------------
  const changes: ReviewChange[] = [...byId.values()]
    .map((draft) => {
      const inBefore = before.byAnyId.has(draft.raw_id) || before.edgeByAnyId.has(draft.raw_id);
      const inAfter = after.byAnyId.has(draft.raw_id) || after.edgeByAnyId.has(draft.raw_id);
      const link = linksByEntity.get(draft.entity_id);
      const governanceIds = normalizeIds(findingsByEntity.get(draft.entity_id) ?? []);
      const decisionIds = normalizeIds(decisionsByEntity.get(draft.entity_id) ?? []);
      const node = after.byAnyId.get(draft.raw_id) ?? before.byAnyId.get(draft.raw_id);
      const edge = after.edgeByAnyId.get(draft.raw_id) ?? before.edgeByAnyId.get(draft.raw_id);
      return {
        id: draft.id,
        change_type: draft.change_type,
        entity_id: draft.entity_id,
        entity_type: draft.entity_type,
        // A counterpart is recorded only where one genuinely exists. An
        // `added` change has no before, and that absence is represented as
        // absence -- never as a synthetic twin invented so the panels look
        // symmetrical.
        ...(inBefore ? { before_entity_id: draft.entity_id } : {}),
        ...(inAfter ? { after_entity_id: draft.entity_id } : {}),
        summary: draft.summary,
        evidence_refs: draft.evidence_refs,
        capability_ids: normalizeIds(link?.capability_ids ?? []),
        product_ids: normalizeIds(link?.product_ids ?? []),
        decision_ids: decisionIds,
        governance_finding_ids: governanceIds,
        impact_path_ids: normalizeIds(pathsByEntity.get(draft.entity_id) ?? []),
        blast_radius: blastRadiusOf(findingRadiusByEntity.get(draft.entity_id)),
        resolution_status: resolutionOf(node?.resolution_status ?? edge?.resolution_status),
        review_required: reviewRequiredEntities.has(draft.entity_id),
      } satisfies ReviewChange;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ---- causal review ---------------------------------------------------
  const evidenceByEntity = new Map<string, readonly VisualEvidenceRef[]>();
  for (const node of [...input.before.nodes, ...input.after.nodes]) {
    if (node.evidence_refs === undefined || node.evidence_refs.length === 0) continue;
    const existing = evidenceByEntity.get(node.source_entity_id) ?? [];
    evidenceByEntity.set(node.source_entity_id, [...existing, ...node.evidence_refs]);
  }
  const causality = classifyCausality({
    changes,
    impact_paths: (input.impact_paths ?? []).map((p) => ({
      ...p,
      origin_entity_id: entityIdOf(p.origin_entity_id, before, after),
      entity_ids: p.entity_ids.map((id) => entityIdOf(id, before, after)),
    })),
    unresolved_links: (input.unresolved_links ?? []).map((l) => ({
      ...l,
      from_entity_id: entityIdOf(l.from_entity_id, before, after),
    })),
    evidence_by_entity: evidenceByEntity,
  });

  const visual = buildUnionModel(input, changes, before, after);

  return {
    from_snapshot_id: input.before.snapshot_id,
    to_snapshot_id: input.after.snapshot_id,
    compatibility: input.compatibility,
    before_entity_ids: beforeEntityIds,
    after_entity_ids: afterEntityIds,
    before_ids: normalizeIds([...beforeEntityIds, ...input.before.edges.map((e) => e.id)]),
    after_ids: normalizeIds([...afterEntityIds, ...input.after.edges.map((e) => e.id)]),
    changes,
    governance_findings: findings,
    decision_impacts: decisionImpacts,
    confirmed_paths: causality.paths,
    unresolved_impacts: causality.unresolved,
    review_required_ids: normalizeIds(changes.filter((c) => c.review_required).map((c) => c.id)),
    unavailable_domains: normalizeIds(input.unavailable_domains ?? []),
    visual,
    input_digest: digestOf({
      before: { id: input.before.snapshot_id, entities: beforeEntityIds },
      after: { id: input.after.snapshot_id, entities: afterEntityIds },
      compatibility: input.compatibility,
      changes,
      findings,
      decision_impacts: decisionImpacts,
      paths: causality.paths,
      unresolved: causality.unresolved,
      unavailable: normalizeIds(input.unavailable_domains ?? []),
    }),
    unsupported_change_types: unsupported.sort((a, b) => (a.id < b.id ? -1 : 1)),
    duplicate_change_ids: normalizeIds(duplicates),
  };
}

/**
 * The union of both snapshots, drawn once.
 *
 * Both panels are laid out over this one model and then filtered, which is
 * what makes an unchanged component sit at the same height on both sides.
 * Laying each side out independently would mean the reader has to search for
 * a component before they can tell it did not move -- precisely the question
 * a change review is asking.
 */
function buildUnionModel(
  input: ChangeReviewSourceInput,
  changes: readonly ReviewChange[],
  before: EntityIndex,
  after: EntityIndex,
): VisualGraphModel {
  const focal = new Set(input.focal_entity_ids ?? []);
  const changedEntities = new Set(changes.map((c) => c.entity_id));

  const merged = new Map<string, ReviewSourceNode>();
  // The target snapshot's copy wins where an entity exists on both sides: the
  // review is about what the architecture is *now*, and a label the target
  // updated should read as the target wrote it.
  for (const node of input.before.nodes) merged.set(node.source_entity_id, node);
  for (const node of input.after.nodes) merged.set(node.source_entity_id, node);

  const nodes: VisualNode[] = [...merged.values()].map((n) => ({
    id: n.source_entity_id,
    source_entity_id: n.source_entity_id,
    label: n.label,
    kind: n.node_type,
    emphasis: focal.has(n.source_entity_id) || focal.has(n.id)
      ? "focal"
      : changedEntities.has(n.source_entity_id)
        ? "primary"
        : "normal",
    resolution: visualResolution(n.resolution_status),
    confidence: visualConfidence(n.confidence),
    evidence_refs: [...(n.evidence_refs ?? [])],
  }));

  const drawn = new Set(nodes.map((n) => n.id));
  const mergedEdges = new Map<string, ReviewSourceEdge>();
  for (const edge of input.before.edges) mergedEdges.set(edge.id, edge);
  for (const edge of input.after.edges) mergedEdges.set(edge.id, edge);

  const endpointOf = (nodeId: string): string | undefined =>
    (before.byAnyId.get(nodeId) ?? after.byAnyId.get(nodeId))?.source_entity_id;

  const edges: VisualEdge[] = [...mergedEdges.values()]
    .map((e): VisualEdge | undefined => {
      const from = endpointOf(e.from_node_id);
      const to = endpointOf(e.to_node_id);
      if (from === undefined || to === undefined || !drawn.has(from) || !drawn.has(to)) return undefined;
      return {
        id: e.id,
        from_id: from,
        to_id: to,
        kind: e.edge_type,
        emphasis: changedEntities.has(e.id) ? "primary" : "normal",
        resolution: visualResolution(e.resolution_status),
        // Cycles are an upstream fact. This builder was not told about one,
        // so it says nothing rather than running its own detection and
        // calling the answer evidence.
        in_cycle: false,
        evidence_refs: [],
      };
    })
    .filter((e): e is VisualEdge => e !== undefined);

  const edgeIds = new Set(edges.map((e) => e.id));
  const visualChanges: VisualChange[] = changes
    .filter((c) => drawn.has(c.entity_id) || edgeIds.has(c.entity_id))
    .map((c) => ({
      id: c.id,
      kind: VISUAL_KIND[c.change_type],
      subject_id: c.entity_id,
      subject_type: edgeIds.has(c.entity_id) ? ("edge" as const) : ("node" as const),
      detail: c.summary,
      evidence_refs: c.evidence_refs,
    }));

  return normalizeVisualGraphModel({
    ...emptyVisualGraphModel(),
    nodes,
    edges,
    changes: visualChanges,
  });
}
