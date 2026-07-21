# Architecture Knowledge Graph & Impact Analysis (Milestone 9)

This document describes the Architecture Knowledge Graph: a unifying layer
sitting on top of all six upstream intelligence artifacts (Architecture,
Capability, Product, Portfolio, Governance, and Decision Intelligence),
rather than beside or above any single one of them. It reads each upstream
artifact's own already-computed output as untyped JSON — never re-scanning
repository source, never re-synthesizing an upstream fact, and never
importing an upstream package's types — and unifies them into one queryable
graph of typed nodes and typed, directed edges. On top of that graph it
provides bounded traversal, shortest/all-path finding, impact and
blast-radius analysis, governance root-cause grouping, decision-invalidation
analysis, and change planning, plus a presentation profile and a full CLI
surface. This document covers the package as a whole — its contracts,
construction pipeline, ids, snapshot/compatibility/diff/validation
machinery, CLI, and presentation wiring — and defers the deep technical
detail of each analysis engine to its own companion document (see "See
also" at the end).

```
architecture-intelligence.json  \
capability-model.json            \
product-identity-model.json       \  read as untyped JSON, never imported as types
portfolio-model.json              /
governance-report.json + policies/
decision-*.json (6 decision artifacts)  /
  -> resolveRepositoryId()                          (graph-builder.ts, step 0)
  -> buildAllNodes() (15 per-domain builders)        (node-builder.ts, step 1)
  -> deduplicateNodes()                              (identity.ts, step 2)
  -> buildAllEdges() (per-domain builders)           (edge-builder.ts, step 3)
  -> dedupeEdges()                                   (graph-builder.ts, step 4)
  -> assessGraphCompatibility()                      (compatibility.ts, step 5)
  -> resolveUnresolvedReferences()                   (graph-builder.ts, step 6)
  -> sortNodesAndEdges()                             (graph-builder.ts, step 7)
  -> buildGraphSnapshot()                            (snapshot.ts, step 8)
  -> KnowledgeGraphBuildResult { nodes, edges, compatibility, snapshot, ... }
  -> groupRootCauses() / computeDecisionImpact() / validateGraph()
  -> buildKnowledgeGraphNarrative() -> buildKnowledgeGraphPlan()
  -> rvs graph build|validate|inspect|impact|path|roots|compare|plan-change|explain
  -> rvs export graph-report / impact-summary
  -> rvs create slides --profile knowledge-graph        (docs/graph-showcase.md)
```

Scope: **unification, traversal, and impact/root-cause/decision/change
reasoning over already-computed upstream intelligence artifacts.** No
repository re-scanning, no re-synthesis of upstream facts, no code
modification, no automatic decision creation, and no cross-package
`@rvs/*` runtime dependency of any kind.

## Design mandate

> The knowledge graph may connect facts that six upstream layers already
> computed independently, but it must never invent a relationship those
> layers didn't already assert, never silently drop a reference it cannot
> resolve, and never collapse "there was no way to even ask" into "the
> answer is no."

Concretely:

- **Zero cross-package `@rvs/*` runtime or type dependency.** `packages/knowledge-graph`
  imports nothing from `@rvs/architecture-intelligence`,
  `@rvs/capability-intelligence`, `@rvs/product-intelligence`,
  `@rvs/portfolio-intelligence`, `@rvs/governance-intelligence`, or
  `@rvs/decision-intelligence` at either the runtime or the type level.
  Every upstream shape it reads is a local structural echo declared in
  `node-builder.ts`/`edge-builder.ts` (only the fields those modules
  actually read), not an imported contract — the same convention
  `@rvs/decision-intelligence` and `@rvs/governance-intelligence` already
  established for each other.
- **Extraction only, never inference from a shared name or path.**
  `edge-builder.ts`'s own header states this directly: every edge comes
  from an upstream artifact's own already-computed relationship field
  (`logicalComponents`, `affected_entity_ids`, `supersedes`, and so on) —
  never inferred because two entities happen to share a word, title, or
  file path.
- **Unresolved is always kept, never dropped, and never conflated with
  "no relationship."** A dangling edge endpoint is promoted to a dedicated
  `unresolved_reference` node (`graph-builder.ts`'s
  `resolveUnresolvedReferences()`, pipeline step 6) rather than discarded
  or silently pointed nowhere. Blast-radius analysis reserves a distinct
  `"isolated"` (asked, found zero neighbors) versus `"unresolved"` (no way
  to even ask — the target itself is missing or the traversal reached zero
  edges) — the two are never collapsed into one meaning. See
  [docs/graph-impact-analysis.md](graph-impact-analysis.md).
- **Deterministic, pure-function ids everywhere** (`ids.ts`) — never a
  timestamp, wall-clock time, or array/iteration index. `canonicalize()` +
  SHA-256 `digestOf()` produce every snapshot digest deterministically from
  sorted node/edge id lists.
- **Decision state is read, never re-derived.** `decision-impact.ts`
  classifies against already-computed `decision_status`/
  `implementation_status`/assumption-state fields from
  `@rvs/decision-intelligence`'s own cached output — it never reopens or
  re-runs decision analysis itself, and it never approves, rejects, or
  invalidates a decision on its own authority; see
  [docs/graph-decision-impact.md](graph-decision-impact.md).
- **Bounded traversal, never silently partial.** Every BFS/DFS traversal in
  `traversal.ts`/`path-finding.ts` is depth- and result-limited
  (`DEFAULT_MAX_TRAVERSAL_DEPTH`, `DEFAULT_MAX_ALL_PATHS_DEPTH`,
  `DEFAULT_RESULT_LIMIT`); hitting a limit always sets `truncated: true`
  rather than returning a result that looks complete but isn't.

## Core artifact model

`KnowledgeNode` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `graph:node:<sanitized-source-entity-id>` — see "Ids" below. |
| `node_type` | `KnowledgeNodeType` (19 values) | See list below. |
| `source_artifact` | `UpstreamSourceArtifact` (6 values) | `architecture`\|`capability`\|`product`\|`portfolio`\|`governance`\|`decision`. |
| `source_entity_id` | string | The upstream artifact's own id for this entity. |
| `label` | string | Human-readable display label. |
| `evidence_refs` | `EvidenceRef[]` | `{ path?, lines?, source_artifact?, detail? }`. |
| `resolution_status` | `ResolutionStatus` (3 values) | `resolved`\|`unresolved`\|`partial`. |
| `schema_version` | number | Currently `1` for every node. |
| `repository_id` | string | Resolved once per build; see "Construction pipeline" below. |
| `confidence` | `ConfidenceLevel` (3 values) | `confirmed`\|`qualified`\|`unverifiable`. |

`KnowledgeNodeType` (19 values, `contracts.ts`): `repository`, `component`,
`package`, `workflow`, `runtime_entrypoint`, `command`, `capability`,
`capability_domain`, `product`, `portfolio_relationship`, `policy`,
`governance_finding`, `decision`, `decision_assumption`,
`decision_consequence`, `baseline`, `evidence`, `presentation`,
`unresolved_reference`.

`KnowledgeEdge` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `graph:edge:<from>:<edgeType>:<to>` — see "Ids" below. |
| `edge_type` | `KnowledgeEdgeType` (21 values) | See list below. |
| `from_node_id` / `to_node_id` | string | |
| `direction` | `"directed"` | Every edge is directed; there is no undirected edge kind. |
| `evidence_refs` | `EvidenceRef[]` | |
| `resolution_status` | `EdgeResolutionStatus` (5 values) | `resolved`\|`unresolved`\|`partial`\|`ambiguous`\|`incompatible`. |
| `detail` | string | Human-readable explanation of *why* this edge exists (which upstream field produced it). |

`KnowledgeEdgeType` (21 values, `contracts.ts`): `contains`, `depends_on`,
`invokes`, `implements`, `exposes`, `supports`, `governs`, `violates`,
`explains`, `justifies`, `requires`, `constrains`, `supersedes`,
`invalidates`, `affects`, `produces`, `consumes`, `references`,
`evidenced_by`, `presented_in`, `inherits_risk_from`.

`CAUSAL_EDGE_TYPES` (`constants.ts`, used by root-cause grouping and cycle
detection) is a 6-value subset: `contains`, `depends_on`, `invokes`,
`implements`, `produces`, `consumes`.

## Construction pipeline

This section covers `node-builder.ts`, `edge-builder.ts`, `identity.ts`, and
`graph-builder.ts`. `graph-builder.ts`'s `buildKnowledgeGraph()` runs a fixed
8-step pipeline:

1. **Resolve repository identity** (`resolveRepositoryId()`) — fallback
   chain: `architecture.identity.id` → `governance.repository_id` →
   `decision.repository_id` → a caller-supplied `repositoryIdHint`; throws
   if none resolve.
2. **Build all nodes** (`buildAllNodes()`) — calls 15 per-domain node
   builders across all 6 upstream domains (repository, component, workflow,
   runtime-entrypoint from architecture; capability, capability-domain from
   capability; product identity from product; portfolio product,
   portfolio-relationship from portfolio; policy, governance-finding,
   baseline from governance; decision, decision-assumption,
   decision-consequence from decision; plus evidence nodes for every
   upstream evidence entry that already carries a stable id), then
   `deduplicateNodes()` (`identity.ts`) collapses any exact
   `(source_artifact, source_entity_id)` match — first-encountered wins, the
   collision recorded, never fuzzy-matched.
3. **Build all edges** (`buildAllEdges()`) — per-domain edge builders read
   each upstream artifact's own already-computed relationship fields only
   (see "Design mandate" above); returns edges tagged by originating domain.
4. **Dedupe edges** (`dedupeEdges()`) — edges sharing the same
   `(from_node_id, to_node_id, edge_type)` collapse to one id; if their
   `detail`/`resolution_status` also match, the duplicate merges silently
   (evidence refs unioned); if they differ, the first-encountered edge is
   kept and the disagreement is recorded as a `DuplicateEdgeFinding` rather
   than silently discarded.
5. **Assess compatibility** (`assessGraphCompatibility()`) — see
   "Compatibility and snapshots" below.
6. **Resolve unresolved references** (`resolveUnresolvedReferences()`) — any
   edge endpoint that doesn't match a real node id is promoted to a new
   `unresolved_reference` node, and the citing edge's own
   `resolution_status` is downgraded to `"unresolved"`.
7. **Deterministic ordering** (`sortNodesAndEdges()`) — nodes sorted by
   `id`; edges sorted by `(edge_type, from_node_id, to_node_id)` — so two
   builds from identical inputs always produce byte-identical node/edge
   arrays regardless of upstream artifact iteration order.
8. **Snapshot** (`buildGraphSnapshot()`) — see "Compatibility and snapshots"
   below.

`buildKnowledgeGraph()` returns a `KnowledgeGraphBuildResult`:
`{ repository_id, nodes, edges, compatibility, identity_collisions,
duplicate_edge_findings, unresolved_reference_node_ids, snapshot }`.

### Known, disclosed scope trims in node/edge extraction

- **Three declared `KnowledgeNodeType` values are never populated:**
  `package`, `command`, and `presentation`. `node-builder.ts`'s own header
  comment states why: none of the six upstream artifacts currently expose a
  clean, already-computed, uniquely-identified inventory of workspace
  packages, CLI commands, or presentation deliverables distinct from what
  `component`/`runtime_entrypoint` already cover, and populating them would
  require re-deriving facts the upstream layers never assigned a stable id
  to — which the extraction-only design mandate forbids. Presentation reach
  is instead covered narrowly by `change-planning.ts`'s evidence-path
  pattern matching (see [docs/graph-change-planning.md](graph-change-planning.md)).
- **Several upstream enum fields are read conservatively rather than
  precisely mapped**, because their exact values weren't independently
  re-verified against the live upstream contract at implementation time:
  `GovernanceFinding.result` is never read (only the always-present
  `policy_id` link backs a `governs` edge — `violates` is never asserted
  from it), `PortfolioDependencyEdge.kind` maps to the generic `depends_on`
  edge type with the original kind string preserved in `detail`, and
  `DecisionLink.link_type` maps to the generic `references` edge type the
  same way.
- **`actors`/`externalSystems` (capability-intelligence) and governance's
  baseline internals are not read by `edge-builder.ts`** — neither maps to a
  node type this package creates further edges toward.

## Ids

All builders live in `ids.ts` and are pure functions of stable content —
never a timestamp or iteration index:

`buildNodeId(sourceEntityId)`, `buildEdgeId(edgeType, fromNodeId, toNodeId)`,
`buildPathId(fromNodeId, toNodeId, nodeIdsInOrder)`,
`buildImpactResultId(rootEntityId, queryDigest)`,
`buildRootCauseGroupId(rootNodeId)`,
`buildDecisionImpactId(decisionNodeId, rootEntityId)`,
`buildChangePlanId(removedEntityId)`,
`buildSnapshotId(repositoryId, sortedUpstreamDigestTokens)`,
`buildChangeSetId(sourceSnapshotId, targetSnapshotId)`,
`buildNarrativeId(snapshotId)`, `buildPlanId(snapshotId)`,
`buildSceneId(planId, kind)`, `buildReportId(snapshotId)`,
`buildValidationFindingId(code, subjectId)`, plus the exported helpers
`sanitize()`, `canonicalize()`, and `digestOf()` (canonical-JSON + SHA-256,
underlying every deterministic digest in this package).

## Traversal, impact analysis, root-cause grouping, decision impact, and change planning

These five engines share `traversal.ts`'s bounded BFS (`buildEdgeIndex()` +
`collectCandidateEdges()` + `traverse()`) and are each documented in their
own companion file:

