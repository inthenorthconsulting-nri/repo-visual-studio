# Decision Discovery and Record Format (reference)

Use when: the task needs to know what makes a document discoverable as a
decision record, which of the 3 recognized Markdown shapes to write, or
why a document didn't get picked up by `rvs decisions analyze`.

**Prerequisite**: none — this is the entry point of the decision pipeline.
A `.rvs/decisions.yml` file must exist and name at least one `sources`
entry (`path`, `type`, optional `include` glob); without it, discovery
scans nothing (no conventional-path fallback, matching Governance's own
"optional file, no guessed defaults" convention).

**Command**:

```bash
rvs decisions analyze
```

**Output**: `.rvs/cache/decisions/decision-snapshot.json` (plus the
per-artifact files listed in `docs/architecture-decision-intelligence.md`).
Discovery + classification + parsing + normalization + identity resolution
+ status mapping happen as the first stage of this single command — there
is no standalone "discover only" subcommand.

**The 3 recognized document shapes** (in order of preference): Nygard-style
heading sections (`## Status` / `## Context` / `## Decision` /
`## Consequences`), a single leading key/value Markdown table, or a plain
title + lead paragraph (the universal fallback every discovered Markdown
file can produce). See `docs/decision-record-format.md` for the exact
heading-normalization rules and a full example template.

**No `rvs decisions new` command.** This is a deliberate, disclosed scope
trim — analysis and explanation only, never automatic decision creation,
approval, rejection, or modification. If the user wants to record a new
decision, write the Markdown file yourself (or ask them to) using the
template in `docs/decision-record-format.md`, in a directory named under
`.rvs/decisions.yml`'s `sources[]`; the next `rvs decisions analyze` run
discovers it.

**Validation**: `rvs decisions validate [--ci]` surfaces source-level
issues (unparseable structure, unsupported source type, duplicate
identity) alongside every other validation finding.

Full technical reference: `docs/decision-record-format.md` (`.rvs/decisions.yml`
schema, all 3 parsed forms, classification precedence, identity resolution
order, the full built-in status-mapping table, field precedence during
normalization).
