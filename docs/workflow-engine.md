# Workflow engine (Milestone 2, slice 1)

This document describes the first vertical slice of the workflow/architecture
engine: turning a checked-in **GitHub Actions workflow** file
(`.github/workflows/*.yml`) into a validated, evidence-traceable diagram
embedded in a slide deck.

```
GitHub Actions YAML
  -> WorkflowGraph            (packages/workflow-graph)
  -> workflow-type VisualDoc scene  (packages/visualdoc-schema, packages/narrative-planner)
  -> Mermaid rendering         (packages/workflow-mermaid)
  -> native SVG rendering      (packages/workflow-svg)
  -> layout/evidence/divergence validation (packages/validator)
```

Scope: **GitHub Actions workflows only.** Terraform, generic source-code
architecture extraction, and repository dependency mapping are out of scope
for this slice — they are expected to become new adapters that produce the
same `WorkflowGraph`-shaped contract (see "Design mandate" below), not a
parallel model.

Constraints carried over from Milestone 1 and enforced throughout this
slice: no network access, no GitHub API calls (only checked-in YAML is
read), no LLM dependency, deterministic output (same input always produces
byte-identical artifacts), repo-relative paths, and every node/edge/trigger
retains a repository evidence reference (file + line range).

## Design mandate

> `WorkflowGraph` is the reusable architecture contract, while Mermaid and
> SVG remain replaceable renderers. This will allow Terraform and
> repository dependencies to reuse the same graph infrastructure in the
> next slices.

Concretely, this means:

- `WorkflowGraph` never embeds Mermaid syntax, SVG coordinates, or CSS
  classes. It is pure structural data: nodes, edges, triggers, evidence.
- Both renderers derive their node/edge set from the same shared function,
  `selectSceneSubgraph(graph, detailLevel, focusNodeIds)`
  (`packages/workflow-graph/src/scene-subgraph.ts`), so they can never
  silently diverge on *which* nodes/edges to show — only on *how* to draw
  them.
- The SVG renderer is **not** a Mermaid-to-SVG conversion. It has its own
  from-scratch layout engine (`packages/workflow-svg/src/layout.ts`) and
  its own SVG string generation, consuming `WorkflowGraph` directly.

## The `WorkflowGraph` model

Defined in `packages/workflow-graph/src/types.ts`.

**Node types** (`WorkflowNodeType`): `trigger`, `job`, `step`,
`reusable-workflow`, `environment`, `approval`, `artifact`, `unknown`.

**Edge types** (`WorkflowEdgeType`): `starts` (trigger → job), `needs`
(job dependency via `jobs.<id>.needs`), `contains` (job → step),
`calls` (job → reusable workflow via `uses: <owner>/<repo>/.github/workflows/...`),
`conditional` (an edge whose traversal depends on `if:`), `produces` /
`consumes` (step ↔ artifact, from `actions/upload-artifact` /
`actions/download-artifact` steps), `deploys-to` (job → environment).

Every node and edge carries:
- `evidence: EvidenceReference[]` — always non-empty; each reference is a
  repo-relative `path` plus a 1-indexed `lines` range pointing at the exact
  YAML that produced it (validated by `WORKFLOW_MISSING_EVIDENCE`, see
  below).
- `confidence: "confirmed" | "partially-resolved" | "dynamic" |
  "unsupported"` — `"confirmed"` for a literal, statically-resolvable value;
  `"dynamic"` for something that depends on a GitHub Actions expression
  (`${{ ... }}`) the parser cannot resolve without executing the workflow;
  `"unsupported"` for constructs recognized but not modeled in detail.
  **The parser never infers a relationship that isn't explicitly present in
  the YAML** — an unresolvable `needs:` target becomes a
  `WORKFLOW_UNKNOWN_NEEDS` warning, not a guessed edge.

IDs are deterministic and derived purely from the YAML's own structure
(`packages/workflow-graph/src/ids.ts`) — e.g. `job:<workflow-id>:<job-key>`,
`edge:<from>-><to>:<type>` — so re-parsing the same file always produces the
same node/edge ids, and the same graph always renders identically.

## Detail levels and scene splitting

`selectSceneSubgraph(graph, detailLevel, focusNodeIds?)` implements four
detail levels, shared by both renderers:

| `detail_level`        | Shows |
|---|---|
| `summary` / `jobs`     | triggers + jobs + reusable-workflow/environment/approval nodes only; no steps, no artifacts |
| `jobs-and-key-steps`   | the above, plus each job's first/last step and any step that produces/consumes an artifact |
| `full`                 | the entire graph, unfiltered |

`focusNodeIds`, when given, further restricts the result to just those node
ids (and edges where both endpoints survive the filter) — this is how large
workflows get split across multiple scenes (see below).

### Large-workflow splitting

`validateGraphStructure` warns `WORKFLOW_TOO_LARGE` once a graph's
non-step node count exceeds **25**. When `narrative-planner`'s
`buildWorkflowScenes` (in `packages/narrative-planner/src/visualdoc-builder.ts`)
sees a graph over that threshold, it deterministically splits it into:

