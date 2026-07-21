# Graph Construction, Compatibility, and Validation (reference)

Use when: the task asks how the knowledge graph is built from the six
upstream artifacts, why a node/edge doesn't appear, why the graph is
`partial`/`incompatible`, or what a `GRAPH_*` validation code means.

**Prerequisite**: `rvs graph build` has run (or is about to). Covers
`node-builder.ts`, `edge-builder.ts`, `identity.ts`, `graph-builder.ts`,
`compatibility.ts`, `snapshot.ts`, `diff.ts`, `validation.ts`, `ids.ts`,
and `explain.ts` — everything in `@rvs/knowledge-graph` that isn't one of
the four analysis engines (those have their own reference files).

**Command**: construction runs as part of `rvs graph build` — there is no
standalone "build nodes only" subcommand:

```bash
rvs graph build
rvs graph validate [--ci]
rvs graph compare --from <snapshot-dir> [--to <snapshot-dir>]
rvs graph inspect <entity-id>
rvs graph explain <id>
```

**Output**: `.rvs/cache/knowledge-graph/nodes.json`, `edges.json`,
`graph-snapshot.json`, `graph-report.json`.

**Key facts to get right when explaining a result to a user**:

- **8-step pipeline**: resolve repository identity → build nodes → dedupe
  nodes → build edges → dedupe edges → assess compatibility → resolve
  unresolved references → deterministic ordering → snapshot.
- 19-value `KnowledgeNodeType`, 21-value `KnowledgeEdgeType`; a 6-value
  `CAUSAL_EDGE_TYPES` subset (`contains`, `depends_on`, `invokes`,
  `implements`, `produces`, `consumes`) used by root-cause grouping and
  cycle detection.
- A dangling edge endpoint is promoted to an `unresolved_reference` node,
  never silently dropped or left dangling.
- Compatibility is a 6-stage staged short-circuit assessment resolving to
  one of 4 statuses: `incompatible` (no artifact at all, identity
  disagreement, or an unsupported schema version — blocks the build),
  `partial` (some artifacts missing but at least one present and
  identity-consistent), `compatible_with_warnings` (`source_generated_at`
  disagreement), `compatible`. Only `incompatible` blocks construction.
- All ids are pure functions of stable content (`ids.ts`) — never a
  timestamp or iteration index.
- `diff.ts`'s `diffGraphs()` is caller-scoped, not all-pairs — it only
  re-checks the specific entities/paths the caller names, never attempts
  an unbounded comparison silently.
- 18 fixed validation codes (`validation.ts`), each carrying a fixed
  `blocking: true/false` — e.g. `GRAPH_NODE_DUPLICATE_ID` (blocking),
  `GRAPH_EDGE_MISSING_ENDPOINT` (blocking),
  `GRAPH_COMPATIBILITY_INCOMPATIBLE_SET` (blocking),
  `GRAPH_CYCLE_DETECTED` (non-blocking), `GRAPH_REFERENCE_BROKEN`
  (non-blocking) — full table in the technical doc.
- `explain.ts` falls back across id spaces in this fixed order: node →
  edge → path → impact-result → root-cause-group → decision-impact →
  change-plan.

**Do not** claim the graph re-scans repository source or re-synthesizes an
upstream fact — every node/edge comes from an already-cached artifact's
own already-computed fields.

Full technical reference: `docs/architecture-knowledge-graph.md` (full
pipeline detail, the 19/21-value type lists, the 18-code validation table,
exact CLI log-line formats).
