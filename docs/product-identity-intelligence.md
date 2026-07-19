# Product Identity Intelligence (Milestone 5, part 1)

This document describes Product Identity Intelligence: a pipeline stage
downstream of Capability Intelligence that turns an already-accepted
`CapabilityModel` into a durable, audience-independent statement of *what the
product is* — its archetype, purpose, users, value pillars, and
differentiators — without inflating maturity, inventing adoption, or
promoting unfinished capabilities.

```
ArchitectureIntelligence + CapabilityModel   (Milestones 3 and 4)
  -> ProductIdentityModel                     (packages/product-intelligence, this milestone)
  -> product-identity.json export             (packages/product-intelligence/src/exporter.ts)
  -> input to Executive Narrative Intelligence (docs/executive-showcase-intelligence.md)
```

Scope: **synthesis over the `CapabilityModel` Milestone 4 already produces**,
plus the `ArchitectureIntelligence` artifact it was built from. No new
repository scanning, no external model call, no repository-specific
hard-coded product identity — the engine is handed exactly the same evidence
any other repository's capability model would produce and must derive its
output purely from that.

## Design mandate

> Product storytelling may compress evidence, but it must never inflate
> maturity, invent adoption, or promote unfinished capabilities.

Concretely:

- Identity synthesis never re-derives capabilities or their inclusion state
  — it only reads `CapabilityModel.includedCapabilities` /
  `.qualifiedCapabilities` / `.roadmapCapabilities` / `.gapCapabilities` /
  `.excludedCandidates` and reasons over what's already there. A capability
  Milestone 4 excluded stays excluded here; Product Identity Intelligence has
  no mechanism to promote one.
- `ProductIdentityConfidence` reuses the same `InferenceClass` vocabulary
  (`confirmed`/`derived`/`suggested`/`unresolved`) `@rvs/architecture-intelligence`
  and `@rvs/capability-intelligence` already use — no third, competing
  confidence scale.
- Archetype classification (`archetypes.ts`) requires either **two included
  capabilities** or **one included + two qualified** capabilities to match an
  archetype's signal set before that archetype can become the primary
  identity — a single matching capability, or score contributed only by an
  architecture-responsibility/component-kind boost, is never enough on its
  own. When nothing clears the bar, the primary archetype is `"unknown"` with
  confidence `"unresolved"` — a conservative refusal to guess, not a bug (see
  "Self-hosting proof" below for a real example of this firing).
  See `PRODUCT_IDENTITY_WEAK_EVIDENCE`.
- Differentiators (`differentiators.ts`) must satisfy at least one of four
  structural criteria — never a marketing adjective asserted without
  structure. See "Differentiator criteria" below.
- Every generic-marketing / absolute-superiority term list
  (`GENERIC_MARKETING_TERMS`, `ABSOLUTE_SUPERIORITY_TERMS`,
  `QUALIFIED_MATURITY_TERMS` in `contracts.ts`) is generic and reused
  verbatim by both identity synthesis and, downstream, claim control — never
  a repository-specific phrase list.
- Synthesis is a pure function over already-cached `ArchitectureIntelligence`
  + `CapabilityModel` (+ an optional `.rvs/product.yml` override) — it never
  re-scans the repository and never calls a model, so the same cached inputs
  always produce a byte-identical `ProductIdentityModel`.

## The `ProductIdentityModel` contract

Defined in `packages/product-intelligence/src/contracts.ts`. Cached to
`.rvs/cache/product-identity-model.json`.

| Field | Shape | Note |
|---|---|---|
| `identity` | `ProductIdentity` | the synthesized, audience-independent product identity (below) |
| `candidates` | `ProductIdentityCandidate[]` | every archetype that scored above zero, each with its own purpose/users/evidence — kept for auditability, not just the winner |
| `archetypeScores` | `ProductArchetypeScore[]` | the full 12-archetype score table (see "Archetype classification"), including zero-score archetypes |
| `generationMetadata` | `ProductIdentityGenerationMetadata` | `generated_at`, `git_commit`, `schema_version`, source `CapabilityModel` timestamp, `overrideApplied`/`overridePath`, `candidateCount` |

`ProductIdentity`:

