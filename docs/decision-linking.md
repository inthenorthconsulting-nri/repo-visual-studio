# Decision Linking, Dependencies, and Supersession (Milestone 8)

This document describes how Architecture Decision Intelligence connects a
decision to the four upstream intelligence artifacts and to governance
policy, how decisions declare dependencies on each other, and how
supersession is tracked. It is part of
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)'s
broader pipeline; this document covers only `links.ts` + its 5 per-domain
resolver modules, `dependencies.ts`, `decision-graph.ts`, and
`supersession.ts`.

```
decision frontmatter `links:` array (structured only, never prose-inferred)
  -> extractDeclaredLinks() (links.ts)
  -> per-domain resolver (architecture/capability/product/portfolio/governance-links.ts)
  -> DecisionLink[] (always kept, unresolved never dropped)

decision frontmatter `dependencies:` array
  -> extractDeclaredDependencies() (dependencies.ts)
  -> buildDecisionDependencies() -> DecisionDependency[] + DecisionDependencyCycle[]

decision `supersedes` / `superseded_by` fields
  -> buildDecisionSupersession() (supersession.ts)
  -> DecisionSupersessionIssue[] + DecisionSupersessionChain[]
```

## Design mandate

> A decision may only be said to touch an entity when a document explicitly
> declares that link in structured syntax — never because the entity's name
> happens to appear somewhere in the decision's prose.

Concretely, from `links.ts`'s own header comment:

> Links are extracted from structured syntax only — a decision's
> frontmatter `links:` array of `{ type, domain, target }` entries — never
> inferred from prose mentions in `context`/`decision_text`. A textual
> mention of an entity's name is never sufficient to create a link.

- **Unresolved is always kept.** Per `contracts.ts`'s own doc comment on
  `DecisionLink`: "Unresolved links are always kept in the output — never
  dropped, per the conservative-bias convention every layer below
  Governance already follows."
- **No fuzzy or name-similarity resolution.** `resolveAgainstEntityIds()`
  (the base resolution rule shared by all 4 upstream-artifact link modules)
  is exact membership only: no known-entity-id set to check against (the
  upstream artifact is absent/incompatible) → `unresolved`; an exact match
  → `resolved`; no match → `unresolved`. Never fuzzy, never
  name-similarity based.
- **Supersession is declared, not inferred.** `supersession.ts`'s header:
  supersession is declared purely via the `supersedes` field;
  `superseded_by` is treated only as a reciprocal cross-check, never
  double-counted as a second edge source. There is no "newest date wins"
  heuristic — a cycle is always invalid.
- **Rotation-invariant cycle detection, shared code.** Both
  `dependencies.ts` and `supersession.ts` detect cycles via
  `decision-graph.ts`'s shared `findCycles()` — a bounded simple-path DFS,
  deduplicated by a rotation-invariant key, so `A -> B -> C -> A` and
  `B -> C -> A -> B` are recognized as the same cycle.

## Links: 16 types, 6 declarable domains, 5 resolution states

`DecisionLinkType` (`contracts.ts`) — 16 values:

`governs`, `introduces`, `removes`, `replaces`, `constrains`, `permits`,
`deprecates`, `requires`, `explains`, `justifies`, `depends_on`,
`implements`, `validates`, `excepts`, `affects`, `references`.

`DecisionLinkTargetDomain` — 6 declarable values: `architecture`,
`capability`, `product`, `portfolio`, `governance`, `decision`. All 6 have a
dedicated resolver module wired into the CLI pipeline —
`architecture-links.ts`, `capability-links.ts`, `product-links.ts`,
`portfolio-links.ts`, `governance-links.ts`, and (added in Milestone 8.1)
`decision-links.ts`, which resolves `target_domain: "decision"` against the
set of decision ids known within the same analysis run.

`DecisionLinkResolution` — 5 values: `resolved`, `partially_resolved`,
`unresolved`, `ambiguous`, `incompatible`.

`DecisionLink` (`contracts.ts`):

| Field | Shape | Note |
|---|---|---|
| `id` | string | `decision:link:<decisionId>:<linkType>:<targetKeyOrId>`. |
| `decision_id` | string | The declaring decision. |
| `link_type` | `DecisionLinkType` | |
| `target_domain` | `DecisionLinkTargetDomain` | |
| `target_id?` | string | Present only when `resolution` carries a `targetId` (resolved/partially_resolved/incompatible). |
| `resolution` | `DecisionLinkResolution` | |
| `detail` | string | Human-readable explanation, including *why* an unresolved/incompatible link couldn't be confirmed. |
| `evidence_refs` | `EvidenceRef[]` | |

### The 5 resolver modules

Each of `architecture-links.ts`/`capability-links.ts`/`product-links.ts`/
`portfolio-links.ts` follows the identical pattern: filter the decision's
own `extractDeclaredLinks()` output to that one `target_domain`, collect
known entity ids from the corresponding upstream snapshot via
`collectKnownEntityIds()` (a bounded-depth structural walk of the upstream
JSON that recursively finds every string `id` field — this package never
imports the upstream types, so it cannot address a named array like
`components`/`capabilities`; walking structurally is the only option that
stays correct across all four upstream shapes without importing them), and
resolve each declared link against that id set via
`resolveAgainstEntityIds()`. When the corresponding upstream snapshot is
`undefined` (that milestone's synthesize step hasn't run), every declared
link in that domain resolves `unresolved` — never assumed resolved.

