# Fidelity Receipts (Milestone 10.0)

A fidelity receipt is the audit trail that makes visual simplification
reviewable instead of merely convenient. It exists to prevent one specific
failure: a diagram that turns 27 source entities into 8 drawn boxes without
saying, entity by entity, where the other 19 went.

Produced by `buildFidelityReceipt()` and checked by
`validateFidelityReceipt()`, both in
`packages/visual-intelligence/src/fidelity.ts`.

## When a receipt is mandatory

`receiptIsMandatory(sourceEntities, renderedEntities, sourceEdges, renderedEdges)`
returns true whenever either count differs. There is no threshold and no
"small enough to skip": one dropped edge needs a receipt exactly as much as
two hundred do, because the reader has no way to tell the two cases apart
from the picture.

A view that reduced nothing still carries a receipt, with the single reason
code `FIDELITY_NO_REDUCTION`. Silence is not evidence of completeness.

## What it claims

```jsonc
{
  "id": "visual:receipt:…",
  "source_node_count": 27,  "rendered_node_count": 8,
  "source_edge_count": 41,  "rendered_edge_count": 12,
  "preserved_entity_ids": [ … ],
  "collapsed_groups": [
    { "id": "…", "display_label": "6 handlers", "source_entity_ids": [ … ],
      "reason": "VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT",
      "selection_policy": "lowest-id-member" }
  ],
  "hidden_entity_ids": [ … ],
  "preserved_paths": [ … ],
  "preserved_findings": [ … ],
  "preserved_decisions": [ … ],
  "preserved_unresolved_entities": [ … ],
  "split_views": [ { "id": "…", "display_label": "Authentication detail",
                     "entity_ids": [ … ], "reason": "FIDELITY_SPLIT_INTO_VIEWS" } ],
  "truncation": { "truncated": false, "limits_hit": [] },
  "reason_codes": [ … ],
  "source_digest": "…", "rendered_digest": "…"
}
```

Every id list is normalised and every group and split view is sorted by id,
so two receipts describing the same reduction are byte-identical regardless
of the order their inputs arrived in. The digests cover id *sets*, not
arrays, for the same reason.

## The partition property

`validateFidelityReceipt(receipt, sourceEntityIds)` proves that the three
destinations — **preserved**, **collapsed into a disclosed group**,
**hidden** — partition the source set:

- Their union is every source entity. An entity in none of them left the view
  without disclosure: `VISUAL_FIDELITY_ENTITY_LOST`.
- They are pairwise disjoint. An entity in two of them means the receipt is
  telling two different stories about the same entity:
  `VISUAL_FIDELITY_RECEIPT_INVALID`.
- Every id named is actually a source entity, and the reported counts match
  the lists they summarise.

An entity that appears only in a split view is, correctly, reported as
`collapsed` in the primary view's receipt: the primary view genuinely does
not draw it, and the split view discloses where it went.

## Rules a receipt cannot bargain with

**An unresolved entity may never be hidden.** Collapsing one into a disclosed
group is permitted; deleting it from the story is not, because the reader
must be able to see that the picture is incomplete.
`VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST` is raised if a receipt lists an
entity as both preserved-unresolved and hidden.

**A critical path survives end to end.** `criticalPathViolations()` checks
every node of every path upstream marked critical against the preserved set.
Losing one node mid-route means the drawing claims a route it cannot show:
`VISUAL_FIDELITY_CRITICAL_PATH_LOST`.

**A view is never entirely stand-ins.** The receipt would be valid — every
entity accounted for, the partition exact — and the drawing would still be
useless, because the reader cannot name one thing in it. So a floor of real
entities is held back from every reducing pass, and the room that costs is
taken from the signposts instead: `FIDELITY_STAND_INS_MERGED` records
stand-ins combined into a coarser one. The merged group names the union of
what its constituents named, so the partition is unchanged by the merge —
it is a reduction in the *granularity of the disclosure*, never in what the
disclosure covers. See [adaptive-detail.md](adaptive-detail.md#the-anchor-floor).

**A change review keeps real changed entities on screen.** The floor above is
what stops a simplified Delta view from becoming eight change stand-ins and
zero named changes, and the [change review](architecture-change-review.md)
adds a validator that fails outright on the degenerate case: real changes in
the source, none of them drawn (`CHANGE_REVIEW_REAL_ANCHOR_LOST`). Delta views
report their reductions with the same codes every other grammar uses — the
receipt records the grammar, so no change-prefixed second vocabulary is
needed.

**Truncation is reported, not resolved.** When splitting is disallowed and
protected entities alone exceed the budget, nothing is hidden and nothing is
dropped — the receipt says `truncated: true` and names the limit
(`FIDELITY_NODE_BUDGET_EXCEEDED`). An honest overflow is better than a quiet
deletion.

## What is *not* a fidelity reduction

Shortening a **label** to fit a box loses no entity. The node is drawn, the
receipt is unaffected, and the full string ships in the SVG `<title>` for
hover and for screen readers. Conflating visual truncation with information
loss would make receipts noisy enough to stop being read, which would cost
more than it saved.

## See also

- [`visual-intelligence.md`](visual-intelligence.md) — the degradation policy that produces these receipts
- [`visual-grammar.md`](visual-grammar.md) — the renderer that draws whatever survived
- [`interactive-architecture.md`](interactive-architecture.md) — the explorer that carries a receipt on the page
- [`architecture-change-review.md`](architecture-change-review.md) — the Before/Delta/After review, which carries one too