| Field | Shape | Note |
|---|---|---|
| `displayName` | `string` | from `ArchitectureIntelligence.identity.name.displayLabel`, or a `.rvs/product.yml` override |
| `descriptor` | `string` | a short, generic phrase derived purely from `archetype` (`descriptorForArchetype()`) — never invented text |
| `shortPromise` | `string` | `purpose` truncated to a single promise-length sentence |
| `archetype` / `secondaryArchetypes` | `ProductArchetype` | the winning archetype plus up to 2 runners-up that also scored positively |
| `purpose` | `string` | synthesized from capability domain purposes and repository identity metadata (`purpose.ts`) |
| `primaryUsers` / `secondaryUsers` | `string[]` | derived from `CapabilityModel` actors (`users.ts`), never invented personas |
| `valuePillars` | `ProductValuePillar[]` | 3-5 durable groupings, distinct from raw capability domains (see "Value pillars") |
| `differentiators` | `ProductDifferentiator[]` | up to 6, each satisfying at least one of four structural criteria |
| `currentCapabilities` / `qualifiedCapabilities` | `string[]` | capability ids, sorted — mirrors `CapabilityModel.includedCapabilities`/`.qualifiedCapabilities` exactly |
| `limitations` | `string[]` | gap statements + pillar qualification notes, deduplicated and sorted |
| `evidence` | `ProductIdentityEvidence[]` | every evidence item this identity cites, each traceable to a real capability/domain/component/repository-metadata source |
| `confidence` | `ProductIdentityConfidence` | `"unresolved"` whenever `archetype === "unknown"` |
| `overrideApplied` | `boolean` | true only when `.rvs/product.yml` contributed a field |

`ProductArchetype` (13 values, including `unknown`): `governance_platform`,
`operations_platform`, `reliability_platform`, `developer_tool`,
`automation_platform`, `migration_platform`, `observability_platform`,
`control_plane`, `integration_platform`, `data_product`, `library`,
`framework`, `unknown`.

## Pipeline

`synthesizeProductIdentity(input)` (`packages/product-intelligence/src/index.ts`)
runs a fixed pipeline of pure functions over `{ architecture, capabilityModel,
override?, gitCommit, generatedAt }`:

| Module | Responsibility |
|---|---|
| `identity-evidence.ts` | `gatherIdentityEvidence()` — collects every `ProductIdentityEvidence` item this model may cite, from capabilities, capability domains, workflow families, logical components, and repository metadata. |
| `archetypes.ts` | `classifyArchetypes()` / `selectArchetypes()` — scores all 12 named archetypes against capability purpose/description text plus architecture responsibility-kind and component-kind boosts; selects a primary archetype only once the ≥2-included or 1-included+2-qualified bar is cleared. |
| `users.ts` | `deriveUsers()` — primary/secondary users from `CapabilityModel` actors, never invented. |
| `purpose.ts` | `synthesizeProductPurpose()` — one purpose sentence composed from capability-domain purposes and repository identity text. |
| `identity-candidates.ts` | `buildIdentityCandidates()` — one `ProductIdentityCandidate` per positively-scored archetype, plus `descriptorForArchetype()` / `shortPromiseFromPurpose()`. |
| `value-pillars.ts` | `buildValuePillars()` — merges capability domains down to 3-5 pillars, capping qualified-only pillars at 2 by folding excess into the largest included-backed pillar (see "Value pillars"). |
| `differentiators.ts` | `buildDifferentiators()` — up to 6 differentiators, each satisfying one of four structural criteria (see "Differentiator criteria"). |
| `ranking.ts` | `pickWinningCandidate()` / `rankSecondaryCandidates()` — resolves the primary/secondary archetype selection to concrete candidates. |
| `override.ts` | `loadProductIdentityOverride()` — reads and validates an optional `.rvs/product.yml` (see "Override file"). |
| `label.ts` | shared word-count/truncation/marketing-term-detection helpers, reused by claim control downstream. |
| `validation.ts` | `validateProductIdentityModel()` — pure structural checks (see "Validation"). |
| `exporter.ts` | `exportProductIdentityJson()` / `exportProductIdentityCandidatesJson()`. |

This mirrors, deliberately, how `@rvs/capability-intelligence` structures its
own synthesis pipeline — a sequence of small, pure, single-responsibility
modules composed by one entrypoint, no shared mutable state between stages.

### Archetype classification