- **Traversal, shortest/all-path finding, impact analysis, and blast
  radius** — [docs/graph-impact-analysis.md](graph-impact-analysis.md)
  (`traversal.ts`, `path-finding.ts`, `impact-analysis.ts`,
  `blast-radius.ts`).
- **Governance root-cause grouping** —
  [docs/graph-root-cause.md](graph-root-cause.md) (`root-cause.ts`).
- **Decision invalidation analysis** —
  [docs/graph-decision-impact.md](graph-decision-impact.md)
  (`decision-impact.ts`).
- **Change planning** —
  [docs/graph-change-planning.md](graph-change-planning.md)
  (`change-planning.ts`).

`graph-core.ts` provides the shared generic-graph primitives all of the
above (and `diff.ts`) build on: `buildGenericGraph()` (sorted adjacency map,
deterministic regardless of input order), `findCycles()` (bounded
simple-path DFS, rotation-invariant dedup via `normalizeCycleKey()`), and
`findOrphanNodes()`.

## Compatibility and snapshots

This section covers `compatibility.ts` and `snapshot.ts`.

`assessGraphCompatibility()` runs a 6-stage staged short-circuit assessment
(mirroring `@rvs/governance-intelligence`'s own staged model, extended here
to 6 numbered stages over up to 6 upstream artifacts) that resolves to one
of 4 `CompatibilityStatus` values:

