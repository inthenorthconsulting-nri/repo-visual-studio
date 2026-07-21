# Graph Root-Cause Grouping (reference)

Use when: the task asks "why did these governance findings appear
together," "do these findings share a root cause," or wants findings
grouped by shared upstream ancestor.

**Prerequisite**: `rvs graph build` has run. Covers `root-cause.ts` only
(`rvs graph roots`'s `groupRootCauses()`).

**Command**:

```bash
rvs graph roots
```

**Output**: `.rvs/cache/knowledge-graph/root-cause-groups.json`.

**Key facts to get right when explaining a result to a user**:

- Grouping is **two-pass**: a causal-only pass first (upstream traversal
  restricted to the 6 `CAUSAL_EDGE_TYPES`), then an all-edge-types pass
  over whatever wasn't already grouped — never the reverse order.
- 4 classifications, strictly ordered in strength: `confirmed` (exactly
  one shared causal ancestor, fully resolved trace), `probable` (causal
  link exists but ambiguous or partially resolved), `shared_dependency_only`
  (shared ancestor reachable only via non-causal edges — e.g.
  `references`/`evidenced_by` — connectivity without causality),
  `unresolved` (the finding's own anchor entity never resolved at all).
- Anchors come only from a finding's own outgoing `affects` edges — never
  from a shared tag, repository, or unrelated referential edge.
- `shared_dependency_only` is a ceiling, not a downgrade path — once a
  component is only reachable via non-causal edges, nothing promotes it
  back to `probable`/`confirmed`.
- Only `governance_finding` nodes are grouped; bounded to
  `DEFAULT_MAX_TRAVERSAL_DEPTH` (12) ancestor hops, the same shared bound
  documented in `references/graph-impact-analysis.md`.

**Do not** tell a user that a `shared_dependency_only` grouping proves a
causal relationship — its own fixed `detail` string says the opposite:
"connectivity does not establish causality here."

Full technical reference: `docs/graph-root-cause.md` (the full 7-step
algorithm, the 4-row classification table with verbatim `detail` strings,
known limitations).
