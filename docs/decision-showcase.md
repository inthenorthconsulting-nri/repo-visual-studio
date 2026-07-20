# Decision Showcase: Slides and Narrative (Milestone 8)

This document describes how a `DecisionPlan` becomes a rendered HTML deck —
`decision-visualdoc-builder.ts`'s scene assembly, the `decision-scene`
addition to the `VisualDoc` discriminated union, `renderer-html`'s 17-scene
renderer, and the `rvs create slides --profile decisions` CLI command. It
is part of [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)'s
broader pipeline; see that document for how a `DecisionPlan` itself is
built from the underlying decision intelligence report.

```
DecisionPlan (decision-plan.ts, @rvs/decision-intelligence)
  -> buildDecisionVisualDocScenes() (decision-visualdoc-builder.ts, @rvs/narrative-planner)
  -> buildDecisionVisualDoc()
  -> VisualDoc { scenes: DecisionScene[], audience: "decisions", theme: "technical-grid", ... }
  -> DecisionSceneSchema validation (schema.ts, @rvs/visualdoc-schema)
  -> renderDecisionScene() exhaustive switch over 17 DecisionSceneKind values (decision/render.ts, @rvs/renderer-html)
  -> deck.html
```

## Design mandate

Mirroring `governance-visualdoc-builder.ts`'s own pattern (see
[docs/architecture-governance.md](architecture-governance.md)), the
decision showcase path:

- **Never invents presentation content.** Every scene is a structural
  reprojection of fields already present on the `DecisionPlan` passed in —
  no narrative text is synthesized at render time beyond what
  `narrative.ts` already produced upstream and `decision-plan.ts` already
  attached to each scene's pointer.
- **Hardcodes its own audience and theme, deliberately.** `buildDecisionVisualDoc()`
  sets `audience: "decisions"` and `theme: "technical-grid"` unconditionally
  — there is no `--audience` flag on the decisions slides path (see "Known
  limitations" below).
- **Fits the existing `VisualDoc` discriminated union without changing any
  other scene kind.** `decision-scene` is a new, additive member of the
  union alongside `governance-scene` and every pre-existing scene family —
  no existing scene schema or renderer path was modified to make room for
  it.

## `decision-visualdoc-builder.ts`

`buildDecisionVisualDocScenes(plan: DecisionPlan): DecisionScene[]` maps
each `DecisionPlan` scene pointer to a `decision-scene`-typed `VisualDoc`
scene, carrying the pointer's own `id`, `kind` (one of the 17
`DecisionSceneKind` values), and `decision_plan_id` straight through — the
same "pointer, not payload" pattern `governance-visualdoc-builder.ts` uses:
the actual content a given scene renders is read from the `DecisionPlan`
itself at render time, not duplicated into the `VisualDoc` scene.

`buildDecisionVisualDoc(plan: DecisionPlan): VisualDoc` wraps
`buildDecisionVisualDocScenes()`'s output into a full `VisualDoc`:

```ts
{
  id: `visualdoc:${plan.id}`,
  audience: "decisions",
  theme: "technical-grid",
  scenes: buildDecisionVisualDocScenes(plan),
  // ...remaining VisualDoc envelope fields
}
```

## The 17 scene kinds

**`DecisionSceneKind` has 17 members, not 15.** `renderer-html`'s
`decision/render.ts` contains an exhaustive TypeScript switch over all 17 —
confirmed by reading both `contracts.ts`'s type declaration and the
renderer's own switch statement, which the compiler would reject as
non-exhaustive if any member were missing a case. In declaration order
(`SCENE_KIND_ORDER` in `decision-plan.ts`):

