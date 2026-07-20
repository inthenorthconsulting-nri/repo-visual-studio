# Decision Record Format (Milestone 8)

This document describes what a decision document must look like for
`rvs decisions analyze` to discover, classify, and parse it, and the
`.rvs/decisions.yml` configuration file that tells discovery where to look.
It is **documentation only** — Architecture Decision Intelligence never
writes, edits, approves, or rejects a decision document. See
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
for the full pipeline this feeds into.

## `.rvs/decisions.yml`

Optional, schema-versioned, loaded by `loadDecisionsConfig(repoRoot)`
(`packages/decision-intelligence/src/decisions-config.ts`) — mirrors
`@rvs/governance-intelligence/src/governance-config.ts`'s
`loadGovernanceConfig()` pattern exactly: returns `undefined` when the file
doesn't exist (discovery then has nothing to scan, and `rvs decisions
analyze` reports zero decisions rather than guessing at conventional
paths), and a malformed file throws a single flat-sentence Error: `` Invalid
.rvs/decisions.yml: not valid YAML (<err>). `` or `` Invalid
.rvs/decisions.yml: <details>. ``.

```yaml
schema_version: 1
sources:
  - path: docs/adr
    type: adr
    include: ["**/*.md"]
  - path: docs/rfcs
    type: rfc
  - path: docs/decisions
    type: design_decision
status_mapping:
  accepted: ["approved", "agreed"]
  rejected: ["declined", "not adopted"]
identity:
  prefer: ["frontmatter.id", "filename", "path", "content_digest"]
```

| Field | Shape | Note |
|---|---|---|
| `schema_version` | `1` (literal) | Only value currently accepted. |
| `sources` | array, min 1, required | Each entry: `path` (required, relative to repo root), `type` (required — one of `adr`\|`rfc`\|`design_decision`\|`decision_log`), `include?` (glob array, default `["**/*.md"]`). |
| `status_mapping?` | `Record<string, string[]>` | Additional raw-status-text synonyms, merged **on top of** (never replacing) the built-in defaults — see "Status mapping" below. |
| `identity.prefer?` | array of `"configured_id"`\|`"frontmatter.id"`\|`"filename"`\|`"path"`\|`"content_digest"` | Identity-resolution preference order — see "Identity resolution" below. |

Without this file, decision discovery scans nothing — there is no
conventional-path fallback (e.g. an implicit `docs/adr` scan), matching
governance's own "optional file, no guessed defaults" convention.

## The 3 recognized parsed forms

`markdown-parser.ts`'s `parseDecisionMarkdown()` (built on `unified()` +
`remarkParse` + `remarkGfm`) recognizes exactly 3 document shapes, in this
order of preference:

1. **Form 1 — Nygard-style heading sections.** Depth-2 or depth-3 headings
   named (case/prefix-insensitive via `normalizeSectionKey()`) `Status`,
   `Context`, `Decision`, `Consequences`, or any other recognized section
   name. This is the classic ADR template shape.
2. **Form 2 — a single leading key/value table.** The first Markdown table
   in the document body, read as one row of field/value pairs (only the
   first body row is used; a table with multiple data rows only contributes
   its first row).
3. **Form 3 — title + free-form lead paragraph only.** No recognized
   headings and no leading table — the document's title and its first
   paragraph (`leadParagraph`) are read, and nothing else is structurally
   extracted. This is the minimal fallback shape every discovered Markdown
   file can produce, even an unstructured decision log entry.

`normalizeSectionKey()` lowercases a heading, strips a leading `decision:`
prefix, and replaces non-alphanumeric characters with underscores before
matching — `## Decision: Status`, `## status`, and `### Status` all resolve
to the same `status` key.

Labeled list items (used by `assumptions.ts`/`consequences.ts`/
`alternatives.ts` for their own frontmatter-or-heading-list extraction) are
recovered via the shared `parseLabeledListItem(itemText, validLabels)`:
`[label] statement` or `label: statement`, matched case-insensitively
against the caller's own enum. An item matching neither shape returns
`{ label: undefined, statement: itemText.trim() }` rather than being
dropped.

## Classification basis, in order

`source-classification.ts`'s `classifyDecisionSource()` tries these, in
this fixed order, and never guesses past the last one:

1. **`configured_path`** — the `.rvs/decisions.yml` source entry's own
   `type` field, when the discovering source entry declared one.
2. **`explicit_type_field`** — a `type:` frontmatter field matching one of
   `adr`\|`rfc`\|`design_decision`\|`decision_log`.
