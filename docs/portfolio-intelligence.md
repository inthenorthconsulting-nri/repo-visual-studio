# Portfolio and Ecosystem Intelligence (Milestone 6, part 1)

This document describes Portfolio and Ecosystem Intelligence: a synthesis
stage above the per-product Milestone 3-5 pipeline that combines multiple
already-generated `ProductIdentityModel` + `CapabilityModel` artifacts —
one per product, each product a separate repository with its own artifact
root — into a single evidence-backed `PortfolioModel`: normalized
cross-product capabilities, product relationships, a dependency graph,
overlaps, gaps, an inferred operating model, a maturity summary, and a
claim-controlled set of portfolio-level statements. It never re-scans a
product repository and never calls an external model — it reasons purely
over artifacts Milestones 3-5 already produced.

```
ProductIdentityModel + CapabilityModel        (per product, Milestones 4-5)
  (+ optional ArchitectureIntelligence / RepositoryModel / ShowcasePlan / showcase claims)
  -> .rvs/portfolio.yml                        (product-registry.ts — which products, which artifact roots)
  -> PortfolioModel                             (packages/portfolio-intelligence, this milestone)
  -> portfolio-model.json / portfolio-claims.json / portfolio-decisions.json exports
  -> input to Portfolio Showcase Intelligence   (docs/portfolio-showcase.md)
```

Scope: **synthesis over already-generated per-product artifacts named by
`.rvs/portfolio.yml`.** No new repository scanning, no external model call,
no repository-specific hard-coded product list, relationship, or capability
name — the engine is handed exactly the artifacts each product's own
Milestone 3-5 pipeline already produced and must derive its output purely
from that.

## Design mandate

> Portfolio synthesis may raise the level of abstraction across products,
> but it must never invent a relationship, inflate a capability's maturity,
> or fabricate ownership that the underlying evidence does not support.

Concretely:

- A product's own identity/capability facts are never re-derived or
  second-guessed here — `identity-reconciliation.ts` only reads what
  `ProductIdentityModel`/`CapabilityModel` already established (archetype,
  included/qualified capabilities). A capability a product's own Milestone 4
  pipeline excluded never becomes a portfolio capability.
- `PortfolioRelationshipConfidence` and `PortfolioClaimStatus` reuse the same
  vocabulary shape prior milestones already use
  (`confirmed`/`derived`/`suggested`/`unresolved`;
  `approved`/`approved_with_qualification`/`rejected`/`runtime_verification_required`)
  — no third, competing confidence or claim-status scale.
- Capability normalization (`capability-normalization.ts`) requires
  structural agreement, not lexical overlap alone: two capabilities from
  different products must share vocabulary **and** at least one of
  domain/actor/workflow/externalSystem overlap before they are treated as
  the same capability (see "Capability normalization" below).
- Relationships, overlaps, gaps, and decisions all stay `unresolved` /
  un-emitted rather than guessed when the evidence doesn't clear a
  structural bar — an `unresolved` relationship is a correct, honest output,
  not a defect (see "Self-hosting proof" below for a real example: adding a
  4th product did not fabricate a new relationship).
- A product is only combined into the portfolio when its artifacts pass a
  4-step compatibility gate (see "Intake and compatibility gate" below);
  incompatible products are excluded and recorded, never silently merged.
- Synthesis is a pure function over already-cached per-product artifacts
  (`synthesizePortfolio(input)`) — it never re-scans any product repository
  and never calls a model, so the same cached inputs always produce a
  byte-identical `PortfolioModel`.

## `.rvs/portfolio.yml`

Optional, schema-versioned, loaded by `loadPortfolioConfig(repoRoot)`
(`packages/portfolio-intelligence/src/product-registry.ts`) — returns
`undefined` when the file doesn't exist, the same optionality pattern
`.rvs/product.yml` uses. Unlike `.rvs/product.yml`, portfolio synthesis has
no single-repository fallback: `rvs synthesize portfolio` requires this file
to exist and throws if it doesn't.

```yaml
schema_version: 1
portfolio:
  id: my-portfolio
  display_name: "My Portfolio"
products:
  - id: governance-cli
    artifact_root: ../governance-cli
  - id: reliability-cli
    artifact_root: ../reliability-cli
  - id: migration-cli
    artifact_root: ../migration-cli
audiences: ["portfolio"]              # optional
approved_relationships:                # optional
  - product_a: governance-cli
    product_b: reliability-cli
    relationship: shared_platform
    note: "..."
disallowed_claims: ["..."]             # optional
runtime_claims: ["..."]                # optional
```

Only identifies products and where to find their artifacts — it never
defines capabilities, relationships, or maturity by hand (those are always
synthesized). `PortfolioConfigProduct` fields: `id`, `artifact_root`,
optional `alias_of` (declares this product id as an alias of another
already-declared product id, rather than a second, separate artifact root).
`approved_relationships` entries always win over anything
`product-relationships.ts` would otherwise infer, and are the **only**
source for `upstream_dependency` / `downstream_dependency` / `shared_platform`
/ `shared_contract` relationship types — those four types are never inferred
automatically from capability evidence alone (see "Product relationships"
below).

`validatePortfolioConfig(config, repoRoot)` checks what the Zod shape alone
cannot express: duplicate product ids, every `artifact_root` directory must
exist, and no two products may point at the same `artifact_root` without an
explicit `alias_of`. Product/config ordering is deliberately not validated —
every downstream module sorts its own output, so input order never affects
output order.

## Intake and compatibility gate

