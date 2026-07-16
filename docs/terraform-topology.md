# Terraform topology engine (Milestone 2, slice 2)

This document describes the second vertical slice of the workflow/architecture
engine: turning checked-in **Terraform HCL** (`.tf` files) into a validated,
evidence-traceable diagram embedded in a slide deck — the Terraform analogue
of [`docs/workflow-engine.md`](workflow-engine.md)'s GitHub Actions engine.

```
Terraform HCL (.tf files)
  -> TerraformTopology           (packages/terraform-graph)
  -> "topology" VisualDoc scene  (packages/visualdoc-schema, packages/narrative-planner)
  -> Mermaid rendering            (packages/terraform-mermaid)
  -> native SVG rendering         (packages/terraform-svg)
  -> layout/evidence/divergence validation (packages/validator)
```

Scope: **Terraform HCL only**, parsed as static text. Repository dependency
mapping, Kubernetes topology, and other architecture adapters are out of
scope for this slice — they are expected to become new adapters that reuse
the same shared primitives this slice introduced (see "Extension path"
below), not a parallel model.

Constraints carried over from Milestone 1 and slice 1, and enforced
throughout this slice: no network access, no execution of any Terraform CLI
command, no cloud provider API calls, no LLM dependency, deterministic
output (same input always produces byte-identical artifacts), repo-relative
paths, and every node/edge/variable/output retains a repository evidence
reference (file + line range).

## Design mandate

Like `WorkflowGraph`, `TerraformTopology` is a renderer-neutral, sibling
architecture contract — not a `WorkflowGraph` migration, but built on the
same shared primitives so both engines (and future ones) stay structurally
consistent:

- Node and edge shapes (`ArchitectureNode`, `ArchitectureEdge`,
  `EvidenceReference`, `ArchitectureNodeStatus`) live in
  `@rvs/architecture-graph` and are shared verbatim between `WorkflowGraph`
  and `TerraformTopology`. `TerraformTopology` itself layers
  Terraform-specific typing (`TerraformNodeType`, `TerraformEdgeType`,
  provider/module/variable/output summaries) on top, exactly the way
  `WorkflowGraph` layers workflow-specific typing on the same primitives.
- `TerraformTopology` never embeds Mermaid syntax, SVG coordinates, or CSS
  classes — pure structural data.
- Both renderers derive their node/edge set from the same shared function,
  `buildTerraformSceneSubgraphs(topology, detailLevel, warnings)`
  (`packages/terraform-graph/src/scene-subgraph.ts`), so they can never
  silently diverge on *which* nodes/edges to show.
- The SVG renderer (`packages/terraform-svg`) reuses `@rvs/workflow-svg`'s
  `LayeredLayoutEngine` and text-measurement/truncation utilities rather
  than reimplementing layout — the two diagram families share one layout
  engine, one truncation policy, and one `min-font-size` bar.

## Pipeline

```
rvs create topology --source <dir> | --all
  1. discoverTerraformFiles     -> every checked-in *.tf file, minus always-excluded paths
  2. groupIntoDirectories       -> one candidate module per containing directory
  3. classifyRootModules        -> (--all only) roots = candidates never referenced as a local module source
  4. buildTerraformTopology     -> two-pass declare/link build -> TerraformTopology
  5. validateTerraformTopologyStructure -> structural second opinion (duplicate ids, dangling edges, leaked secrets)
  6. checkTerraformMissingEvidence      -> every node/edge has >=1 evidence reference
  7. buildTerraformSceneSubgraphs       -> detail-level filtering + large-topology splitting
  8. renderTerraformMermaid / renderTerraformSvg -> .mmd / .svg per (root, scene part)
  9. checkTerraformLayoutOverlap / checkTerraformLayoutTextOverflow / checkTerraformRendererDivergence
 10. (--format visualdoc) buildTopologyScenes -> standalone <root>.visualdoc.json
 11. cache all built topologies to .rvs/cache/terraform-topologies.json
```