3. **`frontmatter`** — a frontmatter shape that looks like a decision
   record (`id` + `status` both present, or an `adr` key present at all),
   with the specific type then inferred from an `id` prefix (`rfc-*` → rfc,
   `adr-*` → adr, otherwise `design_decision`).
4. **`heading_pattern`** — `# ADR-<n>` (any case/separator) → `adr`;
   `## Decision:` → `design_decision`.
5. **`filename_convention`** — a `\d{4}-*.md` filename pattern → `adr`.
6. **`none`** — no rule matched; `source_type` is `"unsupported"` and an
   `unsupported_source_type` issue is raised. A document reaching this
   branch is never silently classified as a decision anyway.

## Identity resolution, in order

`identity.ts`'s `resolveDecisionIdentity()` applies `.rvs/decisions.yml`'s
`identity.prefer` list (falling back to the built-in default order when
unset or empty): `frontmatter.id` → `filename` (a recognized `ADR-<n>` or
`RFC-<n>` pattern found in the title or the repo-relative path) → `path`
(the repo-relative path itself) → `content_digest` (the unconditional last
resort, since every discovered file has content to hash). `configured_id`
is accepted in the preference list but currently always falls through — 
`.rvs/decisions.yml` has no per-file id override field today; the value
exists so a future config extension can slot in without a breaking change
to the preference vocabulary.

## Status mapping

`status.ts`'s `mapDecisionStatus(raw, configured)` maps a document's own raw
status text to one of the 11 `DecisionStatus` values using
`DEFAULT_STATUS_MAPPING` merged with `.rvs/decisions.yml`'s
`status_mapping` (configured entries **add to**, never replace, the
built-in synonyms for a given status). Built-in defaults:

| `DecisionStatus` | Recognized raw text |
|---|---|
| `draft` | "draft" |
| `proposed` | "proposed" |
| `under_review` | "under review", "under_review", "in review", "in_review" |
| `accepted` | "accepted", "approved" |
| `rejected` | "rejected", "declined" |
| `superseded` | "superseded" |
| `deprecated` | "deprecated" |
| `withdrawn` | "withdrawn" |
| `implemented` | "implemented" |
| `partially_implemented` | "partially implemented", "partially_implemented" |
| `unknown` | (no default text — the fallback for anything unrecognized or absent) |

An unrecognized or absent raw status always maps to `"unknown"` — never
guessed from surrounding prose.

## Field precedence during normalization

`normalization.ts`'s `normalizeDecisionFields()` applies frontmatter >
heading sections > leading table > fallback precedence per field —
frontmatter is treated as the most explicit, structured signal a document
author can provide. `title` additionally falls back to the discovering
filename (with its extension stripped) when neither frontmatter nor the
parsed document supplies one.

## No `rvs decisions new` command; no automatic decision creation

This is a deliberate, disclosed scope trim, not an oversight. From the
originating design plan's own "Disclosed scope trims" section:

> No automatic ADR/decision creation, approval, rejection, or modification
> anywhere in the command surface — analysis and explanation only, matching
> spec §2's explicit "must not add" list.
>
> Decision templates (spec §50) are documentation only — a template file
> under `docs/decision-record-format.md`, never a `rvs decisions new`
> command that writes a file; the spec explicitly forbids "automatically
> create decision records during analysis."

Concretely: nothing in `packages/decision-intelligence` or the
`rvs decisions *` CLI surface writes a Markdown file, mutates
`decision_status`, or otherwise authors a decision record. An agent or user
who wants to record a new decision writes the Markdown file themselves
(using one of the 3 recognized forms above, in a directory named under
`.rvs/decisions.yml`'s `sources[]`), and `rvs decisions analyze` discovers
it on its next run.

A minimal Form 1 (Nygard-style) template, matching the built-in status
synonyms and the frontmatter fields `normalization.ts` reads:

```markdown
---
id: ADR-042
status: proposed
scope: component
authors: ["jane-doe"]
date: "2026-07-16"
links:
  - type: governs
    domain: architecture
    target: payments-gateway-component
---

# ADR-042: Use an idempotency key for payment retries

## Status

Proposed

## Context

<why this decision is being made>

## Decision

<what was decided>

## Consequences

<what follows from this decision>
```

See [docs/decision-linking.md](decision-linking.md) for the `links:`
frontmatter shape, and
[docs/architecture-decision-intelligence.md](architecture-decision-intelligence.md)
for how a discovered document becomes an `ArchitectureDecision`.
