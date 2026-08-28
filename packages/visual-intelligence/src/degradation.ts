import type {
  CollapsedGroup,
  DetailMode,
  FidelityReasonCode,
  FidelityReceipt,
  SplitView,
  VisualGrammar,
} from "./contracts.js";
import { budgetFor } from "./budgets.js";
import {
  normalizeVisualGraphModel,
  type VisualEdge,
  type VisualGraphModel,
  type VisualNode,
  type VisualPlaceholder,
} from "./data-model.js";
import { buildFidelityReceipt } from "./fidelity.js";
import { buildCollapsedGroupId, buildSplitViewId, buildVisualEdgeId, normalizeIds } from "./ids.js";

// The central degradation policy.
//
// This file is the *only* place in RVS that decides what a view may stop
// showing. A grammar renderer never makes that decision independently -- if
// it could, "the executive deck quietly dropped the blocking finding because
// the box did not fit" would be a bug nobody could find. Everything a
// renderer receives has already been through here, and everything this
// produces comes with a fidelity receipt naming what went where.

/** The ordered preservation/reduction codes. Rank is the priority: rank 1 is preserved first and reduced last. */
export type DegradationCode =
  | "VISUAL_PRESERVE_FOCAL"
  | "VISUAL_PRESERVE_PRIMARY_PATH"
  | "VISUAL_PRESERVE_CHANGE_SUBJECT"
  | "VISUAL_PRESERVE_BLOCKING_FINDING"
  | "VISUAL_PRESERVE_REVIEW_REQUIRED_FINDING"
  | "VISUAL_PRESERVE_DECISION_LINKED"
  | "VISUAL_PRESERVE_UNRESOLVED"
  | "VISUAL_PRESERVE_TRUST_BOUNDARY"
  | "VISUAL_PRESERVE_ENTRY_POINT"
  | "VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT"
  | "VISUAL_COLLAPSE_LOW_VALUE_LEAF"
  | "VISUAL_HIDE_NON_CRITICAL"
  | "VISUAL_SPLIT_BEFORE_SHRINK";

export interface DegradationRule {
  rank: number;
  code: DegradationCode;
  /** `entity` rules classify a single node; `strategy` rules order the passes rather than label a node. */
  scope: "entity" | "strategy";
  description: string;
}

/**
 * The policy, in priority order. Published as data (not as control flow) so
 * docs/adaptive-detail.md, the validator, and the tests all read the same
 * table rather than three restatements of it.
 */
export const DEGRADATION_POLICY: readonly DegradationRule[] = [
  { rank: 1, code: "VISUAL_PRESERVE_FOCAL", scope: "entity", description: "Entities the reader explicitly asked about are never collapsed, split away, or hidden." },
  { rank: 2, code: "VISUAL_PRESERVE_PRIMARY_PATH", scope: "entity", description: "Every node on a path upstream marked critical survives intact." },
  { rank: 3, code: "VISUAL_PRESERVE_CHANGE_SUBJECT", scope: "entity", description: "Entities a change in this model is about are preserved: a view carrying changes is about them, and one that reduced them away would be reporting a change nobody can see." },
  { rank: 4, code: "VISUAL_PRESERVE_BLOCKING_FINDING", scope: "entity", description: "Blocking governance findings are preserved; layout never downgrades a severity." },
  { rank: 5, code: "VISUAL_PRESERVE_REVIEW_REQUIRED_FINDING", scope: "entity", description: "Review-required governance findings are preserved for the same reason." },
  { rank: 6, code: "VISUAL_PRESERVE_DECISION_LINKED", scope: "entity", description: "Entities carrying a decision status stay visible so decision context is never lost to layout." },
  { rank: 7, code: "VISUAL_PRESERVE_UNRESOLVED", scope: "entity", description: "Unresolved and partially-resolved entities stay visible: the reader must be able to see the picture is incomplete." },
  { rank: 8, code: "VISUAL_PRESERVE_TRUST_BOUNDARY", scope: "entity", description: "Members of a declared trust/security boundary are preserved so a boundary crossing is never hidden." },
  { rank: 9, code: "VISUAL_PRESERVE_ENTRY_POINT", scope: "entity", description: "Externally visible entry points are preserved so the view keeps a way in." },
  { rank: 10, code: "VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT", scope: "entity", description: "Implementation nodes with an identical kind, container, and neighbour signature collapse into one disclosed cluster." },
  { rank: 11, code: "VISUAL_COLLAPSE_LOW_VALUE_LEAF", scope: "entity", description: "Degree-<=1 supporting leaves within one container collapse into one disclosed cluster." },
  { rank: 12, code: "VISUAL_HIDE_NON_CRITICAL", scope: "entity", description: "Only after every collapse opportunity and every container-shaped split is exhausted may an ordinary entity be hidden, and only with a receipt entry naming it." },
  { rank: 13, code: "VISUAL_SPLIT_BEFORE_SHRINK", scope: "strategy", description: "When content cannot fit a readable budget, produce an overview plus detail views: along real containers before anything is hidden, and as sequential pages for whatever protection forbids hiding. Type size is never reduced." },
];

/**
 * The pass order `adaptVisualModel` runs, published so documentation and
 * tests read the order rather than restate it.
 *
 * Splitting appears twice, and the two occurrences are not the same move.
 * Splitting along a real container is meaning-preserving -- "Architecture --
 * Authentication detail" is a view a reader can ask for by name -- so it runs
 * before anything is hidden. Splitting into sequential pages is not: a page
 * boundary says nothing about the architecture. Paging is therefore the last
 * resort, reached only for entities policy forbids hiding, because a reader
 * is better served by a disclosed omission of a low-value leaf than by two
 * hundred pages carrying no structure.
 */
