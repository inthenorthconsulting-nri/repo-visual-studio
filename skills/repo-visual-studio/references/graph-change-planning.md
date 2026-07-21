# Graph Change Planning (reference)

Use when: the task asks "what needs review if I remove this
component/capability/decision," or wants a single report combining impact
analysis, decision impact, likely-affected tests/docs/presentation, and
suggested validation commands for a removal.

**Prerequisite**: `rvs graph build` has run. Covers `change-planning.ts`
only. **`--remove` is the only supported verb this milestone** — no
`--add`/`--modify`/`--rename`.

**Command**:

```bash
rvs graph plan-change --remove <entity-id>
```

**Output**: `.rvs/cache/knowledge-graph/change-plans.json` (appended).

**Key facts to get right when explaining a result to a user**:

- Composes `impact-analysis.ts` (fixed to `direction: "downstream"`) and
  `decision-impact.ts` directly — it never duplicates their traversal
  logic, and never touches disk, git, or another CLI command; the CLI
  wrapper (`graph-plan-change.ts`) is solely responsible for logging and
  cache writes.
- Evidence-path classification (tests/docs/presentation) is a **regex
  pattern match** over `evidenced_by` edges' evidence paths, not a
  build-graph or test-runner analysis — a test file that doesn't match a
  `test`/`spec` naming convention, or documentation outside `docs/`, is
  never classified even if it genuinely references the removed entity.
- Suggested validation commands come from a fixed, static
  `VALIDATION_COMMANDS_BY_NODE_TYPE` table keyed by the *set of distinct
  node types* among the removed entity and everything affected — never
  from dynamic package/test discovery. `package`, `command`,
  `presentation`, `baseline`, `evidence`, and `unresolved_reference` node
  types have no table entry.
- `unknown_consumers` names affected nodes whose `node_type ===
  "unresolved_reference"` — "something references this entity but the
  graph couldn't resolve what."
- **This module never executes any suggested command** — the list is
  advisory output for a human or a follow-on tool to run.

**Do not** offer to run any suggested validation command automatically, or
imply `plan-change` itself removes, edits, or refactors anything — it is
report generation only. If the user wants to actually make the change,
that's a separate implementation task that comes after reading the plan.

Full technical reference: `docs/graph-change-planning.md` (full
`ChangePlanEntry` field table, the exact `classifyEvidencePath()` regex
patterns, the full validation-command table, known limitations).