1. No artifact present at all → `incompatible`.
2. Repository identity disagreement across artifacts → `incompatible`.
3. An artifact's `schema_version` isn't in `SUPPORTED_SCHEMA_VERSIONS`
   (currently `[1]` for every one of the 6 domains) → `incompatible`.
4. One or more artifacts missing (but at least one present and
   identity-consistent) → `partial`.
5. `source_generated_at` disagreement across present artifacts →
   `compatible_with_warnings`.
6. Otherwise → `compatible`.

`isBuildableStatus(status)` returns `status !== "incompatible"` — a
`partial` or `compatible_with_warnings` graph still builds; only
`incompatible` blocks construction.

`buildGraphSnapshot()` (`snapshot.ts`) builds a `GraphSnapshot` whose id is
`buildSnapshotId(repositoryId, sortedTokens)`, where each token is either
the upstream artifact's own `snapshot_id` (when present) or a fallback
`"<artifact>:<provenance>"` string, and whose digest is
`digestOf({ node_ids: sorted, edge_ids: sorted })`.
`buildUpstreamArtifactDigest()` derives each artifact's `ArtifactProvenance`
(`complete`\|`partial`\|`unavailable`): not present → `unavailable`; present
with a `snapshot_id` → `complete`; present without one → `partial`.

`diff.ts`'s `diffGraphs(source, target, options)` computes a
`GraphChangeSet` across 11 comparison facets (nodes/edges added/removed,
entity types changed, relationships changed, dependency paths changed,
impact radius increased/decreased, new orphans, new cycles, root causes
introduced/resolved, decision dependencies changed, governance reach
changed). It is deliberately **caller-scoped, not all-pairs**: `DiffOptions`
accepts optional `impactQueryEntityIds`/`pathQueries` naming exactly which
entities' impact/paths to re-check — an unscoped all-pairs comparison would
be combinatorially unbounded, and this package never attempts it silently.