export const DEGRADATION_PASS_ORDER: readonly DegradationCode[] = [
  "VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT",
  "VISUAL_COLLAPSE_LOW_VALUE_LEAF",
  "VISUAL_SPLIT_BEFORE_SHRINK",
  "VISUAL_HIDE_NON_CRITICAL",
  "VISUAL_SPLIT_BEFORE_SHRINK",
];

/** Node kinds that are externally visible entry points. Generic architectural vocabulary echoed from @rvs/knowledge-graph's `KnowledgeNodeType`; never a repository's own names. */
const ENTRY_POINT_KINDS = new Set(["runtime_entrypoint", "command", "product"]);

export interface AdaptationInput {
  spec_id: string;
  model: VisualGraphModel;
  grammar: VisualGrammar;
  detail_mode: DetailMode;
  /** Entities the reader explicitly directed attention to. */
  focal_entity_ids?: readonly string[];
  /**
   * Whether this view may produce detail views. `false` only where the
   * delivery surface genuinely cannot carry more than one view; it is never
   * set false to "keep the deck short", because that trades disclosure for
   * brevity, which is the trade this policy exists to forbid.
   */
  allow_split?: boolean;
}

export interface AdaptedView {
  id: string;
  label: string;
  model: VisualGraphModel;
}

export interface AdaptationResult {
  /** The primary view after adaptation. */
  model: VisualGraphModel;
  /** Detail views produced by the split-before-shrink rule, in deterministic order. */
  splits: AdaptedView[];
  receipt: FidelityReceipt;
}

interface Classified {
  node: VisualNode;
  rank: number;
  code: DegradationCode;
  degree: number;
  /** True when some change in this model names this node as its subject. */
  changed: boolean;
}

function classify(
  node: VisualNode,
  focal: ReadonlySet<string>,
  criticalNodes: ReadonlySet<string>,
  changeSubjects: ReadonlySet<string>,
  boundaryMembers: ReadonlySet<string>,
  degree: number,
): Classified {
  const changed = changeSubjects.has(node.id) || changeSubjects.has(node.source_entity_id);
  const pick = (rank: number, code: DegradationCode): Classified => ({ node, rank, code, degree, changed });
  if (focal.has(node.source_entity_id) || focal.has(node.id) || node.emphasis === "focal") {
    return pick(1, "VISUAL_PRESERVE_FOCAL");
  }
  if (criticalNodes.has(node.id)) return pick(2, "VISUAL_PRESERVE_PRIMARY_PATH");
  // Rank 3, above every finding and every decision, and only ever reached by
  // a model that actually carries changes. The failure it forecloses is a
  // change view that reduced away the very entities it was drawn to report:
  // a reader looking at eight stand-ins and no changed component has been
  // shown a summary of a diff rather than a diff. Views with no changes are
  // untouched -- `changeSubjects` is empty and this branch never fires.
  if (changed) return pick(3, "VISUAL_PRESERVE_CHANGE_SUBJECT");
  if (node.severity === "blocking") return pick(4, "VISUAL_PRESERVE_BLOCKING_FINDING");
  if (node.severity === "review_required") return pick(5, "VISUAL_PRESERVE_REVIEW_REQUIRED_FINDING");
  if (node.decision_status !== undefined) return pick(6, "VISUAL_PRESERVE_DECISION_LINKED");
  if (node.resolution !== "resolved") return pick(7, "VISUAL_PRESERVE_UNRESOLVED");
  if (boundaryMembers.has(node.id)) return pick(8, "VISUAL_PRESERVE_TRUST_BOUNDARY");
  if (ENTRY_POINT_KINDS.has(node.kind)) return pick(9, "VISUAL_PRESERVE_ENTRY_POINT");
  if (degree <= 1 && (node.emphasis === "supporting" || node.emphasis === "normal")) {
    return pick(11, "VISUAL_COLLAPSE_LOW_VALUE_LEAF");
  }
  return pick(12, "VISUAL_HIDE_NON_CRITICAL");
}

/**
 * Where an entity stands in the queue for the seats a view holds back.
 *
 * Deliberately not the classification rank, which answers a different
 * question. Rank asks "what must survive?" and puts unresolved references and
 * open findings near the front, because losing them silently is the failure
 * that matters there. Anchoring asks "what is this view *about*?", and an
 * overview whose only named boxes are two unresolved actor references has
 * survived its budget without orienting anybody.
 *
 * So entry points -- the product, the commands, the runtime entrypoints --
 * come third, behind only what the reader named and the primary path. They
 * are the way in. Everything after them keeps policy order, and nothing here
 * makes an entity *safe*: a finding that loses an anchor seat is still rank 3
 * and still cannot be hidden.
 */
function anchorPriority(entry: Classified, hasChanges: boolean): number {
  if (entry.rank <= 2) return entry.rank;
  const entryPoint = ENTRY_POINT_KINDS.has(entry.node.kind);
  if (!hasChanges) return entryPoint ? 3 : 3 + entry.rank;
  // A view carrying changes is about the changes, so the queue re-forms
  // around them: the way in that changed comes first, then everything else
  // that changed, then the unchanged way in, then policy order. Note what
  // this does *not* do -- an unchanged entry point still anchors ahead of an
  // unchanged blocking finding, because it still orients; it simply no longer
  // outranks the changes the reader opened the view to see.
  if (entryPoint && entry.changed) return 3;
  if (entry.changed) return 4;
  if (entryPoint) return 5;
  return 5 + entry.rank;
}