Each of the 12 named archetypes carries a fixed, generic signal set (text
phrases scored against capability purpose/description, plus an optional
architecture-responsibility-kind or component-kind boost — e.g.
`governance_platform` boosts on a `governance`-kind responsibility;
`developer_tool` boosts on a `cli`-kind component). An included capability's
match scores 2 points; a qualified capability's match scores 1 point; a
responsibility/component boost scores 1 point but never counts toward the
included/qualified signal counts `selectArchetypes()` gates on. Results are
sorted by score descending, then archetype id ascending as a stable
tiebreak — `"unknown"` is never a scored archetype, only the fallback when
nothing qualifies.

`selectArchetypes(scores)` picks a primary archetype only when
`includedSignalCount >= 2` **or** (`includedSignalCount >= 1` **and**
`qualifiedSignalCount >= 2`) for that archetype. Up to 2 further
positive-scoring archetypes (excluding the primary) become
`secondaryArchetypes`.

### Value pillars

3-5 pillars (`VALUE_PILLAR_BAND`), built by starting from one bucket per
non-empty capability domain and deterministically merging the two smallest
buckets together while there are more than 5, then folding any qualified-only
pillar beyond the first 2 into the largest included-backed pillar. A pillar's
confidence is `confirmed` when it has included capabilities and no qualified
ones, `derived` when it mixes included and qualified, `suggested` when it is
qualified-only — never `confirmed` on qualified evidence alone.

### Differentiator criteria

A differentiator candidate must satisfy at least one of:

1. **`multi_capability_support`** — a shared logical component is used by ≥3
   included capabilities.
2. **`cross_cutting_property`** — a shared logical component spans ≥2
   distinct capability domains.
3. **`test_or_deployment_verified`** — a capability carries both `test`-type
   evidence and (`deployment`- or `workflow`-type) evidence, not
   implementation evidence alone.
4. **`operational_distinction`** — a capability's status is `operational`
   with a readiness score ≥85.

Candidates are scored (`basis.length * 10 + confidenceWeight +
supportingCapabilityIds.length`), deduplicated by id, capped at 6, and
resorted to id order for deterministic output. A description that merely
asserts superiority without one of these four structural bases is never
produced.

## Validation

Pure structural, no rendered DOM — mirrors `@rvs/capability-intelligence`'s
own `validateCapabilityModelStructure()` precedent.

`validateProductIdentityModel(identityModel, capabilityModel, override?)`
(`packages/product-intelligence/src/validation.ts`), run automatically by
`rvs synthesize product-identity` before caching. The `override` parameter is
optional and only enables `PRODUCT_IDENTITY_OVERRIDE_CONFLICT` below; a
repository with no `.rvs/product.yml` still runs every other check.

