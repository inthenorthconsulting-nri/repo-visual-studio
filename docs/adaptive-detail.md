# Adaptive Detail & Audience Rendering

How RVS decides *how much* of a diagram to draw, and — separately — *how to
word it*. Detail mode and audience are two dimensions, not two names for one
slider.

Owned by `@rvs/visual-composition`, on top of the central degradation policy in
`@rvs/visual-intelligence` and the renderers in `@rvs/visual-grammar`.

## The two dimensions

| | Decides | Owned by | May change the entity set? |
| --- | --- | --- | --- |
| **Detail mode** | how much content survives | `degradation.ts` | yes, always with a receipt |
| **Audience** | how surviving content is described | `audience-rendering.ts` | **never** |

`DETAIL_MODES` is `faithful → balanced → simplified`, in decreasing capacity.
`VISUAL_AUDIENCES` is `executive`, `product`, `architecture-review`,
`engineering`, `operations`, `mixed`.

The pairing is free. `executive / faithful` is an ordinary request — an
executive reading an incident review wants every node. So is
`engineering / simplified` — an engineer orienting on an unfamiliar system
wants the map first. Encoding `executive == simplified` would make both
impossible, and would quietly tell one reader a smaller truth than the other.

Two tests hold this open rather than leaving it to convention:

- *draws the same entities for every audience at one detail mode* — the six
  audiences over one model produce one entity set.
- *does not treat executive as a synonym for simplified* —
  `executive/faithful` draws strictly more than `engineering/simplified`.

### What an audience may change

Only words, and only through `AudiencePolicy`:

| Policy field | Effect | Disclosed as |
| --- | --- | --- |
| `identifier_exposure: "label-and-id"` | appends ` (id)` to a label | `AUDIENCE_ID_DRAWN_WITH_LABEL` |
| `annotation_depth: "moderate" \| "minimal"` | draws fewer annotations | `AUDIENCE_ANNOTATIONS_REDUCED` |
| `evidence_visibility: "summarised"` | adds an evidence caption | `AUDIENCE_EVIDENCE_SUMMARISED` |
| `evidence_visibility: "not-drawn"` | draws no evidence line | `AUDIENCE_EVIDENCE_NOT_DRAWN` |

An annotation is explanatory text, not an entity, so reducing annotations is
not a fidelity reduction — but it is still stated, as an `AudienceAdjustment`
whose detail says *"No entity was removed"* in as many words.

`TERMINOLOGY_INVARIANTS` — `governance_severity`, `decision_status`,
`resolution_status`, `confidence` — pass through untouched for every audience.
A layout engine that could soften a severity for a friendlier deck would make
the deck the wrong place to look.

Audience rendering runs **after** adaptation. If it ran before, a longer label
under `label-and-id` could influence a downstream fit decision, and "who is
reading this" would have become an input to "what is true enough to show".

### What survives the audience dimension

Geometry is *not* claimed to be identical across audiences, and the test says
so: an audience that draws stable ids has longer labels, and a box wide enough
for its label is the correct response. What is identical is the **set of boxes
and the order a reader meets them in** — which is also the order a screen
reader reads. Audiences that word things identically do get identical
geometry, and that narrower claim is asserted directly.

## Split before shrink

The forbidden default is *"too dense → smaller font"*. It is forbidden because
it trades the reader's ability to read for the author's ability to avoid a
decision.

When content exceeds a readable budget, the four passes that reduce *content*
run in the order `DEGRADATION_PASS_ORDER` publishes:

1. collapse structurally equivalent entities
2. collapse low-value leaves
3. **split along real containers** — meaning-preserving
4. hide non-critical entities, each named in the receipt

Two further passes then reduce *disclosure* rather than content, and so appear
in no degradation code:

5. **merge stand-ins** — coarsen the signposts before spending any more content
6. **split into sequential pages** — for whatever protection forbids hiding

Type size never enters it. Four tests hold the line at the boundary where
shrinking would otherwise happen:

- a 4-entity model and a 400-entity model use the *same set of font sizes*
- a detail view is drawn at exactly the overview's type sizes — it exists
  because content was relocated, not demoted