## Validation

`validation.ts` exports three functions — `validateGraph(result,
rootCauseGroups)`, `validateImpactQuery(query)`, and `validatePathQuery(fromNodeId,
toNodeId, options, allPaths)` — each returning `ValidationFinding[]`
(`{ id, code, message, subject_id, blocking }`). Codes, grouped by what they
guard:

| Code | Blocking | Guards |
|---|---|---|
| `GRAPH_NODE_DUPLICATE_ID` | Yes | Two distinct nodes sharing one id. |
| `GRAPH_EDGE_SELF_LINK` | No | An edge whose `from_node_id === to_node_id`. |
| `GRAPH_EDGE_MISSING_ENDPOINT` | Yes | An edge endpoint with no corresponding node. |
| `GRAPH_EDGE_DUPLICATE` | No | A `(from, to, edge_type)` collision with disagreeing detail/status (see pipeline step 4). |
| `GRAPH_IDENTITY_COLLISION` | Yes | Two source entities colliding on the same node id. |
| `GRAPH_REFERENCE_BROKEN` | No | A promoted `unresolved_reference` node. |
| `GRAPH_CYCLE_INVALID_CONTAINMENT` | Yes | A cycle over `contains`-only edges (containment must be acyclic). |
| `GRAPH_CYCLE_DETECTED` | No | A cycle over the full causal edge-type set. |
| `GRAPH_ROOT_CAUSE_INSUFFICIENT_ANCHOR` | No | A root-cause group with no confidently resolved anchor. |
| `GRAPH_DECISION_UNRESOLVED_REFERENCE` | No | A decision-impact entry that couldn't resolve its target. |
| `GRAPH_COMPATIBILITY_INCOMPATIBLE_SET` | Yes | `assessGraphCompatibility()` returned `incompatible`. |
| `GRAPH_COMPATIBILITY_PARTIAL_SET` | No | `assessGraphCompatibility()` returned `partial`. |
| `GRAPH_COMPATIBILITY_WARNING` | No | `assessGraphCompatibility()` returned `compatible_with_warnings`. |
| `GRAPH_IMPACT_INVALID_DEPTH` | Yes | An `ImpactQuery.max_depth` that's non-positive or non-integer. |
| `GRAPH_IMPACT_UNBOUNDED_DEPTH` | Yes | An `ImpactQuery.max_depth` exceeding `MAX_ALLOWED_QUERY_DEPTH` (50). |
| `GRAPH_PATH_INVALID_DEPTH` | Yes | An invalid path-query depth. |
| `GRAPH_PATH_UNBOUNDED_DEPTH` | Yes | A path-query depth exceeding `MAX_ALLOWED_QUERY_DEPTH`. |
| `GRAPH_PATH_ALL_PATHS_DEPTH_HIGH` | No | An `--all` path query with a depth high enough to risk a large result set. |