1. One **overview scene** at `detail_level: "summary"`, unfiltered — the
   full job-level map.
2. One or more **detail scenes** at `detail_level: "jobs-and-key-steps"`,
   each scoped via `focus_nodes` to one group of related jobs.

Groups are computed as the **weakly-connected components** of the
job-level graph (nodes connected by `starts`/`needs`/`calls`/`deploys-to`
edges), ordered by each component's smallest node id for reproducibility.
A component larger than 10 nodes is chunked further into consecutive
groups of 10, in sorted-id order — this is the one case where a scene
boundary can cut a real edge; the full graph remains available via the
overview scene and via `rvs create workflow --renderer both --format
visualdoc`. This whole process is pure graph-structure math (union-find
over edges already present in the YAML) — no heuristic inference of new
relationships.

## The `workflow` VisualDoc scene

Defined in `packages/visualdoc-schema/src/schema.ts` as
`WorkflowSceneSchema`. A workflow scene never embeds parser or renderer
output — it references a `WorkflowGraph` by `graph_id`, plus:

- `detail_level` (default `"jobs"`)
- `direction`: `"left-to-right" | "top-to-bottom"` (default `"top-to-bottom"`)
- `highlight: string[]` — node/edge ids to draw with an accent stroke
- `annotations: { target, text }[]` — freeform callouts pinned to a node/edge id
- `focus_nodes?: string[]` — the large-workflow scoping mechanism above

Workflow scenes intentionally carry `evidence: []` at the *scene* level —
their evidence lives per-node/per-edge inside the referenced
`WorkflowGraph` (surfaced as `data-evidence` attributes on the rendered
SVG), not through the Milestone 1 evidence-manifest claim/citation system
that `headline`/`metric`/`architecture` scenes use.

`renderer-html`'s `renderWorkflowScene` (`packages/renderer-html/src/scenes/workflow.ts`)
resolves `graph_id` against a `Map<string, WorkflowGraph>` passed into
`renderVisualDocToHtml`, and renders the graph via the native SVG renderer
(never Mermaid — Mermaid's `.mmd` output is a separate artifact for
external tools, not embedded in the HTML deck).

## Renderers

### Mermaid (`packages/workflow-mermaid`)

`renderWorkflowMermaid(graph, options)` emits a `flowchart` block plus
`%% node <id> evidence=...` / `%% edge <id> evidence=...` comments so
evidence and identity survive even in the plain-text format. Shapes and
edge styles are chosen per `WorkflowNodeType`/`WorkflowEdgeType` (stadium
for triggers, hexagon for environments, dashed lines for
conditional/dynamic edges, etc.).

### Native SVG (`packages/workflow-svg`)

`renderWorkflowSvg(graph, options)`:

1. Calls `selectSceneSubgraph` (never Mermaid) to get the node/edge set.
2. Computes layout via `LayoutEngine` (interface in `src/layout.ts`,
   default implementation `LayeredLayoutEngine`) — a hand-rolled
   Kahn's-algorithm longest-path layering (`layer[v] = max(layer[u]) + 1`)
   with deterministic sorted-by-id ordering within each layer. This is an
   intentional trade-off against pulling in ELK.js/Dagre: no
   crossing-minimization heuristics, but zero new dependencies and fully
   deterministic, swappable via `RenderSvgOptions.layoutEngine` if a
   better engine is added later.
3. Measures label width deterministically (`src/measure-text.ts`, a fixed
   average-character-width heuristic — no DOM/canvas, since this runs
   headless in the CLI) and truncates labels that don't fit, always
   preserving the full label in a `<title>` and `data-full-label`
   attribute.
4. Emits self-contained SVG: no external fonts, no `<script>` tags, no
   external URLs. Each node/edge carries `data-node-id` / `data-edge-id`,
   `data-node-type`, `data-confidence`, and `data-evidence` attributes.
