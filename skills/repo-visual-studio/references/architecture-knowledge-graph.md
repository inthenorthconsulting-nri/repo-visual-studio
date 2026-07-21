# Architecture Knowledge Graph (reference)

Use when: the task asks what would be affected by changing or removing a
component, why several governance findings appeared together, what
decisions depend on a capability, or wants a unified cross-layer view over
architecture/capability/product/portfolio/governance/decision facts that
already exist as separate cached artifacts (`MASTER_AGENT.md` §2
knowledge-graph row).

**Prerequisite**: run `rvs graph build` before any other `rvs graph *`
command. It reads whichever of the six upstream artifacts
(`architecture-intelligence.json`, `capability-model.json`,
`product-identity-model.json`, `portfolio-model.json`, the governance
report, `rvs decisions analyze`'s output) are already cached — every one is
optional; a missing artifact is treated as `unresolved`, kept and reported,
never dropped or assumed. More upstream artifacts present means a more
complete graph, but none is strictly required for `graph build` to
succeed, the same "no required upstream" exception Architecture Decision
Intelligence has.

**Command**:

```bash
rvs graph build
```

**Output**: `.rvs/cache/knowledge-graph/*.json` — 12 files
(`KNOWLEDGE_GRAPH_OUTPUT_FILES`): a `GraphSnapshot`, `nodes.json`,
`edges.json`, unresolved-reference ids, root-cause groups, a
`KnowledgeGraphNarrative`, a `KnowledgeGraphPlan`, and a summary report,
plus per-query caches for impact results, paths, decision impacts, and
change plans.

**Validation**: `rvs graph validate [--ci]` re-runs the pipeline and logs
every validation finding (18 fixed codes — see
`references/graph-construction.md`); `rvs graph explain <id>` prints one
node/edge/path/impact-result/root-cause-group/decision-impact/change-plan's
full reasoning, falling back across id spaces in that order.

**Export**: `rvs export graph-report [--output graph-report.json]` /
`rvs export impact-summary [--output impact-summary.md]` (reads only the
last-run cached impact-query result — throws if none exists yet).

**Key facts to get right when explaining a result to a user**:

- Zero cross-package `@rvs/*` runtime or type dependency — every upstream
  artifact is read as untyped JSON via a local structural echo, never an
  imported type.
- Edges come only from an upstream artifact's own already-computed
  relationship field — never inferred from a shared name or path.
- `unresolved` (no way to even ask) is never conflated with `isolated`
  (asked, found nothing) — this distinction runs through blast-radius
  classification and every other engine built on the shared traversal.
- Decision state is read from `@rvs/decision-intelligence`'s own cached
  output, never re-derived — this layer never approves, rejects, or
  invalidates a decision itself.
- `package`, `command`, and `presentation` `KnowledgeNodeType` values are
  declared but never populated by the construction pipeline.

**Do not** offer to auto-apply a change plan or treat any `rvs graph *`
command as making a code change — the whole surface is analysis and
reporting only; see `references/graph-change-planning.md`.

Full technical reference: `docs/architecture-knowledge-graph.md` (core
artifact model, full 8-step construction pipeline, ids, compatibility/
snapshot/diff, 18-code validation table, CLI, known limitations — start
here, then follow its own "See also" links to the 5 companion documents:
`docs/graph-impact-analysis.md`, `docs/graph-root-cause.md`,
`docs/graph-decision-impact.md`, `docs/graph-change-planning.md`,
`docs/graph-showcase.md`).
