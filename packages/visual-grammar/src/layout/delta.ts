import type { VisualChangeKind } from "@rvs/visual-intelligence";
import type { GrammarLayout, LaidOutEdge, LaidOutLabel, LaidOutNode, LayoutContext } from "./types.js";
import { emptyLayout } from "./types.js";
import { layeredLayout } from "./layered.js";

// The `delta` engine: before / delta / after comparison.
//
// The design decision that makes this grammar work is that all three panels
// are laid out *once*, over the union of both states, and then filtered.
// Laying each panel out independently would let an unchanged component sit in
// a different place on each side, and the reader would have to search for it
// before they could tell it had not moved -- which is precisely the question a
// change review is asking. Shared geometry means anything that moved on the
// page genuinely moved in the architecture.
//
// The middle panel is the same geometry again, filtered to what changed. It is
// not a summary and not a third drawing: a component in the delta panel sits
// at exactly the height it sits at on both sides of it, so the eye can travel
// left and right across one row and see the same entity in all three states.
//
// This engine computes no diff. `model.changes` arrives verbatim from an
// upstream comparison artifact; nothing here decides what "changed" means.

const PANEL_GAP = 64;
const PANEL_HEADER = 32;

/** Change kinds that mean "absent from the before state" / "absent from the after state". */
const ABSENT_BEFORE = new Set<VisualChangeKind>(["added"]);
const ABSENT_AFTER = new Set<VisualChangeKind>(["removed"]);

