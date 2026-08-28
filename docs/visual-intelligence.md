# Visual Intelligence (Milestone 10.0)

This document describes `@rvs/visual-intelligence`: the renderer-neutral
layer that sits between RVS's intelligence artifacts and anything that draws
them. It answers four questions about a view — *what is it trying to make
understood*, *how much of the evidence survives into it*, *who is reading
it*, and *when something had to go, exactly what went and why* — and answers
them as data, before a single coordinate or colour exists.

```
Repository Evidence
  -> Architecture / Capability / Product / Portfolio / Governance /
     Decision Intelligence, Architecture Knowledge Graph      (Milestones 1-9)
  -> VisualGraphModel                          (data-model.ts, presentation only)
  -> SemanticIntent                            (vocabulary.ts)
  -> selectVisualGrammar()                     (grammar-selection.ts)
  -> audiencePolicyFor() x DetailMode          (audience.ts, separate dimensions)
  -> budgetFor(grammar, detailMode)            (budgets.ts)
  -> adaptVisualModel()                        (degradation.ts, the only simplifier)
  -> buildFidelityReceipt()                    (fidelity.ts, the audit trail)
  -> VisualCommunicationSpec                   (spec.ts)
  -> validateVisualCommunicationSpec()         (validation.ts, VISUAL_* codes)
  -> @rvs/visual-grammar and every later renderer   (docs/visual-grammar.md)
```

Scope: **communication semantics.** This package establishes no fact about a
repository, computes no diff, resolves no reference, and reads no file. Every
node it carries names the upstream entity it depicts. It owns no geometry, no
markup, and no colour.

## Design mandate

Milestone 10 splits responsibility four ways, and the split is the whole
point:

| Layer | Owns | Does not own |
| --- | --- | --- |
| Intelligence (Milestones 1–9) | truth | how truth is shown |
| Visual Intelligence (10.0) | communication semantics | geometry, markup, colour |
| Layout engines (10.1) | geometry | what is true, what may be dropped |
| Renderers (10.1, 10.3, 10.6) | concrete output | everything above |

A renderer that decides for itself which nodes to drop has quietly become an
intelligence layer, and its decisions become unreviewable — which is the
failure this package exists to prevent.

### Purity, enforced by the compiler rather than by review

`packages/visual-intelligence/tsconfig.json` overrides `"lib": ["ES2022"]`,
dropping `DOM` from the inherited base. A stray `document.createElement` or
`SVGElement` in this package is a compile error, not a code-review catch. The
package has exactly one runtime dependency shape: none. It imports no other
`@rvs/*` package, consistent with the zero-cross-import convention the
intelligence stack already follows.

## Vocabulary

Four closed enumerations, each published as a `readonly` array so tests can
assert the set is closed and every member is reachable.

- **`SemanticIntent`** — what the view is trying to make understood.
  Seventeen: `architecture`, `dependency`, `sequence`, `causality`,
  `hierarchy`, `containment`, `ownership`, `lifecycle`, `comparison`,
  `distribution`, `flow`, `policy`, `trust_boundary`, `impact`, `change`,
  `root_cause`, `maturity`.
- **`VisualGrammar`** — the shape that carries it. Fifteen: `architecture`,
  `dependency_graph`, `sequence`, `swimlane`, `data_flow`, `tree`, `nested`,
  `layer_stack`, `timeline`, `matrix`, `metric_row`, `fishbone`,
  `state_machine`, `process`, `delta`.
- **`DetailMode`** — `faithful`, `balanced`, `simplified`.
- **`MotionIntent`** — `none`, `reveal`, `trace`, `step`, `compare`, `impact`.
- **`VisualAudience`** — `executive`, `product`, `architecture-review`,
  `engineering`, `operations`, `mixed`.
- **`VisualFormat`** — `slide`, `interactive`, `document`, `export`.

Intent and grammar are a deliberately **many-to-many** relation rather than a
lookup: `policy` may honestly render as a `process`, a `layer_stack`, or a
`matrix`, and which one is right depends on the model, not on the intent
name. Collapsing the two vocabularies into one would make that choice
inexpressible.

`INTENT_GRAMMAR_COMPATIBILITY` and `INTENT_MOTION_COMPATIBILITY` state which
combinations are legal; `FORMAT_MOTION_COMPATIBILITY` restricts motion by
output format, because a PDF cannot animate and should never claim to.

### Audience and detail are separate dimensions

The tempting shortcut — executive means simplified, engineer means faithful —
is wrong in both directions and is explicitly not encoded. An executive
reviewing a production incident may need the faithful graph; an engineer
scanning for one dependency may want the simplified one. `AudiencePolicy`
governs *register*: identifier exposure, annotation depth, evidence
visibility, terminology. `DetailMode` governs *quantity*. They compose
freely, and the validator rejects neither combination.

`TERMINOLOGY_INVARIANTS` fixes the terms that never vary by audience — an
"unresolved reference" is unresolved for everyone. Softening language for a
senior reader is how a diagram starts lying politely.