/**
 * Whether this entity orients a reader, rather than merely outranking its
 * neighbours.
 *
 * The distinction only matters when the budget cannot be met at all, and then
 * it matters a great deal. Naming four of sixty interchangeable unresolved
 * references orients nobody and costs half the view again in overflow; naming
 * the product and its entrypoint is the difference between a map and an
 * index. So the first three anchor priorities -- what the reader named, the
 * primary path, and the way in -- are what an overflowing view holds on to.
 */
function isOrienting(entry: Classified, hasChanges: boolean): boolean {
  return anchorPriority(entry, hasChanges) <= 3;
}

/** Ranks 1-9 are protected: never collapsed away, never hidden. */
function isProtected(rank: number): boolean {
  return rank <= 9;
}

/**
 * Whether an entity may be moved into a detail view.
 *
 * Splitting is not losing: the entity is still drawn, still at full detail,
 * and the primary view names where it went. So a protected entity may be
 * relocated even though it may never be hidden -- with two exceptions.
 * Focal entities (rank 1) are what the reader asked about and must be in the
 * view they are looking at, and primary-path nodes (rank 2) must stay
 * together or the route is drawn in pieces that join up nowhere.
 */
function isRelocatable(rank: number): boolean {
  return rank > 2;
}

function degreeMap(edges: readonly VisualEdge[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.from_id, (degrees.get(edge.from_id) ?? 0) + 1);
    degrees.set(edge.to_id, (degrees.get(edge.to_id) ?? 0) + 1);
  }
  return degrees;
}

/**
 * The structural-equivalence signature.
 *
 * Two nodes are structurally equivalent when they have the same kind, the
 * same container, and *the same neighbours* -- the same actual node ids
 * inbound and outbound, over the same relationship kinds. Seven middleware
 * nodes all hanging off one component qualify; collapsing them loses only
 * cardinality, which the receipt restores by naming every member.
 *
 * Neighbour *identity* is the load-bearing part. An earlier version matched
 * on neighbour *kinds*, which in a homogeneous graph makes every interior
 * node of a dependency chain look alike -- a 58-hop path would have
 * collapsed into a single box labelled "58 component nodes", destroying the
 * very structure the diagram exists to show. Nodes are merged only when they
 * are genuinely interchangeable in the graph, never merely similar-looking.
 *
 * Computed from edges and kinds, never from label text: two nodes whose
 * labels resemble each other are not equivalent and are never merged.
 */
function equivalenceSignature(node: VisualNode, edges: readonly VisualEdge[]): string {
  const inbound: string[] = [];
  const outbound: string[] = [];
  for (const edge of edges) {
    if (edge.to_id === node.id) inbound.push(`${edge.kind}<${edge.from_id}`);
    if (edge.from_id === node.id) outbound.push(`${edge.kind}>${edge.to_id}`);
  }
  return JSON.stringify([
    node.kind,
    node.group_id ?? "",
    node.emphasis,
    normalizeIds(inbound),
    normalizeIds(outbound),
  ]);
}

function pluralLabel(count: number, kind: string, container: string | undefined): string {
  const where = container ? ` in ${container}` : "";
  return `${count} ${kind} nodes${where}`;
}

/**
 * Reduces a model to fit its grammar's readable budget, disclosing every
 * reduction.
 *
 * Pass order is `DEGRADATION_PASS_ORDER`: protect, collapse
 * structurally-equivalent detail, collapse low-value leaves, split along real
 * containers, hide ordinary entities, and finally page whatever protection
 * forbids hiding. Type size is never reduced -- shrinking is not one of the
 * moves available here, by design.
 *
 * Two passes sit around those and reduce no content, which is why neither
 * carries a degradation code. An anchor floor holds real entities back from
 * every pass above, because "are there few enough boxes?" is a question a
 * page of signposts can answer; and merging stand-ins finds the room that
 * costs by coarsening the signposts instead of spending an entity.
 */