| # | Scene kind | Content |
|---|---|---|
| 1 | `decision-hero` | Plan-level title/summary opening scene. |
| 2 | `decision-landscape` | All decisions, grouped by `decision_status`. |
| 3 | `decision-status` | Status distribution across the 11 `DecisionStatus` values. |
| 4 | `decision-architecture-map` | Resolved `architecture`-domain links. |
| 5 | `decision-capability-map` | Resolved `capability`-domain links. |
| 6 | `decision-product-map` | Resolved `product`-domain links. |
| 7 | `decision-portfolio-map` | Resolved `portfolio`-domain links. |
| 8 | `decision-implementation` | Implementation-status distribution and coverage. |
| 9 | `decision-assumptions` | Assumptions by state (`holds`/`weakened`/`contradicted`/`unverified`). |
| 10 | `decision-supersession` | Supersession chains and issues. |
| 11 | `decision-conflicts` | Open and resolved `DecisionConflict` entries. |
| 12 | `decision-coverage` | Decision coverage of upstream entities. |
| 13 | `decision-drift` | `DecisionDrift` findings by severity. |
| 14 | `decision-debt` | `DecisionDebtFinding`s by category (also carries folded-in missing-decision findings — see [docs/architecture-decision-intelligence.md#known-limitations](architecture-decision-intelligence.md#known-limitations)). |
| 15 | `decision-governance-impact` | `DecisionGovernanceContextEcho` summary — see [docs/decision-governance.md](decision-governance.md). |
| 16 | `decision-review-required` | Decisions/findings flagged as requiring human review. |
| 17 | `decision-validation` | Validation findings (`validation.ts`) by severity. |

This corrects the originating design plan's claim of "15" scene kinds; the
actual implemented and rendered count on this branch is 17.

## `DecisionSceneSchema` and the `VisualDoc` union

`packages/visualdoc-schema/src/schema.ts` adds `DecisionSceneSchema` (Zod)
as a new tagged member of the discriminated `VisualDocSceneSchema` union —
`type: "decision-scene"` — alongside the pre-existing `governance-scene`
and every other scene family. It validates the pointer shape
(`id`/`kind`/`decision_plan_id`) only; it does not embed or re-validate the
`DecisionPlan`'s own content, matching the "pointer, not payload" pattern
above.

## `renderer-html`: `renderDecisionScene()`

`packages/renderer-html/src/scenes/decision/render.ts` (338 lines)
implements `renderDecisionScene(scene, plan)` as a single exhaustive switch
over all 17 `DecisionSceneKind` values, each branch producing an HTML
fragment via the module's own small set of shared helpers (list/table/badge
renderers consistent with the existing `governance`/`portfolio` scene
renderers' own helper style) and CSS classes scoped under a
`decision-scene`/`decision-*` naming convention, kept visually consistent
with the pre-existing scene families without sharing component code across
package boundaries.

## CLI

```bash
rvs create slides --profile decisions
  # -> reads .rvs/cache/decisions/decision-plan.json
  # -> buildDecisionVisualDoc()
  # -> renders deck.html via the configured design system
```

`runCreateDecisionsSlides()` (`create-slides.ts`) is dispatched when
`--profile decisions` is passed, matching `DECISIONS_PROFILE = "decisions"`.
Its completion log line:

```
Rendered <N> decision scenes to <output_dir>/deck.html using "<designSystemId>"
```

Full CLI reference for the upstream `rvs decisions analyze`/`explain`
commands that produce `decision-plan.json`:
[docs/architecture-decision-intelligence.md#cli](architecture-decision-intelligence.md#cli).

## Known limitations

- **17 scene kinds are implemented, not 15** — see above; this document is
  the authoritative correction to the originating plan's scene count.
- **No `--audience` flag on this path.** `buildDecisionVisualDoc()`
  hardcodes `audience: "decisions"` and `theme: "technical-grid"`
  unconditionally; a caller cannot currently render a decisions deck under
  a different audience/theme pairing without a code change to this
  function.
- **No model-assisted slide copy.** Every scene's content is a structural
  reprojection of the `DecisionPlan`'s own fields — nothing is synthesized
  at render time.
- **Presentation-layer only; does not affect the underlying report.**
  `deck.html` is a read-only view over `.rvs/cache/decisions/decision-plan.json`
  — regenerating it never mutates any cached decision-intelligence output.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `DecisionPlan`/`DecisionSceneKind` types; `decision-plan.ts` (upstream of this document's scope) |
| `@rvs/narrative-planner` | `decision-visualdoc-builder.ts` (`buildDecisionVisualDocScenes()`, `buildDecisionVisualDoc()`) |
| `@rvs/visualdoc-schema` | `DecisionSceneSchema`; `decision-scene` union member |
| `@rvs/renderer-html` | `decision/render.ts`'s `renderDecisionScene()`, 17-kind exhaustive switch |
| `@rvs/cli` | `rvs create slides --profile decisions`; `runCreateDecisionsSlides()` |

`@rvs/narrative-planner`, `@rvs/visualdoc-schema`, and `@rvs/renderer-html`
each reference decision-intelligence's scene/plan shapes only through their
own independently-declared structural types — none of them imports
`@rvs/decision-intelligence`'s types directly, preserving the same
zero-type-coupling convention documented for
`governance-visualdoc-builder.ts` in
[docs/architecture-governance.md](architecture-governance.md).

See also: [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md),
[docs/decision-governance.md](decision-governance.md).
