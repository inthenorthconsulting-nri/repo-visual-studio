# Decision Linking, Dependencies, and Supersession (reference)

Use when: the task asks what a decision links to, which decisions depend
on or supersede each other, or why a declared link shows up as
`unresolved`.

**Prerequisite**: `rvs decisions analyze` has run. Link resolution against
upstream artifacts (architecture/capability/product/portfolio/governance)
is optional but stronger when those layers' cache artifacts are already
present — an unresolved link is kept and reported, never dropped, when
they aren't.

**Command**: links, dependencies, and supersession are all produced as
part of the full analysis pass — there is no standalone subcommand:

```bash
rvs decisions analyze
```

**Output**: `.rvs/cache/decisions/decision-links.json`,
`dependencies.json` (dependencies + cycles), `supersession.json` (issues +
chains).

**Key facts to get right when explaining a result to a user**:

- Links come from structured `links:` frontmatter only — never inferred
  from prose mentions of an entity's name.
- 6 declarable link-target domains exist (`architecture`, `capability`,
  `product`, `portfolio`, `governance`, `decision`), but only 5 have a
  working resolver — a link declared with `domain: decision` is silently
  absent from output today, not surfaced as `unresolved`. Point the user
  at `dependencies:`/`supersedes`/`superseded_by` for decision-to-decision
  relationships instead; those are fully wired.
- Dependencies to an unresolvable target are silently dropped (no
  `unresolved` slot), unlike every other artifact in this package — a
  deliberate, disclosed asymmetry from the link model.
- Supersession is declared via `supersedes` only; `superseded_by` is a
  reciprocal cross-check, never a second edge source. A cycle is always
  invalid — there is no "newest date wins" heuristic.

**Validation**: `rvs decisions explain <link-id | dependency-cycle-id |
supersession-issue-id | supersession-chain-id>` prints the full reasoning
for one entry.

Full technical reference: `docs/decision-linking.md` (all 16 link types,
all 6 target domains, all 5 resolution states, the 5 resolver modules'
shared pattern, the 6 dependency types and 3-way cycle classification, the
4 supersession issue kinds).