## Explain

`explain.ts`'s `explainGraphId(id, context)` is a pure function (no
filesystem or logger access — the CLI's `graph-explain.ts` is the only
try/catch site) that resolves an id across a fixed fallback chain: node →
edge → path → impact-result → root-cause-group → decision-impact →
change-plan. If nothing resolves, it throws:

```
No node, edge, path, impact-result, root-cause-group, decision-impact, or
change-plan found matching id "<id>". Run `rvs graph build` first, then
re-check the id against the cached knowledge-graph artifacts.
```

## Narrative and presentation

`narrative.ts`'s `buildKnowledgeGraphNarrative()` composes a fixed 13-section
`KnowledgeGraphNarrative` (Headline, Graph inventory, Relationship
landscape, Critical dependency paths, Component/capability impact, Product
and portfolio reach, Governance root causes, Decision dependencies,
Invalidated assumptions, Orphans and unresolved references, Graph changes,
Human review required, Validation and limitations) and throws if any
section's text matches one of `FORBIDDEN_PHRASES` — `"no risk"`,
`"no impact"`, `"guaranteed"`, `"definitely safe"`, `"completely resolved"`,
`"fully exhaustive"` (6 phrases, exported via `containsForbiddenPhrasing()`;
this list is local to this package and is not assumed to match any other
package's own forbidden-phrase list). `graph-plan.ts`'s
`buildKnowledgeGraphPlan()` builds the 15-scene `KnowledgeGraphPlan` consumed
by the `"knowledge-graph"` `create slides` profile — full detail in
[docs/graph-showcase.md](graph-showcase.md).

## CLI

```bash
rvs graph build
  # Reads the 6 upstream caches, builds the graph, groups root causes,
  # validates, synthesizes narrative/plan/report
  # -> .rvs/cache/knowledge-graph/*.json (12 files, KNOWLEDGE_GRAPH_OUTPUT_FILES)

rvs graph validate [--ci]
  # Re-runs the same pipeline as build, then logs every validation finding
  # --ci sets process.exitCode = 1 only if any finding is blocking

rvs graph inspect <entity-id>
  # Prints one node's fields and every adjacent edge (both directions)

rvs graph impact <entity-id> [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
  # Runs a bounded impact analysis, appends to impact-results.json,
  # recomputes and merges decision-impact.json for the same entity

rvs graph path <from-id> <to-id> [--all] [--max-depth <n>] [--edge-type <type>...] [--direction upstream|downstream|both]
  # Shortest path by default; --all finds every simple path up to the depth limit

rvs graph roots
  # Re-groups root causes from the currently cached nodes/edges

rvs graph compare --from <snapshot-dir> [--to <snapshot-dir>]
  # Diffs two graph-snapshot.json/nodes.json/edges.json directories;
  # --to defaults to a fresh `rvs graph build`

rvs graph plan-change --remove <entity-id>
  # Composes impact analysis + decision impact into a ChangePlanEntry

rvs graph explain <id>
  # Fallback-across-id-spaces lookup: node -> edge -> path -> impact-result
  # -> root-cause-group -> decision-impact -> change-plan

rvs export graph-report [--output graph-report.json]
rvs export impact-summary [--output impact-summary.md]

rvs create slides --profile knowledge-graph
  # See docs/graph-showcase.md
```

Exact log-line format (`packages/cli/src/commands/graph-build.ts`):

```
Built knowledge graph "<snapshot.id>" for repository "<repository_id>": <N>
node(s), <N> edge(s), compatibility "<status>", <N> root-cause group(s), <N>
validation finding(s).
Wrote .rvs/cache/knowledge-graph/*.json.
```

`rvs graph validate`'s log lines (`graph-validate.ts`) — per-finding
`[<code>] <message> (subject: <subject_id>)` (error or warn), then:

```
Knowledge graph validation: <N> finding(s), <N> blocking.
```

`rvs graph impact`'s log lines (`graph-impact.ts`):

```
Impact of <entity-id>: <N> direct, <N> transitive, blast radius "<level>"[ (truncated)].
  products: <N>, capabilities: <N>, decisions: <N>, governance findings: <N>,
  assumptions potentially invalidated: <N>.
```

plus, only when reached: `` Impact analysis reached an unresolved reference
— downstream impact may be incomplete. `` `rvs graph roots`'s log line, one
per group: `` [<classification>] <N> finding(s) -> <N> candidate root(s) —
<detail>. `` `rvs graph compare`'s log lines (`graph-compare.ts`):

```
Graph diff <source_snapshot_id> -> <target_snapshot_id>:
  nodes: +<N> / -<N>
  edges: +<N> / -<N>
  entity types changed: <N>, relationships changed: <N>, new orphans: <N>, new cycles: <N>
  root causes introduced: <N>, resolved: <N>, decision dependencies changed: <N>, governance reach changed: <N>
```

`rvs graph plan-change`'s log lines (`graph-plan-change.ts`):

```
Change plan for removing <entity-id>:
  <N> node(s) affected.
  <N> decision(s) requiring review, <N> governance item(s) requiring review.
  tests likely affected: <N>, docs likely affected: <N>, presentation likely affected: <N>.
  baselines requiring review: <N>, unknown consumers: <N>.
```

plus, only when non-empty: `` suggested validation commands: <comma-joined>. ``
`rvs export graph-report`'s log line: `` Wrote <path> (<N> node(s), <N>
edge(s), compatibility "<status>"). `` `rvs export impact-summary` reads only
the last-run cached `impact-results.json` entry (impact queries are
parameterized and not automatically re-run by `export`) and throws `` No
cached impact results. Run `rvs graph impact <entity-id>` first. `` if empty;
its log line is `` Wrote <path>. `` (this command only ever writes a local
Markdown file — it never posts, comments, or otherwise publishes anywhere).