export function adaptVisualModel(input: AdaptationInput): AdaptationResult {
  const model = normalizeVisualGraphModel(input.model);
  const budget = budgetFor(input.grammar, input.detail_mode);
  const focal = new Set(normalizeIds(input.focal_entity_ids ?? []));
  const allowSplit = input.allow_split ?? true;

  const criticalNodes = new Set<string>();
  for (const path of model.paths) {
    if (path.critical) for (const id of path.node_ids) criticalNodes.add(id);
  }
  const boundaryMembers = new Set<string>();
  for (const boundary of model.boundaries) for (const id of boundary.member_ids) boundaryMembers.add(id);

  // Change subjects come from the model's own change list, which every
  // pre-10.4 model leaves empty -- so this is inert for every grammar that
  // does not carry changes, and no existing view's adaptation moves.
  const changeSubjects = new Set<string>();
  for (const change of model.changes) changeSubjects.add(change.subject_id);
  const hasChanges = changeSubjects.size > 0;

  const degrees = degreeMap(model.edges);
  const classified = model.nodes.map((node) =>
    classify(node, focal, criticalNodes, changeSubjects, boundaryMembers, degrees.get(node.id) ?? 0),
  );
  const rankOf = new Map(classified.map((c) => [c.node.id, c] as const));

  const sourceEntityIds = model.nodes.map((n) => n.source_entity_id);
  const sourceEdgeIds = model.edges.map((e) => e.id);

  const reasonCodes = new Set<FidelityReasonCode>();
  const collapsedGroups: CollapsedGroup[] = [];
  const splitViews: SplitView[] = [];
  const splitModels: AdaptedView[] = [];
  const removed = new Set<string>(); // node ids no longer drawn in the primary view
  const hidden = new Set<string>();
  const placeholders: Array<{ node: VisualNode; member_ids: string[] }> = [];

  /**
   * Records a collapsed group and leaves a stand-in for it in the primary
   * view.
   *
   * Every pass that removes a set of entities goes through here, so the
   * receipt entry and the visible trace are created together and cannot
   * drift apart -- a disclosure the reader can only find by opening the JSON
   * is not a disclosure the drawing makes.
   */
  const collapseInto = (
    group: CollapsedGroup,
    memberNodeIds: readonly string[],
    splitViewId?: string,
  ): void => {
    collapsedGroups.push(group);
    const placeholder: VisualPlaceholder = {
      collapsed_group_id: group.id,
      split_view_id: splitViewId,
      entity_count: group.source_entity_ids.length,
      source_entity_ids: normalizeIds(group.source_entity_ids),
    };
    const members = memberNodeIds
      .map((id) => rankOf.get(id)?.node)
      .filter((n): n is VisualNode => n !== undefined);
    placeholders.push({
      node: {
        id: group.id,
        source_entity_id: group.id,
        label: group.display_label,
        kind: "cluster",
        emphasis: "supporting",
        // A stand-in inherits the least-resolved state of what it stands for.
        // Reporting a group of twelve as "resolved" because eleven of them
        // are would hide the one thing the reader most needs to follow up.
        resolution: members.some((m) => m.resolution === "unresolved")
          ? "unresolved"
          : members.some((m) => m.resolution === "partial")
            ? "partial"
            : "resolved",
        confidence: members.some((m) => m.confidence === "unverifiable")
          ? "unverifiable"
          : members.some((m) => m.confidence === "qualified")
            ? "qualified"
            : "confirmed",
        placeholder_for: placeholder,
        evidence_refs: [],
      },
      member_ids: [...memberNodeIds],
    });
    for (const id of memberNodeIds) removed.add(id);
  };

  // Placeholders occupy the view, so they count against the budget. Ignoring
  // them would let a split "succeed" by replacing twelve boxes with a
  // thirteenth nobody had budgeted for.
  const remaining = () => model.nodes.length - removed.size + placeholders.length;

  const withinNodeBudget = () => remaining() <= budget.max_nodes;
  const fits = withinNodeBudget() && model.edges.length <= budget.max_edges;

  /**
   * Entities the primary view keeps whatever the budget costs.
   *
   * Reduction that is only ever asked "are there few enough boxes?" can
   * answer yes with a view made entirely of stand-ins: every pass below
   * removes real entities and leaves a signpost, and a page of signposts
   * satisfies a count. It satisfies nothing else. A reader opening an
   * architecture overview to find eight dashed boxes reading "12 components"
   * has been handed a table of contents and told it is a diagram -- they
   * cannot name a single thing the system contains.
   *
   * So a floor of the highest-priority entities is held back from every pass.
   * Half the view, rounded down, is the most a view may spend on signposts.
   */
  const anchorFloor = Math.max(1, Math.floor(budget.max_nodes / 2));
  const anchorOrder = [...classified]
    .sort((a, b) => {
      const pa = anchorPriority(a, hasChanges);
      const pb = anchorPriority(b, hasChanges);
      // Ties go to the best-connected entity: an anchor nothing points at
      // anchors nothing.
      return pa !== pb ? pa - pb : b.degree !== a.degree ? b.degree - a.degree : a.node.id < b.node.id ? -1 : 1;
    })
    .slice(0, anchorFloor)
    .map((c) => c.node.id);
  const anchors = new Set(anchorOrder);

  // ---- Pass 1: structural equivalence -----------------------------------
  if (!fits) {
    reasonCodes.add("FIDELITY_NODE_BUDGET_EXCEEDED");
    const buckets = new Map<string, Classified[]>();
    for (const entry of classified) {
      if (isProtected(entry.rank) || anchors.has(entry.node.id)) continue;
      const signature = equivalenceSignature(entry.node, model.edges);
      const bucket = buckets.get(signature);
      if (bucket) bucket.push(entry);
      else buckets.set(signature, [entry]);
    }
    // Largest buckets first (they buy the most headroom), ties by the
    // lowest member id so the order never depends on Map insertion order.
    const ordered = Array.from(buckets.values())
      .filter((b) => b.length >= 2)
      .sort((a, b) => {
        if (b.length !== a.length) return b.length - a.length;
        const aKey = normalizeIds(a.map((x) => x.node.id))[0];
        const bKey = normalizeIds(b.map((x) => x.node.id))[0];
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
    for (const bucket of ordered) {
      if (withinNodeBudget()) break;
      const memberSourceIds = normalizeIds(bucket.map((b) => b.node.source_entity_id));
      const groupLabel = model.groups.find((g) => g.id === bucket[0].node.group_id)?.label;
      collapseInto(
        {
          id: buildCollapsedGroupId(input.spec_id, "FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED", memberSourceIds),
          display_label: pluralLabel(bucket.length, bucket[0].node.kind, groupLabel),
          source_entity_ids: memberSourceIds,
          reason: "FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED",
          selection_policy: "synthetic-group-label",
        },
        bucket.map((b) => b.node.id),
      );
      reasonCodes.add("FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED");
    }
  }

  // ---- Pass 2: low-value leaves -----------------------------------------
  if (!withinNodeBudget()) {
    const leafBuckets = new Map<string, Classified[]>();
    for (const entry of classified) {
      if (removed.has(entry.node.id) || anchors.has(entry.node.id)) continue;
      if (entry.code !== "VISUAL_COLLAPSE_LOW_VALUE_LEAF") continue;
      const key = `${entry.node.group_id ?? ""}|${entry.node.kind}`;
      const bucket = leafBuckets.get(key);
      if (bucket) bucket.push(entry);
      else leafBuckets.set(key, [entry]);
    }
    const ordered = Array.from(leafBuckets.entries())
      .filter(([, b]) => b.length >= 2)
      .sort((a, b) => (b[1].length !== a[1].length ? b[1].length - a[1].length : a[0] < b[0] ? -1 : 1));
    for (const [key, bucket] of ordered) {
      if (withinNodeBudget()) break;
      const memberSourceIds = normalizeIds(bucket.map((b) => b.node.source_entity_id));
      const containerLabel = model.groups.find((g) => g.id === key.split("|")[0])?.label;
      collapseInto(
        {
          id: buildCollapsedGroupId(input.spec_id, "FIDELITY_LOW_VALUE_LEAF_COLLAPSED", memberSourceIds),
          display_label: pluralLabel(bucket.length, bucket[0].node.kind, containerLabel),
          source_entity_ids: memberSourceIds,
          reason: "FIDELITY_LOW_VALUE_LEAF_COLLAPSED",
          selection_policy: "synthetic-group-label",
        },
        bucket.map((b) => b.node.id),
      );
      reasonCodes.add("FIDELITY_LOW_VALUE_LEAF_COLLAPSED");
    }
  }

  // ---- Pass 3: split before shrink --------------------------------------
  if (!withinNodeBudget() && allowSplit) {
    // Split along containers upstream already established. Splitting along a
    // container is meaning-preserving ("Architecture -- Authentication
    // detail"); splitting along an arbitrary chunk boundary is not, so it is
    // only used below when no container is available.
    const candidates = model.groups
      .filter((g) => !g.synthetic)
      .map((g) => ({
        group: g,
        movable: g.member_ids.filter(
          (id) => !removed.has(id) && !anchors.has(id) && isRelocatable(rankOf.get(id)?.rank ?? 11),
        ),
      }))
      .filter((c) => c.movable.length >= 2)
      .sort((a, b) =>
        b.movable.length !== a.movable.length
          ? b.movable.length - a.movable.length
          : a.group.id < b.group.id
            ? -1
            : 1,
      );

    for (const candidate of candidates) {
      if (withinNodeBudget()) break;
      const memberIds = normalizeIds(candidate.movable);
      const memberSourceIds = normalizeIds(
        memberIds.map((id) => rankOf.get(id)?.node.source_entity_id ?? id),
      );
      const view: SplitView = {
        id: buildSplitViewId(input.spec_id, candidate.group.id),
        display_label: `${candidate.group.label} — detail`,
        entity_ids: memberSourceIds,
        reason: "FIDELITY_SPLIT_INTO_VIEWS",
      };
      splitViews.push(view);
      // Disclosed twice, deliberately: the primary view's receipt says these
      // entities were collapsed out of it, and the split view says where they
      // went. Neither statement alone is complete.
      collapseInto(
        {
          id: buildCollapsedGroupId(input.spec_id, "FIDELITY_SPLIT_INTO_VIEWS", memberSourceIds),
          display_label: `${candidate.group.label} (${memberSourceIds.length} in a detail view)`,
          source_entity_ids: memberSourceIds,
          reason: "FIDELITY_SPLIT_INTO_VIEWS",
          selection_policy: "synthetic-group-label",
        },
        memberIds,
        view.id,
      );
      reasonCodes.add("FIDELITY_SPLIT_INTO_VIEWS");
      const memberSet = new Set(memberIds);
      splitModels.push({
        id: view.id,
        label: view.display_label,
        model: subsetModel(model, (node) => memberSet.has(node.id)),
      });
    }
  }

  // ---- Pass 4: hide, last resort ----------------------------------------
  if (!withinNodeBudget()) {
    const hideable = classified
      .filter((c) => !removed.has(c.node.id) && !isProtected(c.rank) && !anchors.has(c.node.id))
      // Lowest priority first; within a rank, least-connected first (it costs
      // the reader the least structure); ties by id so the order is total.
      .sort((a, b) =>
        b.rank !== a.rank ? b.rank - a.rank : a.degree !== b.degree ? a.degree - b.degree : a.node.id < b.node.id ? -1 : 1,
      );
    for (const entry of hideable) {
      if (withinNodeBudget()) break;
      hidden.add(entry.node.source_entity_id);
      removed.add(entry.node.id);
      reasonCodes.add(
        entry.code === "VISUAL_COLLAPSE_LOW_VALUE_LEAF"
          ? "FIDELITY_LOW_VALUE_LEAF_HIDDEN"
          : "FIDELITY_NON_FOCAL_HIDDEN",
      );
    }
  }

  // ---- Pass 5: coarsen the signposts rather than the content -------------
  //
  // The anchors held back above are why this pass exists: keeping them can
  // leave the view over budget, and the honest place to find the missing
  // room is the stand-ins themselves. Merging two signposts reading "4
  // components" and "5 components" into one reading "9 entities in 2
  // collapsed groups" costs the reader granularity in the *disclosure*. It
  // costs them no entity: the receipt still names all nine, and they were
  // already undrawn either way. Removing a real entity to make room for a
  // signpost would be the trade the other way round, and it is the trade
  // this pass exists to stop.
  //
  // Only stand-ins for pure collapses are merged. One that points at a
  // detail view is the reader's only route to where those entities went, and
  // folding it into a general group would break that route.
  if (!withinNodeBudget() && placeholders.length >= 2) {
    const mergeable = placeholders
      .filter((p) => p.node.placeholder_for?.split_view_id === undefined)
      // Fewest entities first: coarsening two small groups blurs a smaller
      // part of the picture than coarsening the two largest.
      .sort((a, b) => {
        const ca = a.node.placeholder_for?.entity_count ?? 0;
        const cb = b.node.placeholder_for?.entity_count ?? 0;
        return ca !== cb ? ca - cb : a.node.id < b.node.id ? -1 : 1;
      });
    // Merging k stand-ins into one frees k-1 slots.
    const deficit = remaining() - budget.max_nodes;
    const take = Math.min(mergeable.length, deficit + 1);
    if (take >= 2) {
      const chosen = mergeable.slice(0, take);
      const chosenIds = new Set(chosen.map((p) => p.node.id));
      const memberIds = normalizeIds(chosen.flatMap((p) => p.member_ids));
      const memberSourceIds = normalizeIds(
        chosen.flatMap((p) => p.node.placeholder_for?.source_entity_ids ?? []),
      );
      // The constituents leave both the receipt and the view together. A
      // collapsed group with no stand-in on the page would be a disclosure
      // pointing at a box that is not there.
      for (let i = collapsedGroups.length - 1; i >= 0; i--) {
        if (chosenIds.has(collapsedGroups[i].id)) collapsedGroups.splice(i, 1);
      }
      for (let i = placeholders.length - 1; i >= 0; i--) {
        if (chosenIds.has(placeholders[i].node.id)) placeholders.splice(i, 1);
      }
      collapseInto(
        {
          id: buildCollapsedGroupId(input.spec_id, "FIDELITY_STAND_INS_MERGED", memberSourceIds),
          display_label: `${memberSourceIds.length} entities in ${chosen.length} collapsed groups`,
          source_entity_ids: memberSourceIds,
          reason: "FIDELITY_STAND_INS_MERGED",
          selection_policy: "synthetic-group-label",
        },
        memberIds,
      );
      reasonCodes.add("FIDELITY_STAND_INS_MERGED");
    }
  }

  // ---- Pass 6: residual split, when protection alone overflows the view ---
  if (!withinNodeBudget() && allowSplit) {
    // Reached when what policy refuses to hide -- unresolved entities,
    // blocking findings, decision-linked nodes -- exceeds the budget on its
    // own. Overflowing the view would violate readability; hiding them is
    // forbidden; so they are paged into sequential detail views. A page
    // boundary carries no meaning, which is why this runs only after
    // container-shaped splitting has already taken what it can.
    const relocatable = classified
      .filter((c) => !removed.has(c.node.id) && isRelocatable(c.rank))
      .sort((a, b) => (a.node.id < b.node.id ? -1 : 1));

    // Each page leaves a stand-in behind, and stand-ins occupy the view, so
    // the number of pages is part of what has to fit. Solving
    // `keep + pages(keep) <= budget` by search rather than arithmetic because
    // the relationship is a step function: one more entity kept can cost a
    // whole extra page, and one fewer can save one.
    const planFor = (released: ReadonlySet<string>) => {
      const overflow = relocatable.filter((c) => !anchors.has(c.node.id) || released.has(c.node.id));
      const resident = remaining() - overflow.length;
      for (let candidate = Math.min(budget.max_nodes, overflow.length); candidate >= 0; candidate--) {
        const pages = Math.ceil((overflow.length - candidate) / budget.max_nodes);
        if (resident + candidate + pages <= budget.max_nodes) return { overflow, keep: candidate };
      }
      return undefined;
    };

    // An anchor is paged only when arithmetic leaves no alternative, and the
    // least important one goes first. The floor is a preference the budget
    // can overrule, not a promise the budget cannot keep: with sixty
    // protected entities and eight slots, every slot is needed to point at a
    // page, and a view that overflowed to keep one name would be unreadable
    // *and* incomplete. Paging is the one reduction that loses nothing --
    // every paged entity is still drawn, at full detail, in a view the
    // primary one names -- which is why it is the pass allowed to spend them.
    let plan = planFor(new Set<string>());
    let released = 0;
    for (let release = 1; plan === undefined && release <= anchorOrder.length; release++) {
      plan = planFor(new Set(anchorOrder.slice(anchorOrder.length - release)));
      released = release;
    }
    // Say so when it happens. The floor is the strongest promise this policy
    // makes, and the only honest way to overrule it is out loud.
    if (plan !== undefined && released > 0) reasonCodes.add("FIDELITY_ANCHOR_RELEASED");
    // When no release fits either, the view overflows whatever this pass
    // does, so the question stops being "what fits" and becomes "what is
    // worth overflowing for". Only the orienting anchors are: a view that is
    // both over budget and unable to name what the system is has failed on
    // both axes, while a view over budget by two boxes that opens at the
    // product is merely over budget, and `limits_hit` says so.
    //
    // Plus, in a view that carries changes, one changed entity -- and exactly
    // one. `isOrienting` was written for an overview, where the way in and the
    // primary path are what a reader needs to get their bearings; a change
    // view has a different centre, and a delta of forty anonymous services
    // holds nothing that qualifies. Reduced to signposts alone it says a
    // number of things changed and does not name one of them, which is the
    // failure rank 3 exists to foreclose. One box costs one box of overflow
    // and turns a table of contents back into a diff.
    const heldOnOverflow = new Set(
      relocatable.filter((c) => anchors.has(c.node.id) && isOrienting(c, hasChanges)).map((c) => c.node.id),
    );
    if (plan === undefined && hasChanges && heldOnOverflow.size === 0) {
      const changedAnchor = anchorOrder.find((id) => relocatable.some((c) => c.node.id === id && c.changed));
      if (changedAnchor !== undefined) heldOnOverflow.add(changedAnchor);
    }
    const { overflow, keep } = plan ?? {
      overflow: relocatable.filter((c) => !heldOnOverflow.has(c.node.id)),
      keep: 0,
    };
    const paged = overflow.slice(keep);
    for (let start = 0; start < paged.length; start += budget.max_nodes) {
      const page = paged.slice(start, start + budget.max_nodes);
      const memberIds = normalizeIds(page.map((c) => c.node.id));
      const memberSourceIds = normalizeIds(page.map((c) => c.node.source_entity_id));
      const pageNumber = Math.floor(start / budget.max_nodes) + 1;
      const view: SplitView = {
        id: buildSplitViewId(input.spec_id, `overflow-${String(pageNumber).padStart(3, "0")}`),
        display_label: `Continued (${pageNumber})`,
        entity_ids: memberSourceIds,
        reason: "FIDELITY_SPLIT_INTO_VIEWS",
      };
      splitViews.push(view);
      collapseInto(
        {
          id: buildCollapsedGroupId(input.spec_id, "FIDELITY_SPLIT_INTO_VIEWS", memberSourceIds),
          display_label: `${page.length} entities (shown in a detail view)`,
          source_entity_ids: memberSourceIds,
          reason: "FIDELITY_SPLIT_INTO_VIEWS",
          selection_policy: "synthetic-group-label",
        },
        memberIds,
        view.id,
      );
      reasonCodes.add("FIDELITY_SPLIT_INTO_VIEWS");
      const memberSet = new Set(memberIds);
      splitModels.push({
        id: view.id,
        label: view.display_label,
        model: subsetModel(model, (node) => memberSet.has(node.id)),
      });
    }
  }

  // ---- Assemble the primary view ----------------------------------------
  //
  // The receipt is built from the *real* entities only. Placeholders are
  // added afterwards, so a stand-in can never be counted as a preserved
  // entity -- a view claiming credit for drawing something that does not
  // exist is the one lie a fidelity receipt exists to make impossible.
  let primary = subsetModel(model, (node) => !removed.has(node.id));

  const limitsHit: FidelityReasonCode[] = [];
  if (!withinNodeBudget()) limitsHit.push("FIDELITY_NODE_BUDGET_EXCEEDED");

  if (primary.edges.length > budget.max_edges) {
    // Edge reduction is the last thing attempted and is always disclosed:
    // an over-budget edge set is truncated by dropping the least-emphasised
    // edges first, never by thinning strokes or shrinking labels.
    limitsHit.push("FIDELITY_EDGE_BUDGET_EXCEEDED");
    reasonCodes.add("FIDELITY_EDGE_BUDGET_EXCEEDED");
    const emphasisRank: Record<string, number> = { focal: 0, primary: 1, normal: 2, supporting: 3, muted: 4 };
    const keep = [...primary.edges]
      .sort((a, b) => {
        const ea = emphasisRank[a.emphasis] ?? 2;
        const eb = emphasisRank[b.emphasis] ?? 2;
        return ea !== eb ? ea - eb : a.id < b.id ? -1 : 1;
      })
      .slice(0, budget.max_edges);
    const keepIds = new Set(keep.map((e) => e.id));
    primary = { ...primary, edges: primary.edges.filter((e) => keepIds.has(e.id)) };
  }

  if (limitsHit.length > 0) reasonCodes.add("FIDELITY_TRUNCATED_AT_LIMIT");

  const preservedNodes = primary.nodes;
  const receipt = buildFidelityReceipt({
    spec_id: input.spec_id,
    source_entity_ids: sourceEntityIds,
    source_edge_ids: sourceEdgeIds,
    rendered_entity_ids: preservedNodes.map((n) => n.source_entity_id),
    rendered_edge_ids: primary.edges.map((e) => e.id),
    collapsed_groups: collapsedGroups,
    hidden_entity_ids: Array.from(hidden),
    preserved_paths: model.paths
      .filter((p) => p.node_ids.every((id) => !removed.has(id)))
      .map((p) => p.id),
    preserved_findings: preservedNodes.filter((n) => n.severity !== undefined).map((n) => n.source_entity_id),
    preserved_decisions: preservedNodes.filter((n) => n.decision_status !== undefined).map((n) => n.source_entity_id),
    preserved_unresolved_entities: preservedNodes
      .filter((n) => n.resolution !== "resolved")
      .map((n) => n.source_entity_id),
    split_views: splitViews,
    truncated: limitsHit.length > 0,
    limits_hit: limitsHit,
    reason_codes: Array.from(reasonCodes),
  });

  return { model: withPlaceholders(model, primary, placeholders), splits: splitModels, receipt };
}

/**
 * Adds the stand-ins to the primary view and reconnects them.
 *
 * Reconnection is the half that is easy to forget. Dropping twelve nodes and
 * adding one labelled box would leave the box floating unattached, and the
 * reader would learn that a domain exists but not that anything depends on
 * it. So an edge whose far end moved is redrawn to the stand-in, deduplicated
 * by (kind, from, to) -- twelve dependencies on one domain are one arrow, not
 * twelve arrows into the same box.
 *
 * These connectors carry synthetic ids and are deliberately absent from the
 * receipt's `rendered_edge_ids`: they are a disclosure device, not source
 * relationships, and counting them would inflate the rendered edge count with
 * edges no upstream artifact ever established.
 */
function withPlaceholders(
  model: VisualGraphModel,
  primary: VisualGraphModel,
  placeholders: ReadonlyArray<{ node: VisualNode; member_ids: string[] }>,
): VisualGraphModel {
  if (placeholders.length === 0) return primary;

  const ownerOf = new Map<string, string>();
  for (const p of placeholders) for (const id of p.member_ids) ownerOf.set(id, p.node.id);
  const drawn = new Set(primary.nodes.map((n) => n.id));

  const connectors = new Map<string, VisualEdge>();
  for (const edge of model.edges) {
    const from = drawn.has(edge.from_id) ? edge.from_id : ownerOf.get(edge.from_id);
    const to = drawn.has(edge.to_id) ? edge.to_id : ownerOf.get(edge.to_id);
    // Both endpoints already drawn: the real edge is in `primary` already.
    // Either endpoint hidden rather than relocated: there is nothing honest
    // to point at, and the receipt names it instead.
    if (from === undefined || to === undefined || from === to) continue;
    if (drawn.has(edge.from_id) && drawn.has(edge.to_id)) continue;
    const id = buildVisualEdgeId(edge.kind, from, to);
    if (connectors.has(id)) continue;
    connectors.set(id, {
      id,
      from_id: from,
      to_id: to,
      kind: edge.kind,
      emphasis: "supporting",
      resolution: edge.resolution,
      in_cycle: false,
      evidence_refs: [],
    });
  }

  const placeholderNodes = placeholders.map((p) => p.node);
  const byGroup = new Map<string, string[]>();
  for (const p of placeholders) {
    // A stand-in belongs to the container its members came from, when they
    // all came from one -- so the overview keeps the containment it had.
    const groups = new Set(
      p.member_ids.map((id) => model.nodes.find((n) => n.id === id)?.group_id).filter((g) => g !== undefined),
    );
    if (groups.size !== 1) continue;
    const groupId = [...groups][0] as string;
    byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), p.node.id]);
  }

  return normalizeVisualGraphModel({
    ...primary,
    nodes: [...primary.nodes, ...placeholderNodes],
    edges: [...primary.edges, ...connectors.values()],
    groups: mergePlaceholderGroups(model, primary, byGroup),
  });
}

