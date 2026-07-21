# Graph Presentation and Showcase (Milestone 9)

This document is part of [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
broader pipeline; it covers only the presentation-layer wiring for the
knowledge graph: `packages/knowledge-graph/src/graph-plan.ts` (the
15-scene `KnowledgeGraphPlan` builder), `packages/narrative-planner/src/graph-visualdoc-builder.ts`
(`buildKnowledgeGraphVisualDoc`), `KnowledgeGraphSceneSchema` in
`packages/visualdoc-schema/src/schema.ts`, and
`packages/renderer-html/src/scenes/knowledge-graph/render.ts`.

```
KnowledgeGraphPlan (15 scenes, evidence-gated presence, graph-plan.ts)
  -> buildKnowledgeGraphVisualDoc(plan)             (narrative-planner)
       -> one VisualDoc scene per plan scene, every one
          type: "knowledge-graph-scene" (a single, generic pointer schema)
  -> VisualDoc { scenes: [{ id, type: "knowledge-graph-scene", plan_id, scene_id, ... }] }
  -> renderKnowledgeGraphScene(scene, plan)         (renderer-html)
       -> re-resolves the real scene content from `plan.scenes` by scene_id
       -> switch (kind) over all 15 KnowledgeGraphSceneKind values
       -> one private render function per kind, plain HTML/CSS template literals
  -> rvs create slides --profile knowledge-graph
```

Scope: **presentation only** — how an already-built, already-cached
`KnowledgeGraphPlan` becomes rendered HTML slides. This document does not
cover how the underlying counts/ids in each scene's `body` are computed
(that's each domain's own deep-dive document — see "See also" below), nor
how the narrative prose is generated (`narrative.ts`, covered briefly in
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md#narrative-and-presentation)).

## Design mandate

> A scene with nothing real to show must never be emitted empty — its
> absence from the deck is itself the honest signal.

Concretely, from `graph-plan.ts`'s own header comment: "[o]ne
build<Kind>Scene function per KnowledgeGraphSceneKind (15, exactly as
contracts.ts's union declares and the plan's presentation profile
suggests 1:1), mirroring `@rvs/decision-intelligence/src/decision-plan.ts`'s
'full content per scene, evidence-gated absence' pattern: a scene that
would have nothing real to show returns `undefined` rather than being
emitted empty." From `KnowledgeGraphSceneSchema`'s own schema comment
(`packages/visualdoc-schema/src/schema.ts`): "[t]he renderer switches on
`KnowledgeGraphPlan.scenes[].kind`; the narrative-significant ordering and
per-scene content stay entirely owned by `@rvs/knowledge-graph`" — the
VisualDoc schema layer deliberately knows nothing about the 15 kinds
itself; it is a thin, generic pointer.

## Core artifact model

`KnowledgeGraphSceneKind` (`contracts.ts`, 15 values, in fixed
presentation order — `SCENE_KIND_ORDER` in `graph-plan.ts`):

1. `graph-overview`
2. `graph-layers-connected`
3. `graph-entity-landscape`
4. `graph-relationship-landscape`
5. `graph-dependency-paths`
6. `graph-component-impact`
7. `graph-capability-impact`
8. `graph-product-portfolio-reach`
9. `graph-root-causes`
10. `graph-decision-dependencies`
11. `graph-invalidated-assumptions`
12. `graph-orphans-unresolved`
13. `graph-changes`
14. `graph-review-required`
15. `graph-validation`

`KnowledgeGraphSceneContent` (`contracts.ts`): `{ scene_id, kind, title,
body: unknown, evidence_refs }`. `body`'s shape is kind-specific and
untyped at the contract level — each `build<Kind>Scene` function in
`graph-plan.ts` shapes its own `body` object; the renderer knows each
shape by convention, not by a shared type.

`KnowledgeGraphPlan` (`contracts.ts`): `{ id, generated_at,
source_snapshot_id, scenes: KnowledgeGraphSceneContent[] }`. Note: unlike
`decision-plan.ts`'s equivalent, `KnowledgeGraphPlan` carries no
`report`/comparison-target field of its own — it is scoped to one
snapshot; a change/diff scene (`graph-changes`) is populated only when the
caller supplies an already-computed `GraphChangeSet` as an optional input,
never computed by the plan builder itself.

`KnowledgeGraphSceneSchema` (`packages/visualdoc-schema/src/schema.ts`):
`BaseSceneSchema.extend({ type: z.literal("knowledge-graph-scene"),
plan_id: z.string().min(1), scene_id: z.string().min(1) })` — the 14th
(and last) member of `SceneSchema`'s discriminated union, alongside
`TitleSceneSchema`, `SectionDividerSceneSchema`, `HeadlineSceneSchema`,
`MetricSceneSchema`, `ArchitectureSceneSchema`, `WorkflowSceneSchema`,
`TopologySceneSchema`, `ArchitectureIntelligenceSceneSchema`,
`CapabilityIntelligenceOverviewSceneSchema`, `ShowcaseSceneSchema`,
`PortfolioSceneSchema`, `GovernanceSceneSchema`, `DecisionSceneSchema`.
Every one of the 15 `KnowledgeGraphSceneKind` values maps to this **same
single** schema member — the schema layer carries only a `plan_id` +
`scene_id` pointer, never the per-kind `body` shape itself.

## Per-scene evidence gating

Each `build<Kind>Scene` function in `graph-plan.ts` returns `undefined`
(and is filtered out before the final `scenes` array is assembled) when it
would have nothing real to show:

| Scene | Omitted when |
|---|---|
| `graph-overview` | Never omitted (always built if a snapshot exists). |
| `graph-layers-connected` | Never omitted. |
| `graph-entity-landscape` | `nodes.length === 0`. |
| `graph-relationship-landscape` | `edges.length === 0`. |
| `graph-dependency-paths` | No impact result carries a `path_id` on any finding. |
| `graph-component-impact` | No impact finding has `node_type === "component"`. |
| `graph-capability-impact` | No impact result lists any `capabilities_affected`. |
| `graph-product-portfolio-reach` | No products affected and zero `portfolio_wide` blast-radius results. |
| `graph-root-causes` | `rootCauseGroups.length === 0`. |
| `graph-decision-dependencies` | `decisionImpacts.length === 0`. |
| `graph-invalidated-assumptions` | No decision-impact entry is `assumption_weakened`/`assumption_contradicted`. |
| `graph-orphans-unresolved` | Zero unresolved-reference nodes and zero orphan nodes. |
| `graph-changes` | No `changeSet` supplied. |
| `graph-review-required` | No decision needs review, no unresolved root-cause group, no unknown consumer. |
| `graph-validation` | Zero validation findings and every upstream artifact has `provenance === "complete"`. |

Scenes present in the final plan are sorted first by `SCENE_KIND_ORDER`
rank, then by `scene_id` — the presentation order above is fixed, not
input-dependent.

## VisualDoc and rendering

`buildKnowledgeGraphVisualDoc(plan: KnowledgeGraphPlan): VisualDoc`
(`packages/narrative-planner/src/graph-visualdoc-builder.ts`) builds one
`VisualDoc` scene per `plan.scenes[]` entry:
`{ id: scene.scene_id, type: "knowledge-graph-scene", headline: scene.title,
evidence: [], plan_id: plan.id, scene_id: scene.scene_id }`. Audience and
theme are fixed constants (`"knowledge-graph"` / `"technical-grid"`),
mirroring `buildDecisionVisualDoc()`'s own precedent. The doc title is
`` `Architecture Knowledge Graph: ${plan.source_snapshot_id}` ``.

`renderKnowledgeGraphScene(scene, plan)`
(`packages/renderer-html/src/scenes/knowledge-graph/render.ts`) is the
single entry point the renderer's scene dispatcher calls for every
`"knowledge-graph-scene"`-typed VisualDoc scene
(`packages/renderer-html/src/scenes/index.ts`). It re-resolves the real
scene content from `plan.scenes` by matching `scene.scene_id` (the
VisualDoc scene itself carries no `body`), then `switch`es on the
resolved content's `kind` across all 15 `KnowledgeGraphSceneKind` values,
each dispatching to its own private render function (e.g.
`renderGraphOverview`, `renderGraphRootCauses`, ...
`renderGraphValidation`) that builds an HTML string via template literals
and `escapeHtml` — no charting library; hand-built HTML/CSS markup reusing
class names already established by the governance/decision scene
renderers (e.g. `governance-count-list`, `arch-statement-list`). The
`switch` closes with a `default: { const exhaustive: never = kind; throw
...  }` exhaustiveness guard, so a 16th kind added to the contract without
a matching render branch fails to compile rather than silently rendering
nothing.

## CLI

```bash
rvs create slides --profile knowledge-graph
```

The command reads the cached plan — it never re-synthesizes one on the
fly:

```ts
const plan = readGraphCachedJsonOptional<KnowledgeGraphPlan>(repoRoot, KNOWLEDGE_GRAPH_OUTPUT_FILES.graphPlan);
```

and throws `` "No cached knowledge graph plan found. Run \`rvs graph build\` first." `` if `.rvs/cache/knowledge-graph/graph-plan.json`
doesn't exist. `"knowledge-graph"` is one of the accepted `--profile`
values alongside `repository-inventory`, `executive-overview`,
`architecture-review`, `engineering-onboarding`, `operating-review`,
`repository-audit`, `showcase`, `portfolio`, `governance`, and `decisions`
(`packages/cli/src/bin.ts`'s `--profile` help text).

## Known limitations

- **`KnowledgeGraphSceneSchema` is one generic pointer schema for all 15
  kinds**, not 15 distinct VisualDoc schema members — per-kind content
  ownership stays entirely inside `@rvs/knowledge-graph` and
  `@rvs/renderer-html`, never surfaced at the `@rvs/visualdoc-schema`
  contract level. A tool that only reads the VisualDoc/schema layer (and
  not the underlying cached `graph-plan.json`) cannot recover a scene's
  actual content — only its `plan_id`/`scene_id` pointer.
- **`KnowledgeGraphPlan` has no built-in comparison/report field.** The
  `graph-changes` scene is populated only if the caller (the CLI's
  `graph-build`/orchestration code) supplies an already-computed
  `GraphChangeSet` — `buildKnowledgeGraphPlan()` never computes a diff
  itself.
- **No charting library** — every scene is hand-built HTML/CSS, matching
  every other RVS scene renderer's convention.
- **`rvs create slides --profile knowledge-graph` never rebuilds the graph
  or the plan** — it strictly reads `.rvs/cache/knowledge-graph/graph-plan.json`;
  a stale plan produces a stale deck until `rvs graph build` is re-run.

## Package summary

| Package | Role |
|---|---|
| `@rvs/knowledge-graph` | `graph-plan.ts`'s 15 `build<Kind>Scene` functions + `buildKnowledgeGraphPlan` |
| `@rvs/narrative-planner` | `graph-visualdoc-builder.ts`'s `buildKnowledgeGraphVisualDoc` |
| `@rvs/visualdoc-schema` | `KnowledgeGraphSceneSchema` (14th member of `SceneSchema`'s discriminated union) |
| `@rvs/renderer-html` | `scenes/knowledge-graph/render.ts`'s `renderKnowledgeGraphScene` + 15 private per-kind render functions |
| `@rvs/cli` | `create-slides.ts`'s `"knowledge-graph"` profile branch (`runCreateGraphSlides`) |

See [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md)'s
"Package summary" for the full package/decoupling statement covering
`@rvs/knowledge-graph` itself.

See also: [docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md),
[docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-decision-impact.md](graph-decision-impact.md),
[docs/graph-change-planning.md](graph-change-planning.md).