## Known limitations

- **`package`, `command`, and `presentation` node types are declared but
  never populated** — see "Known, disclosed scope trims" above.
- **`diff.ts`'s comparison is caller-scoped, not all-pairs** — see
  "Compatibility and snapshots" above.
- **Several upstream enum fields are read conservatively rather than
  precisely mapped** (`GovernanceFinding.result`,
  `PortfolioDependencyEdge.kind`, `DecisionLink.link_type`) — see "Known,
  disclosed scope trims" above.
- **No model-assisted synthesis anywhere.** Every stage is deterministic,
  rule-based, offline computation over already-cached JSON. No network
  access, no LLM dependency.
- **No code modification and no decision authority.** Nothing in
  `packages/knowledge-graph` or the `rvs graph *` CLI surface writes,
  edits, approves, rejects, or invalidates a decision, a governance
  finding, or any source file — analysis and explanation only.
- Engine-specific limitations (traversal/path/impact truncation behavior,
  root-cause classification edge cases, decision-impact's fixed decision
  table, change-planning's `--remove`-only scope) are documented in each
  companion document's own "Known limitations" section.

## Package summary

| Package | Role |
|---|---|
| `@rvs/knowledge-graph` | `KnowledgeNode`/`KnowledgeEdge`/`GraphSnapshot`/`ImpactResult`/`RootCauseGroup`/`DecisionImpactEntry`/`ChangePlanEntry`/`GraphChangeSet`/`KnowledgeGraphNarrative`/`KnowledgeGraphPlan` types; construction pipeline (node/edge builders, identity, graph-builder), traversal/path-finding/impact-analysis/blast-radius, root-cause grouping, decision-impact classification, change planning, snapshot/compatibility/diff, validation, explain, narrative/plan synthesis, id builders |
| `@rvs/cli` | `rvs graph build`/`validate`/`inspect`/`impact`/`path`/`roots`/`compare`/`plan-change`/`explain`; `rvs export graph-report`/`impact-summary`; `"knowledge-graph"` added to `rvs create slides --profile <id>`'s accepted profile list; `packages/cli/src/graph-cache.ts` (`.rvs/cache/knowledge-graph/` cache layer) |
| `@rvs/narrative-planner` | `buildKnowledgeGraphVisualDoc(plan)` — see [docs/graph-showcase.md](graph-showcase.md) |
| `@rvs/renderer-html` | Scene templates for all 15 `KnowledgeGraphSceneKind` values — see [docs/graph-showcase.md](graph-showcase.md) |
| `@rvs/visualdoc-schema` | `KnowledgeGraphSceneSchema`, the 14th and last member of `SceneSchema`'s discriminated union |

`packages/knowledge-graph` (`@rvs/knowledge-graph`) imports nothing from
`@rvs/architecture-intelligence`, `@rvs/capability-intelligence`,
`@rvs/product-intelligence`, `@rvs/portfolio-intelligence`,
`@rvs/governance-intelligence`, or `@rvs/decision-intelligence` at either
the runtime or the type level — it defines its own structural echoes
(`ArchitectureArtifactEcho`, `CapabilityArtifactEcho`, and so on in
`node-builder.ts`/`edge-builder.ts`) and reads every upstream artifact as
untyped JSON, the same zero-cross-import convention
`@rvs/decision-intelligence` and `@rvs/governance-intelligence` already
established for each other.

See also: [docs/graph-impact-analysis.md](graph-impact-analysis.md),
[docs/graph-root-cause.md](graph-root-cause.md),
[docs/graph-decision-impact.md](graph-decision-impact.md),
[docs/graph-change-planning.md](graph-change-planning.md),
[docs/graph-showcase.md](graph-showcase.md),
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md),
[docs/architecture-governance.md](architecture-governance.md).