/** Re-adds a container the primary view had emptied, when a stand-in now sits in it. */
function mergePlaceholderGroups(
  model: VisualGraphModel,
  primary: VisualGraphModel,
  byGroup: ReadonlyMap<string, string[]>,
): VisualGraphModel["groups"] {
  const groups = primary.groups.map((g) => ({
    ...g,
    member_ids: [...g.member_ids, ...(byGroup.get(g.id) ?? [])],
  }));
  const present = new Set(groups.map((g) => g.id));
  for (const [groupId, memberIds] of byGroup) {
    if (present.has(groupId)) continue;
    const source = model.groups.find((g) => g.id === groupId);
    if (source === undefined) continue;
    groups.push({ ...source, member_ids: [...memberIds] });
  }
  return groups;
}

/**
 * Restricts a model to the nodes a predicate keeps, dropping edges whose
 * endpoints left and pruning every derived collection to what remains.
 *
 * Dropped edges are not entity losses (the receipt counts edges separately),
 * but a path that lost a node is no longer a path, so `paths` keeps only
 * routes that survived whole -- a half-drawn route would be a claim the view
 * cannot support.
 */
export function subsetModel(model: VisualGraphModel, keep: (node: VisualNode) => boolean): VisualGraphModel {
  const nodes = model.nodes.filter(keep);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = model.edges.filter((e) => nodeIds.has(e.from_id) && nodeIds.has(e.to_id));
  const edgeIds = new Set(edges.map((e) => e.id));
  const groups = model.groups
    .map((g) => ({ ...g, member_ids: g.member_ids.filter((id) => nodeIds.has(id)) }))
    .filter((g) => g.member_ids.length > 0);
  return {
    nodes,
    edges,
    groups,
    lanes: model.lanes
      .map((l) => ({ ...l, member_ids: l.member_ids.filter((id) => nodeIds.has(id)) }))
      .filter((l) => l.member_ids.length > 0),
    stages: model.stages
      .map((s) => ({ ...s, member_ids: s.member_ids.filter((id) => nodeIds.has(id)) }))
      .filter((s) => s.member_ids.length > 0),
    metrics: model.metrics,
    annotations: model.annotations.filter((a) => a.target_id === undefined || nodeIds.has(a.target_id)),
    boundaries: model.boundaries
      .map((b) => ({ ...b, member_ids: b.member_ids.filter((id) => nodeIds.has(id)) }))
      .filter((b) => b.member_ids.length > 0),
    paths: model.paths.filter(
      (p) => p.node_ids.every((id) => nodeIds.has(id)) && p.edge_ids.every((id) => edgeIds.has(id)),
    ),
    changes: model.changes.filter((c) =>
      c.subject_type === "node" ? nodeIds.has(c.subject_id) : edgeIds.has(c.subject_id),
    ),
    has_cycles: model.has_cycles && edges.some((e) => e.in_cycle),
    containment_depth: groups.length > 0 ? model.containment_depth : 0,
  };
}