`rvs create slides` reads that cache — if present, `buildVisualDoc` appends
a "Topologies" section with one scene (or split scene group) per cached
topology. Running `rvs create topology` is optional: omit it and `rvs
create slides` produces the deck unchanged.

## Parser selection

The parser is `@cdktf/hcl2json` (`packages/terraform-graph/src/hcl-bridge.ts`)
— a HashiCorp/CDKTF-maintained WASM binary that turns HCL2 source text into
JSON, the same representation `terraform show -json`-adjacent tooling
consumes. It was chosen over hand-rolling an HCL grammar or shelling out to
the real `terraform` binary for three reasons:

- **Deterministic and offline.** It's a pure parser with no state, no
  provider plugins, and no network access — it never runs `terraform init`,
  never contacts the Terraform Registry, and never touches `.tfstate`.
  Parsing the same file twice always yields the same JSON.
- **Real grammar coverage.** HCL2 supports heredocs, nested interpolation,
  `for` expressions, and multiple block-body shapes that a regex-based
  parser would get subtly wrong. Using the actual grammar means the
  topology builder only has to reason about *semantics* (what a `resource`
  block means), not *syntax*.
- **No `terraform` CLI dependency.** `@cdktf/hcl2json` ships as an npm
  package; there's no assumption that a matching Terraform version (or any
  Terraform binary at all) is installed on the machine running `rvs`.

**Trade-off, by design:** the JSON `@cdktf/hcl2json` returns has no
line/column position data, so `hcl-bridge.ts` also includes a small,
non-regex-primary brace-depth lexer (`locateBlock`/`locateLineWithin`) whose
only job is recovering evidence line ranges for blocks the WASM parser
already confirmed exist. It never re-derives Terraform semantics — if the
WASM parser doesn't report a block, the lexer never invents one.