`governance-links.ts` works differently: rather than resolving a decision's
own declared link, it reads a loaded governance policy file's
`exceptions[]` array and looks for each exception's own `decision_ref`
field, producing an `excepts`/`governance` link from the *referenced*
decision back to that exception. A `decision_ref` naming a decision that
doesn't exist produces an `unresolved` link. A `decision_ref` that resolves
but whose decision status can't back an exception (only
`accepted`/`implemented`/`partially_implemented` can), or is expired, or
whose scope regex doesn't match, produces an `incompatible` link with a
detail string naming every reason that applied. Otherwise: `resolved`. See
[docs/decision-governance.md](decision-governance.md) for the `decision_ref`
field itself.

## Dependencies: 6 types, 3-way cycle classification

`DecisionDependencyType` (`dependencies.ts`) — 6 values: `depends_on`,
`blocks`, `requires`, `is_required_by`, `related_to`, `conflicts_with`.
`related_to` is the sole `INFORMATIONAL_KINDS` member; the other four
non-`conflicts_with` blocking-capable kinds (`depends_on`, `blocks`,
`requires`, `is_required_by`) make up `BLOCKING_KINDS`.

Unlike `DecisionLink`, a declared dependency whose target doesn't resolve
to a known decision id is **silently dropped** — there is no "unresolved"
slot on `DecisionDependency`, a deliberate asymmetry from the link model
stated directly in `dependencies.ts`'s header comment.

`extractDeclaredDependencies()` reads a decision's frontmatter
`dependencies:` array of `{ type, target }` entries, or equivalently a
per-type-keyed array shape. `buildDecisionDependencies()` builds a
`DecisionGraph` from the resolved dependency edges and finds cycles
**separately** for informational vs. blocking kinds via
`buildCyclesForClassification()`, producing:

`DecisionCycleClassification` — 3 values: `informational_allowed` (a cycle
made entirely of `related_to` edges — allowed, surfaced for visibility
only), `blocking_flagged` (a cycle containing at least one blocking-kind
edge — always flagged), `supersession_invalid` (reserved for
`supersession.ts`'s own `supersession_cycle` detector — `dependencies.ts`
itself never produces this value).

## Supersession: reciprocal-consistency model

`supersession.ts`'s `buildDecisionSupersession()` detects, via
`DecisionSupersessionIssueKind` (4 values):

| Kind | Meaning |
|---|---|
| `missing_target` | A `supersedes`/`superseded_by` reference names a decision id that doesn't exist. |
| `reciprocal_inconsistency` | A supersedes B, but B's own `superseded_by` doesn't name A (or vice versa). |
| `multiple_active_superseders` | A decision is superseded by more than one currently-non-superseded decision. |
| `supersession_cycle` | A cycle over `supersedes` edges, via the shared `findCycles()` (`decision-graph.ts`). |

`DecisionSupersessionChain[]` is built by `buildChains()`/`collectPaths()`
from graph "heads" — nodes with no incoming `supersedes` edge but at least
one outgoing edge. `is_valid` is `false` if any node along the chain's path
was flagged by one of the 4 issue kinds above.

## CLI

Links, dependencies, and supersession are all produced as part of the full
`rvs decisions analyze` pipeline — there is no standalone
"links only"/"dependencies only" command:

```bash
rvs decisions analyze
  # -> .rvs/cache/decisions/decision-links.json
  # -> .rvs/cache/decisions/dependencies.json  (dependencies + cycles)
  # -> .rvs/cache/decisions/supersession.json  (issues + chains)

rvs decisions explain <link-id | dependency-cycle-id | supersession-issue-id | supersession-chain-id>
```

`rvs decisions analyze`'s exact log-line format is documented in
[docs/architecture-decision-intelligence.md#cli](architecture-decision-intelligence.md#cli).

## Known limitations

- **Dependencies to an unresolvable target are dropped, not marked
  unresolved.** Unlike every other artifact in this package, a declared
  dependency naming a decision id that doesn't exist produces no output at
  all — no `DecisionDependency`, no issue. This is stated directly in
  `dependencies.ts`'s own header comment as an intentional asymmetry from
  the link model, not an oversight.
- **`collectKnownEntityIds()` is a bounded structural walk, not a typed
  read.** It stops at a fixed recursion depth (6) and matches on any
  string-valued `id` field anywhere in the upstream JSON — this can, in
  principle, match an id belonging to an unrelated nested structure that
  happens to share a value with a real entity id, since this package
  intentionally never imports the upstream types to know which arrays are
  the "real" entity lists.
- **No remote/cross-repository decision resolution.** An unresolved
  cross-repo dependency or link target stays `unresolved`, never fetched.

## Package summary

| Package | Role |
|---|---|
| `@rvs/decision-intelligence` | `DecisionLink`/`DecisionDependency`/`DecisionDependencyCycle`/`DecisionSupersessionIssue`/`DecisionSupersessionChain` types; `links.ts` + the 5 per-domain resolvers, `dependencies.ts`, `decision-graph.ts`, `supersession.ts` |
| `@rvs/cli` | `rvs decisions analyze` (produces `decision-links.json`/`dependencies.json`/`supersession.json`); `rvs decisions explain <id>` |

See [docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
for the package-level type-decoupling statement (unchanged here — this
document covers three source modules of that same package).

`decision-links.json` and `dependencies.json` are also consumed by the
Knowledge Graph layer, see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md).

See also: [docs/decision-record-format.md](decision-record-format.md),
[docs/decision-drift.md](decision-drift.md),
[docs/decision-governance.md](decision-governance.md),
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md).