## The canonical coordinate system

`CANONICAL_COORDINATE_SYSTEM` resolves the 1280×720 / 1920×1080 ambiguity
that existed across earlier renderers: a single stage of **1280×720** with
72/96 padding, giving a **1088×576** content box. `sceneContentBox()`,
`sceneViewBox()` and `fitScale()` are the only ways to obtain it. One
coordinate model exists, is named (`rvs-stage-16x9-v1`), and is stamped onto
every rendered document as `data-rvs-coordinate-system`, so a drawing can be
checked against the system it claims.

## Deterministic grammar selection

`selectVisualGrammar()` derives signals from the model (node and edge counts,
containment depth, distinct node kinds, presence of lanes/stages/changes,
data-flow edge kinds, structural node kinds) and scores a fixed rule table.
It returns the chosen grammar, a **rationale code**, and the **compatible
alternatives** that were legal but not chosen — so a reviewer can ask why
this shape and see the answer without reading the selector.

No external model. No LLM classification. No repository-specific product
names: the edge and node kind sets it consults (`DATA_FLOW_EDGE_KINDS`,
`STRUCTURAL_NODE_KINDS`) are echoed from the knowledge graph's own generic
vocabulary as plain strings, never imported and never extended with a
particular repository's names.

`selectionReasonCodes()` publishes the closed code set. A published code that
no rule can emit is a documentation bug, and a test asserts it cannot happen.

## Degradation: one policy, thirteen ranked rules

`degradation.ts` is the **only** place in RVS permitted to decide that
something will not be drawn. `DEGRADATION_POLICY` ranks thirteen rules; ranks
1–9 are *protected* and may never be hidden:

| Rank | Code | Rule |
| --- | --- | --- |
| 1 | `VISUAL_PRESERVE_FOCAL` | what the reader asked about |
| 2 | `VISUAL_PRESERVE_PRIMARY_PATH` | every node of a critical path |
| 3 | `VISUAL_PRESERVE_CHANGE_SUBJECT` | a view carrying changes is about them |
| 4 | `VISUAL_PRESERVE_BLOCKING_FINDING` | layout never downgrades a severity |
| 5 | `VISUAL_PRESERVE_REVIEW_REQUIRED_FINDING` | likewise |
| 6 | `VISUAL_PRESERVE_DECISION_LINKED` | decision context is not lost to layout |
| 7 | `VISUAL_PRESERVE_UNRESOLVED` | the reader must see the picture is incomplete |
| 8 | `VISUAL_PRESERVE_TRUST_BOUNDARY` | a boundary crossing is never hidden |
| 9 | `VISUAL_PRESERVE_ENTRY_POINT` | the view keeps a way in |
| 10 | `VISUAL_COLLAPSE_STRUCTURALLY_EQUIVALENT` | identical kind, container, and neighbour signature |
| 11 | `VISUAL_COLLAPSE_LOW_VALUE_LEAF` | degree ≤ 1 supporting leaves in one container |
| 12 | `VISUAL_HIDE_NON_CRITICAL` | last, and only with a receipt entry naming it |
| 13 | `VISUAL_SPLIT_BEFORE_SHRINK` | overview plus detail views; type size never shrinks |

Rank 3 arrived with the [change review](architecture-change-review.md): a
Delta view that reduced its changed entities away would be reporting a change
nobody can see. It sits above governance and decisions because those two are
*reasons* a change matters, and a reason with its subject missing explains
nothing.

### Splitting is not hiding