`intakePortfolioProducts()` (`intake.ts`) reads, per configured product, two
**required** artifacts from `artifact_root`: `product-identity.json`,
`capability-model.json`; plus four **optional** artifacts:
`architecture-intelligence.json`, `repository-model.json`,
`showcase-plan.json`, `showcase-claims.json`. A missing optional artifact
records a `PortfolioProductInputIssueCode: "optional-input-unavailable"`
issue and downgrades an otherwise-`compatible` result to
`compatible_with_warnings` — it never blocks intake.

`assessCompatibility()` (`compatibility.ts`) is a 4-step gate, evaluated in
order, the first failure deciding the result:

1. **Required artifact presence.** Either required artifact missing ->
   `missing_required_artifact`.
2. **Schema version match.** The product-identity/capability-model artifacts'
   own `PRODUCT_INTELLIGENCE_SCHEMA_VERSION`/`CAPABILITY_INTELLIGENCE_SCHEMA_VERSION`
   must match what this build of `@rvs/portfolio-intelligence` expects ->
   `unsupported_schema`.
3. **Capability-id intersection.** The identity's `currentCapabilities` /
   `qualifiedCapabilities` ids must intersect with the capability model's
   `includedCapabilities` / `qualifiedCapabilities` ids -> `identity_mismatch`.
4. **Staleness.** `identity.generationMetadata.source_capability_model_generated_at`
   must equal `capabilityModel.generationMetadata.generated_at` ->
   `stale_artifact_set`.

`PortfolioCompatibilityStatus` (7 values): `compatible`,
`compatible_with_warnings`, `incompatible`, `missing_required_artifact`,
`unsupported_schema`, `identity_mismatch`, `stale_artifact_set`.
`isCompatible(intake)` treats only `compatible` and
`compatible_with_warnings` as usable (`PORTFOLIO_COMPATIBLE_STATUSES`).

`synthesizePortfolio()` throws if **zero** products are compatible. If one
or more products are incompatible and `allowPartialPortfolio` is **not**
set, it throws naming each incompatible product and its status. With
`--allow-partial`, incompatible products are excluded and recorded on
`PortfolioModel.excludedProducts` (each a full `PortfolioProductIntake`,
including its issues) rather than silently dropped.

## The `PortfolioModel` contract

Defined in `packages/portfolio-intelligence/src/contracts.ts`. Cached to
`.rvs/cache/portfolio-model.json`.

| Field | Shape | Note |
|---|---|---|
| `schemaVersion` | `number` | `PORTFOLIO_INTELLIGENCE_SCHEMA_VERSION` (currently 1) |
| `portfolioId` / `displayName` | `string` | from `.rvs/portfolio.yml`'s `portfolio.id` / `portfolio.display_name` |
| `products` | `PortfolioProduct[]` | one per compatible, reconciled product (see "Products and roles") |
| `domains` | `PortfolioDomain[]` | capabilities grouped by their (already-normalized) domain label |
| `capabilities` | `PortfolioCapability[]` | normalized cross-product capabilities (see "Capability normalization") |
| `relationships` | `PortfolioProductRelationship[]` | resolved (non-`unresolved`-type) product-to-product relationships |
| `unresolvedRelationships` | `PortfolioProductRelationship[]` | pairs where evidence exists but doesn't clear the classification bar — never rendered as a confirmed conclusion |
| `dependencyGraph` | `PortfolioDependencyGraph` | `{ nodes, edges }` — products, shared platforms/contracts, external systems |
| `overlaps` | `PortfolioOverlap[]` | shared capabilities whose ownership is **not** resolved (see "Overlaps") |
| `gaps` | `PortfolioGap[]` | structural absences the pipeline can compute today (4 of 8 declared types — see "Gaps") |
| `operatingModel` | `PortfolioOperatingModel` | inferred `plan`-through-`improve` stage assignments, always `inferred: true` |
| `maturity` | `PortfolioMaturitySummary` | 7 scored dimensions (see "Maturity") |
| `evidence` | `PortfolioEvidence[]` | every evidence item any field above cites, sorted by id |
| `evidenceSummary` | `PortfolioEvidenceSummary` | disaggregated portfolio-wide counts |
| `excludedProducts` | `PortfolioProductIntake[]` | incompatible products kept for auditability (only non-empty under `--allow-partial`) |
| `generationMetadata` | `PortfolioGenerationMetadata` | `generated_at`, `schema_version`, `productCount`, `incompatibleProductCount`, `allowPartialPortfolio` |

### Products and roles