- font sizes are constant across all three detail modes; only quantity changes
- a 400-entity model reaches its budget by disclosure, with nothing unaccounted

`RenderResult.scale` exists and is capped at 1, but it is a uniform
fit-to-frame transform for the whole drawing, applied after layout. It cannot
be aimed at one crowded region, so it is not a density control.

## The anchor floor

Passes 1–4 each answer one question: *are there few enough boxes?* A view made
entirely of stand-ins answers it. It answers nothing else. Running this
repository's own knowledge graph through a balanced architecture budget once
produced an overview of eight dashed boxes reading *"12 components"*, *"21
capabilities"*, *"13 evidence artifacts"* — within budget, fully disclosed, and
impossible to learn a single component's name from. A table of contents
pretending to be a diagram.

So **at most half a view, rounded down, may be signposts**. A floor of
`max(1, ⌊max_nodes / 2⌋)` entities is held back from every reducing pass:

| Detail mode | `max_nodes` | Anchor floor |
| --- | --- | --- |
| faithful | 12 | 6 |
| balanced | 8 | 4 |
| simplified | 5 | 2 |

(Those are the `architecture` grammar's numbers; every grammar has its own,
derived the same way from its cell size. The `delta` grammar used by the
[change review](architecture-change-review.md) budgets 30 / 21 / 13, floors
15 / 10 / 6, because three panels of third-width boxes hold more of them.)

**Anchoring is not preservation.** The two answer different questions and use
different orders. Preservation rank asks *what must survive*, and puts
unresolved references and open findings near the front, because losing those
silently is the failure that matters there. Anchoring asks *what is this view
about*, so entry points — the product, its commands, its runtime entrypoints —
come third, behind only what the reader named (`focal`) and the primary path.
They are the way in. Everything after them keeps policy order, ties going to
the best-connected entity, because an anchor nothing points at anchors nothing.

Nothing in the anchor order makes an entity *safe*: a blocking finding that
loses an anchor seat is still rank 4 and still cannot be hidden.

The anchor order is per-grammar in one respect. A change review anchors on the
change first — focused change, primary changed path, changed runtime
entrypoint, removed or added component, regressed capability, affected
product, governance finding, linked decision, unresolved consumer — because
the question a Delta view is answering is *what changed*, and an anchor seat
spent on something that did not change answers a question nobody asked.

### When the floor yields

The floor is a preference the arithmetic can overrule, not a promise the
arithmetic cannot keep. Sixty unresolved references, no container, and eight
slots: every slot is needed to point at a page of eight, so keeping even one
name leaves the last eight entities with nowhere to go. Pass 6 therefore
releases anchors — least important first, and only as many as it takes to find
a plan that fits. Paging is the pass allowed to spend them because it is the
one reduction that loses nothing: every paged entity is still drawn, at full
detail, in a view the primary one names.

Release is reachable only when the anchors are themselves relocatable, which
is why it went untested until 10.4: the focal entity and the primary path can
never be released, so a view anchored on those two overflows instead. Change
subjects *are* relocatable (rank 3 > 2), so a large delta is the first view in
RVS that can genuinely reach `FIDELITY_ANCHOR_RELEASED` — bisected in the
tests at 96 changed entities (no release) against 104 (release).

When no release fits either, the view overflows whatever the pass does, and
the question stops being *what fits* and becomes *what is worth overflowing
for*. Only the orienting anchors are — focal, primary path, entry point.
Naming four of sixty interchangeable unresolved references orients nobody;
naming the product and its entrypoint is the difference between a map and an
index. The overflow is disclosed in `limits_hit` either way.

## Merging stand-ins

Holding anchors back can leave a view over budget, and the honest place to find
the missing room is the signposts themselves.

Pass 5 merges stand-ins, fewest entities first, until the budget is met:
`k` stand-ins become one, freeing `k−1` slots. Two boxes reading *"4
components"* and *"5 components"* become one reading *"9 entities in 2
collapsed groups"*, carrying reason code `FIDELITY_STAND_INS_MERGED`.