/** Panels in reading order. The index, not the name, is what ordering uses -- alphabetically "after" sorts first, which is the wrong story. */
const PANELS = ["before", "delta", "after"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_ORDER = new Map<string, number>(PANELS.map((panel, index) => [panel, index] as const));
const PANEL_LABEL: Record<Panel, string> = { before: "Before", delta: "Delta", after: "After" };

/**
 * @param frame The scene the three panels have to fit inside, in canonical
 * units. Each panel gets a third of it, less the gaps between them, and the
 * shared layout wraps to that width -- so a review of eight components is
 * three readable columns rather than one drawing scaled to a fifth of its
 * size. Omitted when a caller wants the layout's natural size.
 */
export function deltaLayout(
  context: LayoutContext,
  frame?: { width: number; height: number },
): GrammarLayout {
  const { model, style } = context;
  if (model.nodes.length === 0) return emptyLayout("vertical");

  const panelBreadth =
    frame === undefined ? undefined : Math.max(0, (frame.width - PANEL_GAP * (PANELS.length - 1)) / PANELS.length);
  const union = layeredLayout(context, { direction: "vertical", frame_breadth: panelBreadth });

  const changeOf = new Map<string, VisualChangeKind>();
  const edgeChangeOf = new Map<string, VisualChangeKind>();
  for (const change of model.changes) {
    if (change.subject_type === "node") changeOf.set(change.subject_id, change.kind);
    else edgeChangeOf.set(change.subject_id, change.kind);
  }

  // What the delta panel holds: every changed entity, plus both endpoints of
  // every changed relationship. The endpoints are there because a rerouted or
  // removed dependency drawn with nothing at either end is a floating arrow --
  // the reader can see that *something* moved and not what it moved between.
  const deltaMembers = new Set<string>(changeOf.keys());
  for (const edge of model.edges) {
    if (!edgeChangeOf.has(edge.id)) continue;
    deltaMembers.add(edge.from_id);
    deltaMembers.add(edge.to_id);
  }

  const panelWidth = union.width;
  const step = panelWidth + PANEL_GAP;
  const offsetOf = (panel: Panel): number => (PANEL_ORDER.get(panel) ?? 0) * step;

  const nodes: LaidOutNode[] = [];
  const edges: LaidOutEdge[] = [];
  const presentByPanel = new Map<Panel, Set<string>>();

  const emit = (panel: Panel, keeps: (nodeId: string) => boolean, keepsEdge: (edgeId: string) => boolean) => {
    const dx = offsetOf(panel);
    const present = new Set(union.nodes.filter((n) => keeps(n.node.id)).map((n) => n.node.id));
    presentByPanel.set(panel, present);

    for (const laid of union.nodes) {
      if (!present.has(laid.node.id)) continue;
      nodes.push({
        ...laid,
        instance: panel,
        rect: { ...laid.rect, x: laid.rect.x + dx, y: laid.rect.y + PANEL_HEADER },
      });
    }
    for (const laid of union.edges) {
      if (!keepsEdge(laid.edge.id)) continue;
      // An edge whose endpoint is absent from this panel cannot be drawn on
      // it -- the relationship genuinely does not exist in that state.
      if (!present.has(laid.edge.from_id) || !present.has(laid.edge.to_id)) continue;
      edges.push({
        ...laid,
        points: laid.points.map((p) => ({ x: p.x + dx, y: p.y + PANEL_HEADER })),
        label_anchor:
          laid.label_anchor === undefined
            ? undefined
            : { x: laid.label_anchor.x + dx, y: laid.label_anchor.y + PANEL_HEADER },
      });
    }
  };

  const absentFrom = (absent: ReadonlySet<VisualChangeKind>) => (id: string) => {
    const kind = changeOf.get(id);
    return kind === undefined || !absent.has(kind);
  };
  const edgeAbsentFrom = (absent: ReadonlySet<VisualChangeKind>) => (id: string) => {
    const kind = edgeChangeOf.get(id);
    return kind === undefined || !absent.has(kind);
  };

  emit("before", absentFrom(ABSENT_BEFORE), edgeAbsentFrom(ABSENT_BEFORE));
  emit(
    "delta",
    (id) => deltaMembers.has(id),
    (id) => edgeChangeOf.has(id),
  );
  emit("after", absentFrom(ABSENT_AFTER), edgeAbsentFrom(ABSENT_AFTER));

  const labels: LaidOutLabel[] = PANELS.map((panel) => ({
    id: `delta-panel-${panel}`,
    text: PANEL_LABEL[panel],
    at: { x: offsetOf(panel) + panelWidth / 2, y: style.spacing.md },
    role: "caption" as const,
    anchor: "middle" as const,
    rotate: 0,
  }));

  // A group box is drawn on a panel only where that panel holds something
  // inside it. An empty container on the delta panel would read as "this
  // subsystem changed and everything in it is hidden", which is a claim about
  // the architecture the layout has no business making.
  //
  // Membership is the model's, not the geometry's. Asking whether a node's
  // centre fell inside a container's rectangle read the right answer off the
  // wrong thing: a group box is the bounding box of scattered members and is
  // allowed to overlap its neighbours (see `groupBoxes`), so a node belonging
  // to one subsystem can sit inside another's box and put an empty container
  // on the delta panel -- exactly the false claim this rule exists to prevent.
  const membersOf = new Map(model.groups.map((group) => [group.id, new Set(group.member_ids)] as const));

  const groups = union.groups.flatMap((group) =>
    PANELS.filter((panel) => {
      const members = membersOf.get(group.id);
      if (members === undefined) return false;
      for (const id of presentByPanel.get(panel) ?? []) if (members.has(id)) return true;
      return false;
    }).map((panel) => ({
      ...group,
      id: `${group.id}@${panel}`,
      rect: { ...group.rect, x: group.rect.x + offsetOf(panel), y: group.rect.y + PANEL_HEADER },
    })),
  );

  return {
    width: panelWidth * PANELS.length + PANEL_GAP * (PANELS.length - 1),
    height: union.height + PANEL_HEADER,
    // Sorted by panel reading order, then by id, so the markup serialises
    // before / delta / after -- which is the order a screen reader follows and
    // the order the story is told in.
    nodes: nodes.sort((a, b) => {
      const pa = PANEL_ORDER.get(a.instance ?? "") ?? 0;
      const pb = PANEL_ORDER.get(b.instance ?? "") ?? 0;
      return pa !== pb ? pa - pb : a.node.id < b.node.id ? -1 : 1;
    }),
    edges,
    groups,
    labels,
    edge_direction: "vertical",
  };
}