`PortfolioProduct`: `id`, `displayName`, `descriptor`, `primaryArchetype` /
`secondaryArchetypes` (the product's own `ProductArchetype`, unchanged),
`primaryRole` / `secondaryRoles` (`PortfolioProductRole`, below),
`currentCapabilityIds` / `qualifiedCapabilityIds` (+ counts), and `source`
(`PortfolioSourceMetadata`: `configId`, `artifactRoot`, `compatibility`, the
two source generation timestamps).

`PortfolioProductRole` (12 values, derived only from each product's own
archetype and its capability domains — never from README phrasing):
`control_plane`, `governance_system`, `operations_system`,
`developer_tool`, `reliability_system`, `migration_system`,
`metadata_system`, `presentation_system`, `integration_layer`,
`shared_library`, `domain_product`, `unknown`. `classifyPrimaryRole()`
(`identity-reconciliation.ts`) maps each of the 13 `ProductArchetype` values
onto one of these 12 (e.g. `governance_platform` -> `governance_system`,
`developer_tool` -> `developer_tool`, `library`/`framework` ->
`shared_library`); an `unknown` archetype resolves to `presentation_system`
only when the product's capability-domain text matches presentation/
visualization/narrative/showcase/storytelling keywords, otherwise stays
`unknown`. `detectReconciliationSignals(products)` additionally surfaces two
informational-only signals — `duplicate_display_name`,
`identical_primary_archetype` — never acted on automatically, only
surfaced (they feed `product_boundary` decisions; see "Decisions").

### Capability normalization

`normalizePortfolioCapabilities()` (`capability-normalization.ts`) merges
one product's capability with another's only when **both** conditions hold:

1. A weighted Jaccard similarity score (`computeCapabilitySimilarity()`) of
   name overlap (0.35) + domain overlap (0.15) + actor overlap (0.15) +
   workflow overlap (0.15) + external-system overlap (0.1) + evidence-type
   overlap (0.1) reaches `SAME_CAPABILITY_THRESHOLD = 0.5`.
2. Name overlap is non-zero **and** at least one of domain/actor/workflow/
   external-system overlap is also non-zero (`isSameCapability()`'s
   structural-agreement gate) — lexical overlap alone is never sufficient.

A small, generic synonym table (`SYNONYM_GROUPS`, 6 groups: identity/access/
permission/entitlement; validation/quality/diagnostics/checks/check;
migration/transition/move/promotion; governance/policy/control; operations/
administration/management; metadata/catalog/lineage) widens name-token
matching without being repository-specific. Matching runs Union-Find across
**different products only** — two capabilities from the same product are
never merged into each other. Coverage is `"single_product"` when a merged
group has exactly one member, `"shared"` when it has more than one — this
stage never produces any other `PortfolioCapabilityCoverage` value; the
remaining values (`complementary`, `overlapping`, `fragmented`, `missing`,
`roadmap_only`) are reserved for later stages (overlaps reclassifies
`"shared"` to `"overlapping"` — see below).

### Product relationships

`buildProductRelationships()` (`product-relationships.ts`) evaluates four
evidence sources, in priority order:

1. **Shared capabilities.** Every pair of products participating in the same
   `"shared"`-coverage capability gets a `shared_capability` relationship.
2. **Weaker capability-pair classification** (`classifyCapabilityPair()`,
   `capability-relationships.ts`) for capability pairs normalization left
   apart: `distinct` (score below `RELATED_FLOOR = 0.2`), `unresolved`
   (score at or above `SAME_CAPABILITY_THRESHOLD` but failed the structural
   gate, or falls through every other check — must never be rendered as a
   confirmed conclusion), `overlapping` (score >= `OVERLAPPING_FLOOR = 0.35`
   with nameOverlap >= 0.3, actorOverlap > 0, domainOverlap > 0),
   `alternative_implementation` (same domain, different external systems,
   nameOverlap >= 0.2), `complementary` (actor or workflow overlap with
   nameOverlap < 0.3). `distinct` pairs are computed but not persisted by
   default.
3. **Conservative actor/workflow-overlap fallback** — only for pairs with
   zero capability-level relationship so far — using
   `SHARED_ACTOR_THRESHOLD = 0.34` / `SHARED_WORKFLOW_THRESHOLD = 0.34`.
4. **`.rvs/portfolio.yml`'s `approved_relationships`** always wins, always
   `confirmed` confidence, and is the only source for `upstream_dependency`
   / `downstream_dependency` / `shared_platform` / `shared_contract`.

`confidenceForAccumulator()` assigns `confirmed` only to config-declared
relationships; `unresolved` type stays `unresolved` confidence; two or more
shared capability ids, or an average score >= 0.45, earns `derived`;
otherwise `suggested`. Relationships with type `"unresolved"` are routed to
`PortfolioModel.unresolvedRelationships`, never `relationships`.

### Dependency graph

`buildDependencyGraph()` (`dependencies.ts`) has two evidence sources: each
product's capability `externalSystems` become one `depends_on` edge per
product/system pair (not per capability); and config
`approved_relationships` of type `upstream_dependency`/`downstream_dependency`
become direct product-to-product edges, while `shared_platform`/
`shared_contract` mint a shared node with an edge from each participant.
`PortfolioDependencyNodeKind` (5 values): `product`, `shared_platform`,
`contract`, `external_system`, `shared_service`. More specific edge kinds
(`produces`, `consumes`, `validates`, `governs`, `deploys_to`, `reads_from`,
`writes_to`, `publishes`, `enriches` — 9 of the 10 declared
`PortfolioDependencyEdgeKind` values beyond `depends_on`) are reserved for
future `architecture-intelligence.json` consumption; only `depends_on` is
emitted today.

### Overlaps

Every `"shared"`-coverage capability is a candidate overlap, but
`detectOverlaps()` (`overlaps.ts`) only records a `PortfolioOverlap` (and
reclassifies that capability's coverage from `"shared"` to `"overlapping"`)
when `!isOwnershipResolved(capability)` — i.e. when it is *not* already the
case that exactly one participant is unqualified (a de facto lead).
`classifyOverlapSeverity(participantCount, confidence)`: `unresolved`
confidence -> `informational`; 4+ participants -> `strategic`; exactly 3
participants -> `material`; `confirmed` confidence -> `minor`; otherwise
`informational`.

### Gaps

`detectGaps()` (`gaps.ts`) computes only **4 of the 8** declared
`PortfolioGapType` values, by design (documented inline in source):

- `qualified_only_coverage` — every participant in a capability is qualified
  (none unqualified).
- `unowned_capability` — an overlap reached `material`/`strategic` severity.
- `runtime_verification_gap` — a `confirmed`-confidence capability has no
  runtime-type evidence (`RUNTIME_EVIDENCE_TYPES = {"runtime_entrypoint",
  "usage", "deployment"}`) anywhere across its participants.
- `dependency_gap` — 2+ products depend on the same `external_system` node
  with no declared `shared_platform`/`shared_contract` relationship between
  them.

The other 4 (`no_product_coverage`, `fragmented_coverage`, `contract_gap`,
`operational_gap`) are typed but never emitted — each would require either a
repository-specific expected-capability list (forbidden) or consuming
`architecture-intelligence.json`/`repository-model.json`, which this stage
does not yet do (a disclosed scope trim, not a defect — see "Known
limitations").

### Operating model

`buildOperatingModel()` (`operating-model.ts`) walks `STAGE_ORDER = [plan,
build, validate, govern, promote, operate, observe, improve]` and assigns
each product to a stage via a partial `ROLE_STAGE` mapping keyed by
`PortfolioProductRole` (e.g. `governance_system`/`control_plane` -> `govern`,
`developer_tool`/`integration_layer`/`shared_library` -> `build`,
`operations_system`/`domain_product` -> `operate`, `migration_system` ->
`promote`, `metadata_system` -> `observe`, `presentation_system` -> `plan`).
`reliability_system` is special-cased: keyword-matched observability
vocabulary in the product's capability-domain text (`observ`/`monitor`/
`telemetry`/`metric`/`alert`) routes to `observe`, otherwise `validate`.
Every stage assignment and transition is always marked `inferred: true` —
this never fabricates a full 8-stage lifecycle narrative for a small
portfolio; products with no role mapping land in `unassignedProductIds`.

### Maturity

`buildMaturitySummary()` (`maturity.ts`) computes 7 `PortfolioMaturityDimension`s
(each `{ score, numerator, denominator, label }`, `score = numerator /
denominator`): `coverage` (confirmed-relationship capabilities / all
capabilities), `operational` (products with >=1 current capability / all
products), `verification` (confirmed capabilities with runtime evidence /
confirmed capabilities), `integration` (resolved relationships / all
relationship evidence including unresolved), `ownership` (resolved-ownership
shared/overlapping capabilities / all shared/overlapping capabilities),
`runtimeEvidence` (products with >=1 runtime-verified capability / all
products), `coherence` (products with no material/strategic overlap / all
products).

## Claims and claim control

`packages/portfolio-intelligence/src/claims.ts`. `buildPortfolioClaims()`
drafts one `PortfolioClaim` per: portfolio-level identity claim + 1 per
product (`draftIdentityClaims`), 1 per normalized capability
(`draftCoverageClaims`), 1 per product x capability participation
(`draftProductCapabilityClaims`), 1 capability-count claim
(`draftCapabilityCountClaim`), 1 per relationship + 1 per unresolved
relationship (`draftRelationshipClaims`), 1 per maturity dimension — 7 total
(`draftMaturityClaims`), 1 per confirmed-confidence capability
(`draftRuntimeVerificationClaims`), 1 per shared/overlapping capability
(`draftOwnershipClaims`), 1 per operating-model stage
(`draftOperatingModelClaims`), and 1 per `.rvs/portfolio.yml` `runtime_claims`
entry (`draftScaleAdoptionClaims`, classified `scale` vs. `adoption` by an
`/adopt/i` text match).

`classifyDraft()` checks, in order, accumulating every rejection reason that
applies (a claim can carry more than one):

1. Zero evidence -> `PORTFOLIO_CLAIM_UNSUPPORTED` (remapped by
   `augmentRejectionReasons()`/`specificUnsupportedReason()` to
   `PORTFOLIO_CLAIM_UNSUPPORTED_SCALE` / `_ADOPTION` / `_INTEGRATION` /
   `_UNIFICATION` depending on the claim's `claimType`).
2. A `.rvs/portfolio.yml` `disallowed_claims` phrase match ->
   `PORTFOLIO_CLAIM_GENERIC_MARKETING`.
3. A generic-marketing term (`containsGenericMarketingTerm()`, reused from
   `@rvs/product-intelligence`) -> `PORTFOLIO_CLAIM_GENERIC_MARKETING`.
4. An absolute-superiority term (`containsAbsoluteSuperiorityTerm()`) ->
   `PORTFOLIO_CLAIM_GENERIC_MARKETING`.
5. Duplicate normalized text against an already-seen claim ->
   `PORTFOLIO_CLAIM_UNSUPPORTED` (also remappable per rule 1).
6. Roadmap-only capability reference -> `PORTFOLIO_CLAIM_ROADMAP_PROMOTED`.
7. Unresolved relationship reference -> `PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP`.
8. Unresolved ownership reference -> `PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP`.
9. Capability double-counting -> `PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY`.
10. Asserting a capability unqualified when it is in fact qualified ->
    `PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED`.
11. Requires runtime evidence but lacks it -> `PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED`.

Any rejection reason -> `status: "rejected"`. Else, an override-sourced
runtime claim -> `"runtime_verification_required"`. Else, qualifier text
present -> `"approved_with_qualification"`. Else -> `"approved"`.

`PortfolioClaimRejectionReasonCode` (12 values):

| Code | Meaning |
|---|---|
| `PORTFOLIO_CLAIM_UNSUPPORTED` | zero evidence, or duplicate text, and no claim-type-specific remap applied |
| `PORTFOLIO_CLAIM_DOUBLE_COUNTS_CAPABILITY` | a capability-count claim's participant sum doesn't match the normalized capability count |
| `PORTFOLIO_CLAIM_ROADMAP_PROMOTED` | references a roadmap-only capability id |
| `PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED` | asserts a capability as unqualified when a participant is in fact qualified |
| `PORTFOLIO_CLAIM_RUNTIME_UNVERIFIED` | requires runtime evidence the capability does not carry |
| `PORTFOLIO_CLAIM_UNSUPPORTED_SCALE` | a `scale`-type claim with zero evidence |
| `PORTFOLIO_CLAIM_UNSUPPORTED_ADOPTION` | an `adoption`-type claim with zero evidence |
| `PORTFOLIO_CLAIM_UNSUPPORTED_INTEGRATION` | an `integration`-type claim with zero evidence |
| `PORTFOLIO_CLAIM_UNSUPPORTED_UNIFICATION` | a `unification`-type claim with zero evidence |
| `PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP` | references a relationship that has not been classified beyond `unresolved` |
| `PORTFOLIO_CLAIM_GENERIC_MARKETING` | matches a disallowed/generic-marketing/absolute-superiority term |
| `PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP` | references an overlap whose ownership is not resolved |

`PortfolioClaimType` (10 values): `identity`, `coverage`, `relationship`,
`integration`, `unification`, `maturity`, `scale`, `adoption`, `ownership`,
`operating_model`.

## Decisions

`buildPortfolioDecisions(model)` (`portfolio-plan.ts`) composes decisions
from four sources:

- `decisionsFromGaps()`, via `GAP_TYPE_TO_DECISION_TYPE`:
  `qualified_only_coverage` -> `qualified_capability_investment`,
  `unowned_capability` -> `ownership`, `runtime_verification_gap` ->
  `runtime_verification`, `dependency_gap` -> `shared_contract`.
- `decisionsFromOverlaps()` — only `strategic`-severity overlaps ->
  `overlap_resolution`, urgency always `high`.
- `decisionsFromReconciliationSignals()` -> `product_boundary`, urgency
  `low`, confidence `suggested`.
- `decisionsFromUnresolvedRelationships()` -> `integration_priority`,
  urgency `low`, confidence `unresolved`.

`PortfolioDecisionType`'s remaining value, `deprecation`, is never emitted —
it would require usage-trend or superseded-by evidence this pipeline does
not consume (a disclosed scope trim, same rationale as the 4 un-emitted gap
types above).

`PortfolioDecision`: `id`, `type`, `statement`, `whyItMatters`,
`affectedProductIds`, `evidenceIds`, `currentAmbiguity`,
`recommendedOwnerType` (`PortfolioDecisionOwnerType`, 5 values:
`platform_leadership`, `product_owner`, `architecture_council`,
`security_owner`, `operations_owner` — `security_owner` is never assigned by
role alone, reserved for security-flavored evidence not yet computed),
`urgency` (`low`/`medium`/`high`), `confidence`.

`ROLE_OWNER_TYPE` (`ownership.ts`) maps each `PortfolioProductRole` to a
default owner type (e.g. `control_plane` -> `architecture_council`,
`governance_system` -> `platform_leadership`, `developer_tool` ->
`product_owner`, `unknown` -> `platform_leadership`).
`isOwnershipResolved(capability)` treats any non-shared/overlapping-coverage
capability as trivially resolved; for shared/overlapping coverage, resolved
only when exactly one participant is unqualified.

## Validation

Pure structural, no rendered DOM — mirrors
[`@rvs/product-intelligence`'s own validation split](./product-identity-intelligence.md#validation)
(`validateProductIdentityModel` / `validateShowcasePlan`) with a third
validator for the presentation plan. `packages/portfolio-intelligence/src/validation.ts`
exports three independent functions, composed by callers as needed:

- `validatePortfolioModel(model)`
- `validatePortfolioClaims(claims, model)`
- `validatePortfolioPlan(plan)` — does **not** re-validate `plan.model`;
  compose with `validatePortfolioModel` separately.

Severity: structural corruption, dangling references, and claim-control
contradictions are always Tier 1 (`"error"`, blocks `rvs validate --ci`
unconditionally); content-quality signals that could reflect genuinely weak
evidence rather than a synthesis bug (too few/many scenes) stay Tier 2
(`"warning"`) — the same split `SHOWCASE_TOO_FEW_SCENES` established.

| Code | Tier | Meaning |
|---|---|---|
| `PORTFOLIO_MODEL_MISSING_DISPLAY_NAME` | error | `model.displayName` is blank |
| `PORTFOLIO_MODEL_NO_PRODUCTS` | error | zero products in the model |
| `PORTFOLIO_MODEL_DUPLICATE_PRODUCT_ID` | error | two products share an id |
| `PORTFOLIO_MODEL_DUPLICATE_CAPABILITY_ID` | error | two capabilities share an id |
| `PORTFOLIO_MODEL_CAPABILITY_EVIDENCE_MISSING` | error | a capability has zero evidence ids |
| `PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH` | error | a capability's `coverage`/`participation` are inconsistent (e.g. `"missing"` with participants, or non-`"missing"` with none) |
| `PORTFOLIO_MODEL_CAPABILITY_UNKNOWN_PARTICIPANT` | error | a participant references a product id not in `model.products` |
| `PORTFOLIO_MODEL_RELATIONSHIP_SELF_REFERENCE` | error | a relationship's `productAId` equals its `productBId` |
| `PORTFOLIO_MODEL_RELATIONSHIP_UNKNOWN_PRODUCT` | error | a relationship references an unknown product |
| `PORTFOLIO_MODEL_RELATIONSHIP_EVIDENCE_MISSING` | error | a relationship has zero evidence ids |
| `PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED` | error | a resolved-type relationship in `unresolvedRelationships`, or an `"unresolved"`-type relationship in `relationships` |
| `PORTFOLIO_MODEL_DEPENDENCY_EDGE_UNKNOWN_ENDPOINT` | error | a dependency edge's source product or target node doesn't resolve |
| `PORTFOLIO_MODEL_DEPENDENCY_NODE_DUPLICATE_ID` | error | two dependency-graph nodes share an id |
| `PORTFOLIO_MODEL_OVERLAP_UNKNOWN_CAPABILITY` | error | an overlap references an unknown capability |
| `PORTFOLIO_MODEL_OVERLAP_EVIDENCE_MISSING` | error | an overlap has zero evidence ids |
| `PORTFOLIO_MODEL_GAP_UNKNOWN_CAPABILITY` | error | a gap references an unknown capability |
| `PORTFOLIO_MODEL_GAP_EVIDENCE_MISSING` | error | a gap has zero evidence ids |
| `PORTFOLIO_MODEL_OPERATING_MODEL_CONTRADICTION` | error | a product is both stage-assigned and listed as unassigned |
| `PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT` | error | an operating-model stage or `unassignedProductIds` references an unknown product |
| `PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE` | error | any field cites an evidence id not present in `model.evidence` |
| `PORTFOLIO_MODEL_EVIDENCE_DUPLICATE_ID` | error | two evidence items share an id |
| `PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER` | error | `products`/`capabilities`/`relationships`/`overlaps`/`gaps`/`evidence` isn't sorted by id |
| `PORTFOLIO_MODEL_MATURITY_INCONSISTENT_SCORE` | warning | a maturity dimension's `score` doesn't equal `numerator / denominator` |
| `PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS` | error | a `"rejected"` claim has zero rejection reason codes |
| `PORTFOLIO_CLAIM_UNEXPECTED_REJECTION_REASONS` | error | a non-`"rejected"` claim carries rejection reason codes |
| `PORTFOLIO_CLAIM_QUALIFICATION_MISSING_QUALIFIER` | error | an `"approved_with_qualification"` claim has zero qualifier text |
| `PORTFOLIO_CLAIM_DUPLICATE_ID` | error | two claims share an id |
| `PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE` | error | a claim cites an evidence id not present in `model.evidence` |
| `PORTFOLIO_CLAIM_NONDETERMINISTIC_ORDER` | error | claims aren't sorted by id |
| `PORTFOLIO_PLAN_TOO_FEW_SCENES` | warning | fewer than `PORTFOLIO_PLAN_MIN_SCENES` (6) scenes |
| `PORTFOLIO_PLAN_TOO_MANY_SCENES` | warning | more than `PORTFOLIO_PLAN_MAX_SCENES` (13) scenes |
| `PORTFOLIO_PLAN_HEADLINE_TOO_LONG` | error | a scene headline exceeds `PORTFOLIO_HEADLINE_HARD_MAX_WORDS` (14 words) |
| `PORTFOLIO_PLAN_GENERIC_HEADLINE` | error | a scene headline is a generic slide label (e.g. "Overview", "Portfolio") rather than a conclusion |
| `PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE` | error | a scene references a product/capability/relationship/gap/claim/evidence id not present in the plan's model or narrative claims |
| `PORTFOLIO_PLAN_DECISION_MISSING_STATEMENT` | error | a decision has no statement text |
| `PORTFOLIO_PLAN_DECISION_UNKNOWN_PRODUCT` | error | a decision references an unknown product |
| `PORTFOLIO_PLAN_DECISION_DUPLICATE_ID` | error | two decisions share an id |
| `PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER` | error | `plan.decisions` isn't sorted by id (scenes are deliberately **not** checked for id order — their sequence is presentation order, mirroring `@rvs/product-intelligence`'s own showcase-scene precedent) |

## Narrative

`buildPortfolioNarrative()` (`narrative.ts`) composes 8 narrative sections —
`mission`, `productsAndRoles`, `sharedOperatingModel`, `capabilityCoverage`,
`productRelationships`, `proofAndMaturity`, `gapsAndDecisions`,
`strategicDirection` — purely from `approved`/`approved_with_qualification`
claims, **except** `gaps`, which are cited directly since they are
already-validated structural facts rather than claims (the same documented
exception `@rvs/product-intelligence`'s `identity.limitations` precedent
establishes). Never composed from `rejected` claims or raw model facts
otherwise.

## Ids

Every id (`ids.ts`) is a pure function of stable inputs — never scan order,
never a timestamp — so the same inputs always produce the same id:
`portfolioProductId`, `portfolioEvidenceId`, `portfolioCapabilityId`,
`portfolioDomainId`, `portfolioRelationshipId` (sorts the product pair
alphabetically first, so a relationship's id doesn't depend on which product
was listed first in config), `portfolioDependencyNodeId`,
`portfolioDependencyEdgeId`, `portfolioOverlapId`, `portfolioGapId`,
`portfolioClaimId`, `portfolioDecisionId`, `portfolioSceneId`.

## CLI

```bash
rvs synthesize portfolio [--allow-partial]
  # requires .rvs/portfolio.yml (throws a descriptive error if missing)
  # reads each product's artifact_root, runs the full pipeline, validates the model inline
  # -> .rvs/cache/portfolio-model.json, .rvs/cache/portfolio-claims.json, .rvs/cache/portfolio-decisions.json

rvs export portfolio-model --output portfolio-model.json
rvs export portfolio-claims --output portfolio-claims.json
rvs export portfolio-decisions --output portfolio-decisions.json
  # each: pure formatting over the already-synthesized cache — `rvs synthesize portfolio` must run first

rvs portfolio explain <id>
  # <id> may be a claim id or a decision id (the two id spaces never collide);
  # prints full evidence, qualifiers, rejection reasons (claims) or
  # urgency/confidence/recommended owner/current ambiguity (decisions)

rvs create slides --profile portfolio [--audience portfolio|...] [--theme ...]
  # see docs/portfolio-showcase.md
```

`rvs synthesize portfolio`'s log line (`packages/cli/src/commands/synthesize-portfolio.ts`):

```
Synthesized portfolio "<displayName>": <N> product(s), <N> normalized capability(ies), <N> relationship(s), <N> gap(s), <N> decision(s), <N> error(s), <N> warning(s).
```

plus, only when `excludedProducts.length > 0`:

```
<N> product(s) excluded as incompatible: <configId> (<compatibility>), ...
```

`rvs portfolio explain <id>`'s not-found error (`packages/cli/src/commands/portfolio-explain.ts`):

```
No claim or decision found matching "<id>". Run `rvs synthesize portfolio` first, then `rvs export portfolio-claims`/`rvs export portfolio-decisions` to see all known ids.
```

`rvs validate --ci` also runs `validatePortfolioModel()` +
`validatePortfolioClaims()` (and `validatePortfolioPlan()` when a
`portfolio-plan.json` cache exists) against `.rvs/cache/portfolio-model.json`
+ `.rvs/cache/portfolio-claims.json` when present
(`validateCachedPortfolio()` in `packages/cli/src/commands/validate.ts`),
writing `artifacts/visuals/portfolio-validation-report.json` and logging:

```
Validated portfolio: <N> error(s), <N> warning(s).
```

Both artifacts are fully optional/backward-compatible: a repository that has
never run `rvs synthesize portfolio` sees no behavior change at all — the
check is skipped entirely, and it is combined into the overall `--ci`
`hasError` flag alongside the capability/product-identity/showcase outcomes.

## Self-hosting proof

Two independent proof runs, both against the same three-modification working
tree, neither committed.

### Fixture-portfolio proof (3 independently-shaped generic products)

Three generic fixture repositories — Governance CLI, Reliability CLI,
Migration CLI — each with its own git repo, README, source, and CI
workflow, were each run through the full pipeline
(`inspect -> synthesize architecture -> synthesize capabilities ->
synthesize product-identity -> export product-identity`) independently, then
combined via a `.rvs/portfolio.yml` naming all three.

**Intake:** all 3 reached `compatible_with_warnings` — the only issues were
`optional-input-unavailable` for `architecture-intelligence.json` /
`repository-model.json` / `showcase-plan.json` / `showcase-claims.json`
(all optional; none was `missing_required_artifact`). `excludedProducts: []`.

**Per-product identity:**

| Product | Archetype | Included capabilities | Qualified |
|---|---|---|---|
| governance-cli | `governance_platform` (confirmed) | 4 (Governance, Observability, Release and Maintenance, Review and Approval) | 1 |
| reliability-cli | `reliability_platform` (derived) | 3 (Diagnostics, Observability, Release and Maintenance) | 2 |
| migration-cli | `migration_platform` (derived) | 4 (Diagnostics, Migration, Release and Maintenance, Review and Approval) | 2 |

**Portfolio result:** 11 normalized capabilities (7 `single_product`, 4
`overlapping`); 3 relationships, all `shared_capability`, forming a complete
triangle across every product pair; 4 overlaps — 3 `minor` pairwise plus 1
`material` three-way overlap on "Release and Maintenance" spanning all 3
products; 6 gaps — 5 `qualified_only_coverage` plus 1 `unowned_capability`
(the material 3-way overlap).

**Claims:** 63 total — 43 approved, 8 approved with qualification, 12
rejected. Rejection codes observed: `PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED`
(5x), `PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP` (4x),
`PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP` (3x — each rejected specifically
because the templated per-pair claim was superseded by the actual resolved
`shared_capability` relationship, not because evidence was missing).

**Decisions:** 9 total — 3 `integration_priority`, 5
`qualified_capability_investment`, 1 `ownership`. The one `ownership`
decision: ownership of the Release-and-Maintenance material 3-way overlap is
unresolved across all 3 products, urgency `high`, recommended owner
`architecture_council`.

**Presentation:** `rvs create slides --profile portfolio --audience
portfolio` rendered 11 scenes, no crash. `rvs validate --ci` reported
`Validated portfolio: 0 error(s), 0 warning(s)` — the portfolio-intelligence
layer itself was fully clean — but the overall command still exited 1 due
to 6 unrelated rendering-density findings on portfolio scenes (4x
`min-font-size` at 12-13px against the 14px floor, 2x `overflow` at 28-141px)
— a scene-layout/design-system density concern the renderer's shared CSS has
today, not a portfolio-logic defect. No `PORTFOLIO_*` error code fired.

**A lesson from building the fixtures, not a portfolio-intelligence bug:** a
nested `packages/doctor` workspace package initially suppressed
`detectWorkspacePackages()`'s root-manifest fallback for `reliability-cli`,
so its root CLI's `bin` field wasn't classified as its own component until
the fixture was restructured to give the CLI its own `packages/cli`
workspace package — an artifact of `@rvs/repository-model`'s
workspace-package detection (`packages/repository-model/src/workspace-packages.ts`),
outside this package's boundary.

### Real-project proof (repo-visual-studio's own artifacts as a 4th product)

`rvs export product-identity` against `repo-visual-studio`'s own current
cache reproduces the same conservative result
[`docs/product-identity-intelligence.md`'s own self-hosting proof](./product-identity-intelligence.md#self-hosting-proof)
documents: archetype `unknown`, confidence `unresolved`, 0
`currentCapabilities`, 2 `qualifiedCapabilities`.

Adding this genuinely-scanned (not hand-authored) artifact as a 4th product
to the 3-fixture portfolio, via `--allow-partial`, reached
`compatible_with_warnings`, `excludedProducts: []`. Portfolio-wide totals
became: 13 normalized capabilities, 3 relationships (**unchanged**), 4
overlaps (unchanged), 8 gaps, 14 decisions. `rvs synthesize portfolio`
logged `... 0 error(s), 0 warning(s).`

**Why the relationship count didn't grow, and why that's correct, not a
bug:** `repo-visual-studio`'s own capability text (its 2 qualified
capabilities — `@rvs/cli` itself and the CI workflow's "Other Automation"
family) simply doesn't share enough name/domain/actor/workflow/
external-system vocabulary with any of the 3 fixtures' capabilities to clear
either `SAME_CAPABILITY_THRESHOLD` (0.5, for a merge) or `RELATED_FLOOR`
(0.2, for even a weaker classified pair). Adding a 4th, evidence-thin
product does not fabricate a relationship just to make the portfolio look
more connected — this is the same conservative-bias rule this whole
milestone is built on, demonstrated against real (not fixture) data.

`portfolio-model.json` is also consumed by Milestone 7's Architecture
Governance and Continuous Intelligence layer: `@rvs/governance-intelligence`'s
`portfolio-diff.ts` diffs two snapshots' copies of this artifact to detect
relationship/dependency/overlap/gap changes between a baseline and the
current state, feeding governance's cross-product blast-radius assessment —
the only portfolio-layer input governance reads (portfolio fingerprinting is
opt-in via `rvs snapshot create --include-portfolio`). See
[`docs/architecture-governance.md`](architecture-governance.md).

`portfolio-model.json` is also consumed by Milestone 8's Architecture
Decision Intelligence layer: `@rvs/decision-intelligence`'s
`portfolio-links.ts` resolves a decision's declared `domain: portfolio`
links against this artifact's own entity ids, using the same bounded
structural-walk pattern the other 3 upstream-artifact resolvers use. See
[`docs/architecture-decision-intelligence.md`](architecture-decision-intelligence.md)
and [`docs/decision-linking.md`](decision-linking.md).

## Known limitations

- **`detectGaps()` computes only 4 of the 8 declared `PortfolioGapType`
  values** (`qualified_only_coverage`, `unowned_capability`,
  `runtime_verification_gap`, `dependency_gap`). `no_product_coverage` and
  `fragmented_coverage` would require a repository-specific expected-
  capability list, which this package's design forbids; `contract_gap` and
  `operational_gap` would require consuming `architecture-intelligence.json`
  / `repository-model.json`, which this stage does not yet do even though
  both are already collected as optional intake artifacts.
- **`buildDependencyGraph()` only emits `depends_on` edges.** The other 9
  declared `PortfolioDependencyEdgeKind` values (`produces`, `consumes`,
  `validates`, `governs`, `deploys_to`, `reads_from`, `writes_to`,
  `publishes`, `enriches`) are reserved for future `architecture-intelligence.json`
  consumption.
- **`deprecation` is a declared `PortfolioDecisionType` that is never
  emitted** — it would require usage-trend or superseded-by evidence this
  pipeline does not consume.
- **`unresolvedRelationships`/`"distinct"` capability pairs must never be
  rendered as a confirmed conclusion.** This is a hard rule enforced by
  keeping them in separate arrays/never persisting `"distinct"` pairs by
  default, not just a naming convention.
- **No model-assisted synthesis.** Every stage is deterministic, rule-based,
  offline synthesis — no network access, no LLM dependency, matching every
  prior milestone's `assist_used: false` contract.

## Package summary

| Package | Role |
|---|---|
| `@rvs/portfolio-intelligence` | `PortfolioModel`/`PortfolioClaim`/`PortfolioDecision` types, the full intake -> compatibility -> reconciliation -> normalization -> relationships -> dependencies -> overlaps -> gaps -> operating model -> maturity -> claim control pipeline, structural validation, JSON exporters |
| `@rvs/cli` | `rvs synthesize portfolio [--allow-partial]`; `rvs export portfolio-model`/`portfolio-claims`/`portfolio-decisions`; `rvs portfolio explain <id>` |

`packages/portfolio-intelligence` (`@rvs/portfolio-intelligence`) depends
only on `@rvs/capability-intelligence` and `@rvs/product-intelligence` for
input types, plus `yaml`/`zod` for config parsing — no dependency in the
other direction, and no external model call anywhere in the package.

`portfolio-model.json` is also consumed by the Knowledge Graph layer, see
[docs/architecture-knowledge-graph.md](architecture-knowledge-graph.md).