| Code | Severity | Meaning |
|---|---|---|
| `PRODUCT_IDENTITY_MISSING` | warning | identity or one of `displayName`/`descriptor`/`purpose` is blank |
| `PRODUCT_IDENTITY_WEAK_EVIDENCE` | warning | no archetype cleared the evidence bar; identity conservatively left as `unknown` |
| `PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES` | warning | the top two archetype scores tie with no overlapping matched-capability evidence |
| `PRODUCT_IDENTITY_GENERIC_MARKETING` | error | identity text contains a `GENERIC_MARKETING_TERMS` or `ABSOLUTE_SUPERIORITY_TERMS` phrase |
| `PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM` | error | a `QUALIFIED_MATURITY_TERMS` phrase (e.g. "production-grade") appears without deployment/release/usage evidence |
| `PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM` | error | an `ENTERPRISE_SCALE_TERMS` phrase (e.g. "enterprise-grade", "mission-critical") appears without deployment/release/usage evidence |
| `SHOWCASE_ROADMAP_PROMOTED` | error | a roadmap-only capability id appears in `identity.currentCapabilities` |
| `SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED` | error | an excluded candidate id appears in `identity.currentCapabilities` |
| `SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED` | error | a capability the `CapabilityModel` only qualifies appears in `identity.currentCapabilities` (the "fully included" list) without carrying its qualification forward |
| `SHOWCASE_UNSUPPORTED_DIFFERENTIATOR` | warning | a differentiator has zero `evidenceIds` |
| `PRODUCT_IDENTITY_OVERRIDE_CONFLICT` | error | a `.rvs/product.yml` `disallowed_terms` entry appears in evidence-derived value pillar / differentiator / limitation text |
| `SHOWCASE_NONDETERMINISTIC_ORDER` | error | `model.candidates` is not sorted by id |
| `PRODUCT_IDENTITY_UNSUPPORTED_DESCRIPTOR` | *(unimplemented — see [Known limitations](#known-limitations))* | — |

Any `"error"`-severity code above fails `rvs validate --ci` unconditionally,
the same way a `CAP_INTEL_*` structural error does; a repository that has
never run `rvs synthesize product-identity` sees no change in behavior — the
check is skipped entirely. `SHOWCASE_ROADMAP_PROMOTED` /
`SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED` / `SHOWCASE_NONDETERMINISTIC_ORDER`
are shared with `validateShowcasePlan()` (see
[docs/executive-showcase-intelligence.md](./executive-showcase-intelligence.md#showcase-plan-validation))
— the same code can fire from either the identity model or the showcase plan
depending on which artifact carries the defect.

## Override file (`.rvs/product.yml`)

Optional, schema-versioned, loaded by `loadProductIdentityOverride()`
(`override.ts`). Every field is a targeted override of one already-synthesized
field, never a way to inject unsupported claims wholesale:

```yaml
schema_version: 1
display_name: "..."          # overrides identity.displayName
descriptor_override: "..."   # overrides identity.descriptor
purpose_override: "..."      # overrides identity.purpose (and re-derives shortPromise)
primary_users: ["..."]       # overrides identity.primaryUsers
approved_terms: ["..."]      # human-cleared terms that lift a marketing/absolute-superiority error, scoped narrowly to display_name/descriptor_override/purpose_override only (see Known limitations)
disallowed_terms: ["..."]    # terms to additionally block, beyond the built-in lists
runtime_claims: ["..."]      # scale/adoption statements a human has verified out-of-band; routed to ClaimStatus "runtime_verification_required", never "approved" (see docs/executive-showcase-intelligence.md)
```

`identity.overrideApplied` and `generationMetadata.overrideApplied` /
`.overridePath` record when this file contributed to the output, so a
generated showcase never silently mixes overridden and synthesized claims
without a traceable marker.

## CLI

```bash
rvs synthesize product-identity
  # reads .rvs/cache/{architecture-intelligence,capability-model,repository-model}.json (all required)
  # + .rvs/product.yml (optional)
  # -> .rvs/cache/product-identity-model.json, .rvs/cache/product-identity-candidates.json (diagnostic dump)

rvs export product-identity --output product-identity.json
  # exports the cached ProductIdentityModel as-is
```

`rvs validate --ci` also runs `validateProductIdentityModel()` against
`.rvs/cache/product-identity-model.json` when present
(`validateCachedProductIdentity()` in `packages/cli/src/commands/validate.ts`),
writing `artifacts/visuals/product-identity-validation-report.json`.

## Self-hosting proof

Run against `repo-visual-studio` itself, continuing the same pipeline
Milestone 4's self-hosting proof left off (`docs/capability-intelligence.md`):
`rvs synthesize product-identity` → `rvs export product-identity` → `rvs
validate --ci`.

**Result: archetype `unknown`, confidence `unresolved`, 3 candidates
(`automation_platform` score 2, `developer_tool` score 2,
`operations_platform` score 1), 2 value pillars, 0 differentiators, 0
structural errors, 2 warnings (`PRODUCT_IDENTITY_WEAK_EVIDENCE` and
`PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES` — the tie between
`automation_platform` and `developer_tool` described just below).**

This is the conservative-bias rule working exactly as designed, not a defect.
RVS's own self-scan (per `docs/capability-intelligence.md`) currently has 0
`includedCapabilities` and only 2 `qualifiedCapabilities` (`@rvs/cli` itself
and the CI workflow's "Other Automation" family) — nowhere near the
≥2-included or 1-included+2-qualified bar `selectArchetypes()` requires
before it will commit to a primary archetype. `automation_platform` and
`developer_tool` each matched exactly one qualified capability (score 2, one
qualified signal), and `operations_platform` scored only from an
architecture-responsibility boost (score 1, zero capability signals) —
correctly insufficient under the rule. Rather than picking whichever
candidate happens to score highest, the engine reports `unknown` and files
`PRODUCT_IDENTITY_WEAK_EVIDENCE`, which is the intended, evidence-honest
outcome when the underlying `CapabilityModel` itself is this thin. As RVS's
own capability inclusion rate improves (tracked in
`docs/capability-intelligence.md`), this classification will strengthen
automatically on the next `rvs synthesize product-identity` run — no change
to this package is required.

### Observed data-quality artifact (documented, not fixed)

The two synthesized value pillars are titled "General automation" and
"General Automation" — near-duplicates differing only by capitalization.
This is not a bug in `value-pillars.ts`, which buckets one pillar per
non-empty `CapabilityDomain` and only merges buckets once there are more than
5: with exactly 2 non-empty domains here, no merge is triggered. The root
cause is one level upstream, in how `@rvs/capability-intelligence`'s domain
grouping (`grouping.ts`) named two separately-derived domains — one from a
component-derived label, one from a workflow-family-derived label — that
happen to normalize to the same words with different casing. It is left
undocumented-but-fixed here deliberately: fixing domain-title
case-normalization is a `@rvs/capability-intelligence` concern outside this
milestone's package boundary, and the artifact does not violate the design
mandate (it does not inflate maturity or invent a capability — it is purely a
duplicate-looking label caused by weak domain diversity in a small
self-hosting scan). Tracked here for whoever next touches
`capability-intelligence/src/grouping.ts`.

## Known limitations

- Archetype classification's text-signal sets are necessarily generic; a
  repository whose domain vocabulary doesn't overlap with any of the 12
  archetypes' signal phrases will correctly resolve to `unknown` rather than
  guess — this is by design, not a gap to "fix" by adding
  repository-specific keywords.
- Differentiator detection only looks at `includedCapabilities`; a repository
  with strong qualified-only evidence will report 0 differentiators even if
  the underlying capabilities are structurally distinctive, mirroring the
  same conservative bias applied everywhere else in this pipeline.
- `PRODUCT_IDENTITY_UNSUPPORTED_DESCRIPTOR` is declared in
  `ProductIntelWarningCode` but not emitted by `validateProductIdentityModel()`.
  `descriptorForArchetype()` (`identity-candidates.ts`) always produces the
  descriptor from a fixed, generic phrase table keyed by `ProductArchetype` —
  there is no code path where a synthesized descriptor can diverge from that
  table, so the check this code implies (descriptor text doesn't trace back
  to the generic vocabulary) has no reachable failure case under the current
  synthesis design. Left declared rather than removed, in case a future
  `.rvs/product.yml` `descriptor_override` validation path needs it.
- `.rvs/product.yml`'s `approved_terms` field is implemented with a
  deliberately narrow scope, not a blanket marketing-language bypass.
  `validateProductIdentityOverride()` (`override.ts`) consumes it when
  validating the override file itself — a marketing/absolute-superiority
  match in `display_name`/`descriptor_override`/`purpose_override` is lifted
  only when the exact matched term (case-insensitive) is present in
  `approved_terms`; an unrelated approved term never suppresses an
  unapproved one in the same field. `claims.ts`'s `classifyDraft()` consumes
  the same set at claim-classification time, but only for the `"identity"`/
  `"purpose"` claim types — the only claim text built directly from the
  override's own `displayName`/`descriptor`/`purpose` fields. Every other
  claim type (`outcome`/`capability`/`differentiator`/`maturity`) is
  strictly evidence-derived and stays fully subject to the
  `SHOWCASE_CLAIM_GENERIC_MARKETING`/`SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE`
  checks regardless of `approved_terms` — a human clearing one marketing
  phrase for the product's own name/descriptor cannot use the same override
  to launder language into evidence-derived showcase content.
  `disallowed_terms` (see `PRODUCT_IDENTITY_OVERRIDE_CONFLICT` above) and
  `runtime_claims` (see
  [docs/executive-showcase-intelligence.md](./executive-showcase-intelligence.md))
  remain fully wired as before.

## Package summary

`packages/product-intelligence` — `@rvs/product-intelligence`. Depends on
`@rvs/architecture-intelligence` and `@rvs/capability-intelligence` for
input types only; no dependency in the other direction. No external model
call anywhere in the package.