**Packaging.** `@cdktf/hcl2json` stays an installed runtime dependency of
`@rvs/cli` rather than being bundled into the single-file CLI binary (see
`packages/cli/scripts/build.mjs`'s `external: ["playwright",
"@cdktf/hcl2json"]`): its `main.wasm.gz` runtime asset is loaded via a
`path.join(__dirname, ...)`-relative lookup plus a dynamic `require()` of
its own WASM bridge script, both of which only resolve correctly when the
package is installed normally via npm — bundling it would break that
resolution. This mirrors the reason `playwright` is also kept external. See
[`docs/packaging.md`](packaging.md) for the full externalization design.
Once installed, the WASM parser needs no network access to execute — the
whole pipeline runs offline.

## Root-module discovery

`discoverTerraformFiles` globs `**/*.tf` under the repo root, always
excluding (regardless of user config, per `discover.ts`'s
`ALWAYS_EXCLUDE`): `**/.terraform/**`, `**/node_modules/**`, `**/dist/**`,
`.rvs/cache/**`, `artifacts/**`. Non-`.tf` files are never matched at all —
`terraform.tfstate`, `terraform.tfstate.backup`, and `*.tfplan` are excluded
simply by not being `.tf` files, not by a dedicated state-file rule.

`groupIntoDirectories` treats each containing directory of one or more
`.tf` files as a **candidate module**. `classifyRootModules` (used by `--all`)
then does a lightweight pre-pass — parsing just each directory's `module`
blocks — to build the set of directories referenced as a *local* module
`source` by any other candidate; every candidate directory **not** in that
referenced set is a root. This pre-pass runs before the real two-pass build
so root/child classification never depends on which directory the full
build happens to visit first. `rvs create topology --source <dir>` skips
this classification and treats the named directory as a root directly,
regardless of whether some other module also references it locally (an
intentional escape hatch for inspecting a child module in isolation).

## The `TerraformTopology` contract

Defined in `packages/terraform-graph/src/types.ts`.

**Node types** (`TerraformNodeType`): `root-module`, `child-module`,
`external-module`, `resource`, `data-source`, `provider`, `variable`,
`output`, `local`, `backend`, `unknown` (the last reserved for an address
referenced by an expression that never resolves to a declared node).

**Edge types** (`TerraformEdgeType`): `depends-on` (explicit `depends_on`),
`references` (a static resource/variable/local cross-reference),
`contains` (module → its own resources/data sources/variables/outputs),
`calls-module` (module → child/external module it declares),
`uses-provider` (resource → the provider node configuring it),
`reads-from` (resource/output → data source), `produces-output`
(resource/local → an `output` block that references it), `passes-input`
(a resource/variable feeding a module call's input), `exports` (child
module output → root-level reference to `module.x.y`), `connects-to`
(reserved for future cross-resource network-adjacency inference — not
currently emitted), `unresolved-reference` (an expression that named an
address the builder couldn't resolve to any declared node).

Every node and edge carries `evidence: EvidenceReference[]` (always
non-empty — enforced by `checkTerraformMissingEvidence`, error severity if
violated) and a `status: ArchitectureNodeStatus` — `"confirmed"` for a
literal or fully statically-resolvable value, `"partial"` for an expression
resolved down to a `path.*`/`terraform.workspace`-style build-time constant,
`"dynamic"` for anything whose actual value depends on evaluating Terraform
(including, conservatively, **any** reference to a resource attribute,
`var.*`, `local.*`, `module.*`, or `data.*` address — see "Static-reference
extraction" below for why), and `"unresolved"` for a syntactically-dynamic
value with no extractable interpolation body, or a genuinely unresolved
address. **The builder never infers a relationship that isn't explicitly
present in the HCL** — an address that doesn't resolve becomes an `unknown`
node plus an `unresolved-reference` edge (and a
`TERRAFORM_UNRESOLVED_REFERENCE` warning), not a guessed edge.

IDs are deterministic and derived purely from module path + Terraform
address (`packages/terraform-graph/src/ids.ts`) — e.g.
`terraform:resource:module.logging.aws_cloudwatch_log_group.app`,
`terraform:edge:references:<source>-><target>` — so re-parsing the same
commit always produces the same node/edge ids, and the same topology always
renders identically.

## Static-reference extraction

`packages/terraform-graph/src/expressions.ts` classifies every non-literal
HCL value the parser preserves as source text (`${...}` interpolation
markers, never evaluated):

- `extractInterpolations` pulls out each `${ ... }` body (one level of
  brace-nesting tracked — deeply nested `for`-expressions or object
  constructors may not have every internal address extracted; this is a
  documented limitation, not a silent failure, since the owning node/edge
  is still correctly marked dynamic either way).
- `extractReferenceAddresses` conservatively extracts dotted identifier
  chains (`aws_vpc.main.id`, `module.network.vpc_id`, `var.region`) from an
  expression body, skipping function calls (`jsonencode(...)`) and
  mid-chain fragments. A chain is either found verbatim in the source or
  it's not reported — never guessed.
- `classifyExpressionConfidence` then assigns overall confidence:
  `count.`/`each.`/`self.` prefixes are always `"dynamic"` (they vary per
  resource instance and can never resolve to one fixed target, regardless
  of syntax validity); `path.root`/`path.module`/`path.cwd`/
  `terraform.workspace` are `"partially-resolved"` (fixed at parse time,
  independent of `apply`-time context); **every other reference — including
  a resource-address reference like `aws_vpc.main.id`** — is conservatively
  classified `"dynamic"`, because resolving what `aws_vpc.main.id` actually
  *is* requires running Terraform. The topology still creates the
  `references` edge (the *relationship* is statically visible in the HCL),
  but the *value* stays unresolved.

This is the single most important behavior to understand when reading a
topology: **a static cross-reference between two resources is fully
captured as an edge, but the referencing node's own status is still
`"dynamic"`** unless every one of its own expressions is a literal.

## Modules

**Local modules** (`source` starting with `./` or `../`) are fully
resolved: `resolveLocalModuleSource` computes the repo-relative target
directory, and if `.tf` files exist there, the child module's own
resources/variables/outputs are declared as real nodes (type
`child-module`), linked to the parent via `calls-module`/`contains`, with
inputs linked via `passes-input` and referenced outputs linked via
`exports`. If no `.tf` files exist at the resolved path, a
`TERRAFORM_LOCAL_MODULE_NOT_FOUND` warning is emitted and the module is
represented the same way as an external module (below), rather than
silently dropped.

**Remote/registry modules** (Terraform Registry shorthand like
`terraform-aws-modules/vpc/aws`, `git::`/`.git`/`github.com` sources, or
anything else non-local) are intentionally **opaque**: represented as a
single `external-module` node (status `"unresolved"`, metadata capturing
`source`/`sourceKind`/`version` but nothing about the module's internals),
with an informational `TERRAFORM_REMOTE_MODULE_OPAQUE` warning. `rvs` never
downloads or clones a remote module's source — its internal resources are
never inspected, because they aren't checked into the scanned repository.

## Security

- **Sensitive variables/outputs**: a `variable`/`output` block's
  `sensitive = true` is tracked on `TerraformVariableSummary`/
  `TerraformOutputSummary`, and any value flowing from a sensitive variable
  into a resource attribute is redacted before it reaches node/edge
  metadata (`TERRAFORM_SENSITIVE_VALUE_REDACTED`).
- **Sensitive-looking attribute names**: independent of the `sensitive`
  flag, any resource/provider/backend attribute whose key matches
  `password`, `secret`, `token`, `private_key`, `access_key`,
  `client_secret`, or `connection_string` (case-insensitive substring,
  `packages/terraform-graph/src/redact.ts`'s `SENSITIVE_KEY_PATTERNS`) is
  replaced with `"[redacted]"` in metadata — deliberately compound patterns
  (`access_key`, not bare `key`) so identifiers like `key_name` are never
  redacted just for containing a substring.
- **Secondary safety net**: `redactValueText` re-runs `@rvs/core`'s
  general-purpose secret scanner over raw expression/attribute text, to
  catch anything a key-name pattern didn't anticipate.
- **State/plan/cache exclusion**: `terraform.tfstate`,
  `terraform.tfstate.backup`, `*.tfplan`, and everything under
  `.terraform/**` are never scanned — not via content filtering, but
  because discovery only ever globs `*.tf` files and `.terraform/**` is
  always excluded, even when it happens to contain a `.tf` file (verified
  by the `ignored-dot-terraform` fixture).
- **Backend configuration**: `terraform { backend "..." { ... } }`
  attributes go through the same `redactAttributes` pass as any other
  block, so a backend block's access keys or connection strings are
  redacted identically to a resource's.
- **Structural spot-check**: `validateTerraformTopologyStructure` re-scans
  every node's final serialized metadata with the same secret scanner and
  raises `TERRAFORM_SENSITIVE_VALUE_REDACTED` at **error** severity if
  anything still matches — a genuine gap here is a bug to fix, not a
  warning to suppress.

## The `topology` VisualDoc scene

Defined in `packages/visualdoc-schema/src/schema.ts` as
`TopologySceneSchema`, mirroring `WorkflowSceneSchema`'s `graph_id` contract
exactly but under different field names. A topology scene never embeds
parser or renderer output — it references a `TerraformTopology` by
`topology_id`, plus:

- `detail_level` (`TerraformDetailLevelSchema`, default
  `"modules-and-key-resources"`)
- `direction`: `"left-to-right" | "top-to-bottom"` (default
  `"top-to-bottom"`)
- `highlight: string[]` — node/edge ids to draw with an accent stroke
- `part_index` (default `0`) — unlike workflow scenes' manually-assigned
  `focus_nodes`, a topology scene's split index is derived deterministically
  by `buildTerraformSceneSubgraphs(topology, detail_level, [])[part_index]`,
  so only the index (not a node-id set) needs to be persisted here

`renderer-html`'s `renderTopologyScene`
(`packages/renderer-html/src/scenes/topology.ts`) resolves `topology_id`
against a `Map<string, TerraformTopology>` passed into
`renderVisualDocToHtml`, re-derives the same scene part via
`buildTerraformSceneSubgraphs`, and renders it via the native SVG renderer
(never Mermaid — Mermaid's `.mmd` output is a separate artifact for
external tools, not embedded in the HTML deck). It keeps its own
self-contained, deterministic color palette (matching the Mermaid/SVG
renderers' shared node-type defaults) rather than mapping
`TerraformNodeType`s onto the design system's small general-purpose token
set — the same documented trade-off `renderWorkflowScene` makes.

## Rendering

### Mermaid (`packages/terraform-mermaid`)

`renderTerraformMermaid(topology, scenePart)` emits a `flowchart` block plus
`%% node <id> evidence=...` / `%% edge <id> evidence=...` comments, so
evidence and identity survive in the plain-text format. Shapes/styles are
chosen per `TerraformNodeType`/`TerraformEdgeType` (e.g. distinct shapes for
modules vs. resources vs. data sources, dashed edges for dynamic/unresolved
relationships).

### Native SVG (`packages/terraform-svg`)

`renderTerraformSvg(topology, scenePart)`:

1. Consumes the same `TerraformSceneSubgraph` (from
   `buildTerraformSceneSubgraphs`) that the Mermaid renderer consumes —
   never re-derives its own node/edge selection.
2. Computes layout via `@rvs/workflow-svg`'s shared `LayeredLayoutEngine` —
   the same deterministic, sorted-by-id Kahn's-algorithm layering used for
   `WorkflowGraph` diagrams, reused rather than reimplemented.
3. Suffixes dynamic/unresolved node labels with `" [status]"` before
   measuring/truncating, so a viewer can tell at a glance which nodes carry
   unresolved values without opening the evidence panel.
4. Emits self-contained SVG: no external fonts, no `<script>` tags, no
   external URLs. Each node/edge carries `data-node-id`/`data-edge-id`,
   `data-node-type`, `data-status`, and `data-evidence` attributes.
5. Renders label text at the same 14px floor the Playwright validator's
   `min-font-size` check enforces on every scene — not a diagram-specific
   carve-out.

## Large-topology behavior

`buildTerraformSceneSubgraphs(topology, detailLevel, warnings)` implements
four detail levels (`TerraformDetailLevel`), shared by both renderers:

| `detail_level` | Shows |
|---|---|
| `modules` | module nodes (root/child/external) only |
| `modules-and-resources` | modules + every resource/data-source node |
| `modules-and-key-resources` (default, used by `rvs create topology`) | modules + only resources/data sources that participate in at least one non-`contains` relationship (isolated leaf resources are hidden) |
| `full` | the entire topology, unfiltered |

When the selected node count exceeds **25** (`MAX_VISIBLE_NODES`), the
result is deterministically split into multiple scene parts:

1. Visible nodes are grouped by their nearest containing module (walking
   `contains` edges), so a split never separates a module's own resources
   across two scenes.
2. Groups are greedily packed into parts, each capped at 25 nodes, in
   stable module order.
3. An informational `TERRAFORM_COMPONENT_SPLIT` warning is emitted once per
   split, naming the resulting part count.

**Known edge of this design**: splitting only ever occurs *across* module
groups — a single flat module whose own resource count exceeds 25 cannot be
split further internally (its whole group is one packing unit). The
`large-topology` fixture (`packages/terraform-graph/src/__tests__/fixtures/large-topology/`)
is deliberately composed with three child modules specifically to exercise
a genuine cross-module split, and does so successfully; a single-module
30-resource root would instead produce one oversized scene with no crash,
just a scene over the visible-node target. This mirrors
`WORKFLOW_TOO_LARGE`'s equivalent connected-component chunking in the
workflow engine, minus its same-component sub-chunking (Terraform's
module-boundary groups are the only chunking unit for this slice).

## Warning codes

Emitted during discovery/parsing/building (`topology.ts`,
`scene-subgraph.ts`):

| Code | Severity | Meaning |
|---|---|---|
| `TERRAFORM_PARSE_ERROR` | error | a `.tf` file failed to parse as valid HCL2 |
| `TERRAFORM_UNSUPPORTED_BLOCK` | warning | a top-level HCL block type isn't one of `terraform`/`provider`/`variable`/`locals`/`resource`/`data`/`output`/`module` (e.g. `moved`, `import`, `check`) and was skipped |
| `TERRAFORM_DYNAMIC_EXPRESSION` | informational | a node/edge's value depends on an unresolvable expression |
| `TERRAFORM_UNRESOLVED_REFERENCE` | warning | an address referenced by an expression doesn't resolve to any declared node |
| `TERRAFORM_UNKNOWN_DEPENDS_ON` | warning | an explicit `depends_on` entry doesn't resolve to a real resource/module |
| `TERRAFORM_LOCAL_MODULE_NOT_FOUND` | warning | a local `module` source resolves to a directory with no `.tf` files |
| `TERRAFORM_REMOTE_MODULE_OPAQUE` | informational | a remote/registry module is represented as an opaque node |
| `TERRAFORM_SENSITIVE_VALUE_REDACTED` | informational (build-time) / error (structural spot-check failure) | a sensitive value was redacted, or — if raised by `validateTerraformTopologyStructure` — one wasn't and still is |
| `TERRAFORM_RESOURCE_ADDRESS_COLLISION` | error | two resources/data sources share the same address within a module |
| `TERRAFORM_PROVIDER_UNRESOLVED` | warning | a resource's `provider =` reference doesn't resolve to a declared provider |
| `TERRAFORM_GRAPH_TOO_LARGE` | warning | reserved for a whole-topology size warning (see Known limitations) |
| `TERRAFORM_COMPONENT_SPLIT` | informational | a scene exceeded the 25-visible-node limit and was split along module boundaries |
| `TERRAFORM_LABEL_TRUNCATED` | warning | reserved; label truncation is currently reported via `TERRAFORM_LAYOUT_TEXT_OVERFLOW` |
| `TERRAFORM_LAYOUT_OVERLAP` | error | two nodes' computed bounding boxes intersect |
| `TERRAFORM_LAYOUT_TEXT_OVERFLOW` | warning | a node's label had to be truncated to fit its box |
| `TERRAFORM_RENDERER_DIVERGENCE` | error | Mermaid and SVG output cover different node/edge ids for the same scene part |
| `TERRAFORM_MISSING_EVIDENCE` | error | a node/edge has zero evidence references |
| `TERRAFORM_DUPLICATE_NODE_ID` | error | two nodes share an id |
| `TERRAFORM_DUPLICATE_EDGE_ID` | error | two edges share an id |
| `TERRAFORM_DANGLING_EDGE` | error | an edge references a node id that doesn't exist |

`rvs create topology` runs structural validation, evidence checks, and
render checks for every topology it processes and logs findings; it does
not gate CI by itself (that remains `rvs validate --ci`, which runs its
existing deck.html/Playwright checks — including `min-font-size` — against
the rendered deck as a whole, topology scenes included).

## Known limitations

These are the tested, actual limitations of this slice — not aspirational
ones:

- **No Terraform execution of any kind.** `rvs` never runs `terraform
  init`/`plan`/`apply`/`validate`, never reads `.tfstate` or `.tfplan`
  files (both are excluded from discovery outright), never calls a cloud
  provider API, and never downloads a remote/registry module's source.
- **Dynamic expressions are never evaluated.** `count`, `for_each`, ternary
  conditionals, and any function call are preserved as unresolved text —
  no `count.index`-expanded resource instances are fabricated, and a
  resource gated behind a `count`/`for_each` that could evaluate to zero is
  never assumed to exist or not exist.
- **Resource-attribute references are conservatively "dynamic".** As
  described above, even a fully static-looking reference like
  `aws_subnet.app.vpc_id` marks the referencing node's status as `dynamic`,
  since the attribute's actual value requires running Terraform to know.
  The *edge* (the relationship) is still captured with full confidence.
- **Deep expression nesting may under-extract references.**
  `extractInterpolations` only tracks one level of brace nesting; a
  reference address buried inside a nested `for`-expression or object
  constructor may not produce its own edge, even though the owning
  node/edge is still correctly marked dynamic.
- **A single oversized flat module cannot be split internally.** Scene
  splitting only chunks across module boundaries (see "Large-topology
  behavior"); a root module with more than 25 resources and no child
  modules produces one large scene rather than several smaller ones.
- **`TERRAFORM_GRAPH_TOO_LARGE` and `TERRAFORM_LABEL_TRUNCATED` are declared
  but not currently emitted** — whole-graph size and label truncation are
  currently only surfaced via `TERRAFORM_COMPONENT_SPLIT` and
  `TERRAFORM_LAYOUT_TEXT_OVERFLOW` respectively. The codes remain reserved
  in the type contract for a future, more granular warning.
- **`connects-to` is declared but not currently emitted** — reserved for a
  future cross-resource network-adjacency inference pass; no such inference
  runs in this slice.
- **No workspace/module-registry version resolution.** A module's declared
  `version` constraint is captured as metadata only; it's never checked
  against a real registry or resolved to one concrete version.
- **`rvs inspect`'s generic evidence scanner has no Terraform adapter.**
  Ordinary repository inspection (README/docs/source/manifest scanning) is
  unaffected by and unaware of any `.tf` files in the repository — Terraform
  content only ever enters the pipeline through an explicit `rvs create
  topology` invocation.

## Extension path

The shared primitives introduced by this slice — `@rvs/architecture-graph`'s
`ArchitectureNode`/`ArchitectureEdge`/`EvidenceReference` types, the
declare/link two-pass construction pattern, the deterministic
directory-scoped ID scheme, the detail-level + module-boundary scene
splitting shape, and the layout/evidence/divergence validator pattern — are
the intended reuse surface for a future repository-dependency-mapping
adapter (explicitly out of scope for this slice per the governing closure
spec). Such an adapter would define its own node/edge type unions and its
own declare/link builder, but could reuse `@rvs/workflow-svg`'s layout
engine, `@rvs/architecture-graph`'s evidence contract, and the same
"structural validator + render-check validator, both pure functions over
already-computed artifacts" split this slice and the workflow slice both
follow.

## Package summary

| Package | Role |
|---|---|
| `@rvs/architecture-graph` | shared `ArchitectureNode`/`ArchitectureEdge`/`EvidenceReference`/`ArchitectureNodeStatus` primitives, used by both `WorkflowGraph` and `TerraformTopology` |
| `@rvs/terraform-graph` | discovery, HCL parsing bridge, expression classification, `TerraformTopology` types, two-pass declare/link builder, structural validation, `buildTerraformSceneSubgraphs` |
| `@rvs/terraform-mermaid` | `TerraformTopology` scene part → Mermaid flowchart text |
| `@rvs/terraform-svg` | `TerraformTopology` scene part → native SVG, reusing `@rvs/workflow-svg`'s `LayeredLayoutEngine` |
| `@rvs/visualdoc-schema` | adds `TopologySceneSchema` / `TerraformDetailLevelSchema` |
| `@rvs/narrative-planner` | `buildTopologyScenes` — topology → scene(s), with large-topology splitting |
| `@rvs/renderer-html` | `renderTopologyScene` — resolves `topology_id`, renders via `@rvs/terraform-svg` |
| `@rvs/validator` | `terraform-checks.ts` — evidence/layout/divergence checks |
| `@rvs/cli` | `rvs create topology` command; `rvs create slides` cache integration |
