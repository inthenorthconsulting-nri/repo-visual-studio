# Graph Presentation and Showcase (reference)

Use when: the task asks for a knowledge-graph slide deck, or asks how a
graph scene's content maps to the `VisualDoc`/rendering layers.

**Prerequisite**: `rvs graph build` has run — `rvs create slides
--profile knowledge-graph` is cache-read-only and throws `"No cached
knowledge graph plan found. Run \`rvs graph build\` first."` if
`.rvs/cache/knowledge-graph/graph-plan.json` doesn't exist; it never
rebuilds the graph or plan itself. Covers `graph-plan.ts`,
`graph-visualdoc-builder.ts`, `KnowledgeGraphSceneSchema`, and
`renderer-html`'s `scenes/knowledge-graph/render.ts`.

**Command**:

```bash
rvs create slides --profile knowledge-graph
```

**Output**: `.rvs/cache/visualdoc.json` plus (via the base workflow's `rvs
create slides` → `rvs export pdf` steps) an HTML deck / PDF export.

**Key facts to get right when explaining a result to a user**:

- 15 `KnowledgeGraphSceneKind` values, fixed presentation order
  (`SCENE_KIND_ORDER`): graph-overview, graph-layers-connected,
  graph-entity-landscape, graph-relationship-landscape,
  graph-dependency-paths, graph-component-impact, graph-capability-impact,
  graph-product-portfolio-reach, graph-root-causes,
  graph-decision-dependencies, graph-invalidated-assumptions,
  graph-orphans-unresolved, graph-changes, graph-review-required,
  graph-validation.
- **All 15 scene kinds map to one single `KnowledgeGraphSceneSchema`** —
  not 15 distinct schema members. It is the 14th and last member of
  `SceneSchema`'s discriminated union, and carries only a `plan_id` +
  `scene_id` pointer — never the per-kind `body` shape. Per-kind content
  ownership stays entirely inside `@rvs/knowledge-graph` (`graph-plan.ts`)
  and `@rvs/renderer-html` (`scenes/knowledge-graph/render.ts`); a tool
  that only reads the VisualDoc/schema layer cannot recover a scene's
  actual content.
- A scene with nothing real to show is omitted entirely, never emitted
  empty — e.g. `graph-root-causes` is omitted when there are zero
  root-cause groups, `graph-changes` is omitted whenever no `GraphChangeSet`
  was supplied (the plan builder never computes a diff itself).
- No charting library — every scene is hand-built HTML/CSS template
  literals, matching every other RVS scene renderer's convention. The
  renderer's `switch` on scene kind closes with an exhaustiveness guard,
  so an added 16th kind without a render branch fails to compile.

**Do not** claim a knowledge-graph scene's content can be read or edited
directly from the `VisualDoc`/schema layer — only `plan_id`/`scene_id` live
there; the real content lives in the cached `graph-plan.json`.

Full technical reference: `docs/graph-showcase.md` (full per-scene
evidence-gating table, `KnowledgeGraphSceneContent`/`KnowledgeGraphPlan`
field detail, known limitations).