The two verbs are categorically different and the distinction resolves what
otherwise looks like a contradiction ("an unresolved entity may never be
hidden" versus "a view must stay within a readable budget"). Hiding removes
an entity from the story. Splitting *relocates* it: still drawn, still at
full detail, with the primary view naming where it went. So `isProtected`
(rank ≤ 9, never hidden) and `isRelocatable` (rank > 2, may move to a detail
view) are separate predicates. Only the focal entity and the primary path are
non-relocatable — the reader must find the thing they asked about in the view
they are looking at, and a route drawn in pieces joins up nowhere.

`DEGRADATION_PASS_ORDER` publishes the order the passes actually run, and
splitting appears in it **twice**:

```
collapse structurally equivalent
collapse low-value leaf
split before shrink        <- along real containers, before anything is hidden
hide non-critical
split before shrink        <- sequential pages, last resort
```

Two further passes run around those five, and neither reduces content, which
is why neither has a degradation code. **The anchor floor** holds back
`max(1, ⌊max_nodes / 2⌋)` real entities from every pass above, because a view
made entirely of stand-ins satisfies a box count and orients nobody. **Merging
stand-ins** then finds the room that costs by coarsening signposts —
`FIDELITY_STAND_INS_MERGED` — rather than by spending an entity. Both are
described in [adaptive-detail.md](adaptive-detail.md#the-anchor-floor).

Splitting along a real container is meaning-preserving: "Architecture —
Authentication detail" is a view a reader can ask for by name. Splitting into
sequential pages is not — a page boundary says nothing about the
architecture — so paging runs last, reached only for entities that protection
forbids hiding. A reader is better served by a disclosed omission of a
low-value leaf than by two hundred structureless pages.

When splitting is disallowed and protection alone overflows the budget, the
honest outcome is reported rather than resolved: nothing is hidden, nothing
is dropped, and the receipt carries `truncated: true` with
`FIDELITY_NODE_BUDGET_EXCEEDED`.

Type size is never reduced. "Too dense, so shrink the font" is the default
this milestone exists to forbid.

## Density budgets

`budgetFor(grammar, detailMode)` returns the node/edge budget for a pairing,
derived from `geometricNodeCapacity(grammar)` — a swimlane and a matrix do
not hold the same number of boxes legibly, so one global number would be
wrong for both. `allBudgets()` enumerates every pairing for testing and
documentation. These values are empirical and expected to be revisited
against real repositories.

## Fidelity receipts

See [`fidelity-receipts.md`](fidelity-receipts.md). In summary: whenever the
rendered entity or edge count differs from the source count, a
`FidelityReceipt` is mandatory, and `validateFidelityReceipt()` proves the
three destinations — preserved, collapsed, hidden — partition the source set
exactly. An entity in none of them vanished silently; an entity in two of
them means the receipt tells two stories about one entity.

## Scene mapping

`scene-mapping.ts` maps the existing narrative scene types onto
intent/grammar pairs — knowledge-graph dependency paths to
`dependency`/`dependency_graph`, root causes to `root_cause`/`fishbone`,
workflow scenes to `sequence`/`swimlane`, Terraform topology to
`architecture`/`architecture`, capability domains to `hierarchy`/`tree`,
governance policy to `policy`/`process`, decision supersession to
`lifecycle`/`timeline`, and so on.

**This mapping is metadata only.** No existing rendered HTML changes as a
result of Milestone 10.0. `sceneMappingConsistencyViolations()` asserts every
mapping names a legal intent/grammar pair, so the table cannot drift out of
agreement with the vocabulary it references.

## Validation

`validateVisualCommunicationSpec()` emits findings from a closed code set:

| Code | Raised when |
| --- | --- |
| `VISUAL_INTENT_UNSUPPORTED` | the spec names an intent outside the vocabulary |
| `VISUAL_GRAMMAR_UNSUPPORTED` | the spec names a grammar outside the vocabulary |
| `VISUAL_GRAMMAR_INTENT_MISMATCH` | the grammar cannot carry the intent |
| `VISUAL_DETAIL_MODE_INVALID` | the detail mode is outside the vocabulary |
| `VISUAL_MOTION_INTENT_INVALID` | motion contradicts the intent or the format |
| `VISUAL_FIDELITY_RECEIPT_INVALID` | the receipt does not add up |
| `VISUAL_FIDELITY_ENTITY_LOST` | a source entity is neither preserved, collapsed, nor hidden |
| `VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST` | an unresolved entity was hidden |
| `VISUAL_FIDELITY_CRITICAL_PATH_LOST` | a critical path lost a node during adaptation |
| `VISUAL_NONDETERMINISTIC_SELECTION` | the same input produced two different selections |

Every published code is reachable, and a test proves it: an unreachable
validator code is a claim the system does not keep.

These findings are also what a *verified delivery* gate runs on. Every code
above maps to a repair category — `VISUAL_FIDELITY_CRITICAL_PATH_LOST` to
`restore-anchor`/`reroute`/`split-view`, and so on — and a candidate raising
any of them as blocking does not replace the artifact already at the target.
The mapping lives in `@rvs/visual-delivery`; the codes, their severities and
their subjects stay this package's. See
[`verified-preview.md`](verified-preview.md).

## Determinism

Everything here is a pure function of its input. Ids come from `sanitize()`,
`canonicalize()`, `digestOf()` (sha256 over canonical JSON), `shortDigest()`
and `normalizeIds()` — never from a timestamp, an array index, or a random
source. Digests cover id *sets*, not arrays, so a caller shuffling its input
cannot change a digest.

The proofs run five identical runs and five deterministic shuffles of every
ordered collection, and require byte-identical specs, receipts, grammar
selections, and entity sets. The shuffle is seeded rather than random: a
determinism proof that shuffles randomly can only fail intermittently, which
is the least useful way for a determinism bug to be reported.

## See also

- [`visual-grammar.md`](visual-grammar.md) — the layout engines and SVG renderer built on this contract
- [`interactive-architecture.md`](interactive-architecture.md) — the explorer built on all of it
- [`verified-preview.md`](verified-preview.md) — the gate that decides whether a new drawing may replace the last verified one
- [`fidelity-receipts.md`](fidelity-receipts.md) — the receipt format and its proofs
- [`architecture-knowledge-graph.md`](architecture-knowledge-graph.md) — the upstream graph most visual models are built from