The trade is granularity in the *disclosure* against no entity at all. The
receipt still names all nine, and they were undrawn either way. Removing a real
entity to make room for a signpost is the trade the other way round, and this
pass exists to stop it.

**Only stand-ins for pure collapses are merged.** One that carries a
`split_view_id` is the reader's only route to where those entities went, and
folding it into a general group would break the route while the receipt went on
claiming the entities were drawn.

Every collapsed group keeps exactly one stand-in on the page: the constituents
leave the receipt and the view together, because a disclosure pointing at a box
that is not there discloses nothing.

## Stand-ins

A view that reduced 48 entities to 3 and drew only those 3 is not an overview,
it is a different diagram: the reader cannot tell that four domains exist, let
alone ask to see one.

So every collapse and every split leaves a **stand-in** in the primary view — a
synthetic node carrying `placeholder_for`:

```jsonc
{
  "collapsed_group_id": "visual:group:…",
  "split_view_id": "visual:view:…",   // when the entities went to a detail view
  "entity_count": 12,
  "source_entity_ids": ["…"]
}
```

Rules, each with a test:

- **A stand-in is not an entity.** It appears in no receipt bucket and in no
  coverage bucket. Counting it as preserved would let a view claim credit for
  drawing something that does not exist.
- **A stand-in counts against the budget.** Replacing twelve boxes with a
  thirteenth nobody budgeted for moves the overflow rather than resolving it.
  Sequential paging solves `keep + pages(keep) ≤ budget` for this reason.
- **Stand-ins cannot be the whole view.** Counting boxes is a condition
  stand-ins alone can satisfy, so the anchor floor above is a separate
  condition they cannot.
- **A stand-in inherits the least-resolved state of what it stands for.**
  Reporting a group of twelve as resolved because eleven of them are would hide
  the one thing worth following up.
- **A stand-in is reconnected.** An edge whose far end moved is redrawn to the
  stand-in, deduplicated by `(kind, from, to)` — twelve dependencies on one
  domain are one arrow. These connectors are absent from `rendered_edge_ids`:
  they are a disclosure device, not source relationships.
- **A stand-in names its destination.** `data-rvs-placeholder`,
  `data-rvs-placeholder-count`, `data-rvs-collapsed-group` and
  `data-rvs-split-view` travel with the drawing, so an interactive surface can
  offer *"open that detail view"* without re-deriving it from a receipt it may
  not have been handed.
- **A stand-in is drawn as one.** Dashed border, an entity count on the
  secondary line, and an accessible description that begins *"stands in for N
  entities shown elsewhere"* — never presented as a component.

Because a collapsed group is scoped to the spec that produced it, and a spec is
per-audience, the *same* collapsed set gets a different synthetic id in each
audience's copy. Cross-audience comparisons key a stand-in by its
`source_entity_ids` instead, which are audience-independent.

## Coverage

`ComposedDocument.coverage` says where every source entity actually ended up,
read off the geometry that was really produced (`RenderResult.boxes`) rather
than restated from the receipt. Checking the receipt against itself would prove
nothing; this catches an entity the receipt calls preserved that no engine drew.

| Bucket | Meaning |
| --- | --- |
| `primary_entity_ids` | drawn in the overview |
| `detail_entity_ids` | drawn in a detail view |
| `collapsed_entity_ids` | represented by a disclosed collapsed group |
| `hidden_entity_ids` | not drawn anywhere, and named as such |
| `unaccounted_entity_ids` | always empty in a valid document |

The buckets partition the source set exactly — asserted, not assumed.

## The mandatory receipt

`fidelity_receipt` is optional on the *contract*, because a spec can be
constructed by hand and the type should not pretend otherwise. It is mandatory
on any path that draws: `composeVisualDocument` throws rather than render a
document with a reduction and no receipt. Output whose omissions nobody can
review is not degraded output; it is unreviewable output.

See also [fidelity-receipts.md](fidelity-receipts.md),
[visual-intelligence.md](visual-intelligence.md),
[visual-grammar.md](visual-grammar.md), and
[interactive-architecture.md](interactive-architecture.md).