5. Uses its own fixed 8-type color palette (matching Mermaid's, hex-for-hex)
   rather than mapping onto the design system's small general-purpose
   token set — documented in `scenes/workflow.ts` as an intentional choice,
   since forcing 8 node types onto ~8 general tokens would be lossy.

Text sizing note: all SVG label text renders at **14px**, matching the
`min-font-size` accessibility floor the Playwright-based validator (task 1
of this milestone's predecessor) enforces on every scene, diagrams
included — this isn't a diagram-specific carve-out, it's the same bar
`architecture` scenes are held to.

## Validation

`packages/workflow-graph/src/validate-structure.ts` — pure, structural,
graph-level checks (no I/O):

| Code | Severity | Meaning |
|---|---|---|
| `WORKFLOW_DUPLICATE_NODE_ID` | error | two nodes share an id |
| `WORKFLOW_DUPLICATE_EDGE_ID` | error | two edges share an id |
| `WORKFLOW_DANGLING_EDGE` | error | edge references a node that doesn't exist |
| `WORKFLOW_MISSING_EVIDENCE` | error | a node/edge has zero evidence references |
| `WORKFLOW_UNSUPPORTED_TRIGGER` | warning | workflow has no recognizable trigger |
| `WORKFLOW_MATRIX_COLLAPSED` | warning | a job uses a matrix strategy; the diagram shows one representative node, not each expansion |
| `WORKFLOW_TOO_LARGE` | warning | non-step node count exceeds the 25-node splitting threshold |

`packages/workflow-graph/src/parse-workflow.ts` also emits, during parsing:
`WORKFLOW_UNKNOWN_NEEDS` (a `needs:` target that doesn't resolve to a real
job), `WORKFLOW_DYNAMIC_EXPRESSION` (a value gated behind an unresolvable
`${{ }}` expression), `WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED` (a `uses:`
reusable-workflow reference the parser can't statically resolve).

`packages/validator/src/workflow-checks.ts` — pure Node checks over
already-computed artifacts (a graph, a layout, rendered Mermaid/SVG
strings). Deliberately has no I/O or Playwright/DOM dependency, unlike
`checks.ts`, so it can run directly against `rvs create workflow` output:

| Code | Severity | Meaning |
|---|---|---|
| `WORKFLOW_STEP_DETAIL_COLLAPSED` | warning | steps exist but are hidden at the current `detail_level` |
| `WORKFLOW_LAYOUT_OVERLAP` | error | two nodes' computed bounding boxes intersect |
| `WORKFLOW_LAYOUT_TEXT_OVERFLOW` | warning | a node's label had to be truncated to fit its box |
| `WORKFLOW_RENDERER_DIVERGENCE` | error | Mermaid and SVG output cover different node/edge ids for the same `(graph, detail_level, focus_nodes)` |

`WORKFLOW_RENDERER_DIVERGENCE` is the regression guard for the "Mermaid and
SVG stay structurally equivalent" guarantee: it independently re-parses
each renderer's *actual output text* (Mermaid's `%% node/edge <id>
evidence=` comments; SVG's `data-node-id`/`data-edge-id` attributes,
XML-unescaped since ids containing `>` — e.g. `edge:a->b:needs` — get
escaped to `&gt;` inside SVG attribute values) and diffs the resulting id
sets, so it would catch a future regression even if `selectSceneSubgraph`
call sites were accidentally parameterized differently between the two
renderers.

`rvs create workflow` runs both the structural checks and the
graph/layout/divergence checks for every graph it processes and logs
findings; it does not gate CI by itself (that remains `rvs validate --ci`,
which continues to run its existing deck.html/Playwright checks —
including `min-font-size`, which the SVG renderer's 14px text satisfies —
against the rendered deck as a whole, workflow scenes included).

## CLI: `rvs create workflow`

```bash
rvs create workflow --source .github/workflows/ci.yml   # parse one file
rvs create workflow --all                                # discover + parse every workflow file
rvs create workflow --all --renderer mermaid              # mermaid|svg|both (default: both)
rvs create workflow --all --output artifacts/visuals/workflows  # default shown
rvs create workflow --all --format visualdoc               # also emit a scoped VisualDoc JSON per graph
```

For each graph processed, it writes (to `--output`, default
`<output_dir>/workflows/`):

- `<name>.mmd` — Mermaid text (if `--renderer mermaid|both`)
- `<name>.svg` — native SVG (if `--renderer svg|both`)
- `<name>.visualdoc.json` — a standalone single-workflow VisualDoc (if
  `--format visualdoc`), using the same large-workflow splitting rules
  described above

It always caches parsed graphs to `.rvs/cache/workflow-graphs.json`
(`--all` replaces the whole cache with the current discovery result;
`--source` upserts just that one graph by `sourcePath`, leaving other
cached graphs untouched). `rvs create slides` reads this cache — if
present, `buildVisualDoc` appends a "Workflows" section with one scene (or
split scene group) per cached graph, right after the Architecture section.
Running `rvs create workflow` is optional: omit it and `rvs create slides`
produces exactly the Milestone 1 deck, unchanged.

## Package summary

| Package | Role |
|---|---|
| `@rvs/workflow-graph` | discovery, YAML parsing, `WorkflowGraph` types, structural validation, `selectSceneSubgraph` |
| `@rvs/workflow-mermaid` | `WorkflowGraph` → Mermaid flowchart text |
| `@rvs/workflow-svg` | `WorkflowGraph` → native SVG, own `LayoutEngine` |
| `@rvs/visualdoc-schema` | adds `WorkflowSceneSchema` / `WorkflowDetailLevelSchema` / `WorkflowAnnotationSchema` |
| `@rvs/narrative-planner` | `buildWorkflowScenes` — graph → scene(s), with large-workflow splitting |
| `@rvs/renderer-html` | `renderWorkflowScene` — resolves `graph_id`, renders via `@rvs/workflow-svg` |
| `@rvs/validator` | `workflow-checks.ts` — layout/evidence/divergence checks |
| `@rvs/cli` | `rvs create workflow` command; `rvs create slides` cache integration |
