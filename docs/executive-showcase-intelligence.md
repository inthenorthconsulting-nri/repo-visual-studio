# Executive Narrative and Showcase Intelligence (Milestone 5, part 2)

This document describes the second half of Milestone 5: turning a
`ProductIdentityModel` (see
[docs/product-identity-intelligence.md](./product-identity-intelligence.md))
into an audience-aware executive narrative, a claim-controlled set of
statements a showcase is actually allowed to make, and a `ShowcasePlan` —
a new "showcase" presentation profile of 7-10 scenes rendered through the
existing `@rvs/renderer-html` pipeline at a fixed 1920×1080 stage.

```
ProductIdentityModel                          (docs/product-identity-intelligence.md)
  -> ProductClaim[]            (claims.ts — claim control: approve / qualify / reject / require runtime verification)
  -> ExecutiveNarrative        (narrative.ts — audience-shaped narrative composed only from approved/qualified claims)
  -> ShowcasePlan               (showcase-plan.ts — 7-10 scene sequence + metrics + evidence summary)
  -> VisualDoc (profile: showcase)  (narrative-planner)
  -> HTML / PDF                 (renderer-html / exporter, unchanged pipeline)
```

## Design mandate

Everything downstream of claim control is downstream *of* claim control —
the narrative and the scene sequence are composed only from the claims
`classifyDraft()` already accepted (`approved` or
`approved_with_qualification`, or `runtime_verification_required` when a
`.rvs/product.yml` override explicitly says a human verified it). There is
no path in this package that writes showcase text directly from
`ProductIdentityModel` fields, bypassing claim control — `index.ts` runs
`buildProductClaims()` before `buildExecutiveNarrative()` unconditionally,
documented inline as "claim control always runs before narrative
synthesis."

The rule this enforces: a showcase can compress and prioritize evidence for
an audience, but it can never say something the claim-control engine
rejected.

## Claim control

`packages/product-intelligence/src/claims.ts`. `buildProductClaims(identity,
capabilityModel, override?)` drafts one `ProductClaim` per identity claim,
purpose statement, value pillar (an `outcome` claim), included/qualified
capability (a `capability` claim), differentiator, a single `maturity`
claim, and any override-sourced `scale`/`adoption` claims — then runs every
draft through `classifyDraft()`.

`ClaimType` (9 values): `identity`, `purpose`, `outcome`, `capability`,
`differentiator`, `maturity`, `scale`, `adoption`, `comparison`.

`classifyDraft()` checks, in this order, and accumulates every reason that
applies (a claim can carry multiple rejection reasons):

1. Generic marketing terms (`GENERIC_MARKETING_TERMS`) → `SHOWCASE_CLAIM_GENERIC_MARKETING`.
2. Absolute superiority terms (`ABSOLUTE_SUPERIORITY_TERMS`, e.g. "best-in-class", "industry-leading") → `SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE`.
3. A technical-token match (`TECHNICAL_TOKEN_PATTERN = /[a-z0-9_-]+\/[a-z0-9_.-]+|\b[a-z]+(?:[A-Z][a-z0-9]*){2,}\b/` — package-path-like or camelCase-like tokens) → `SHOWCASE_CLAIM_TOO_TECHNICAL`.
4. Duplicate normalized text against an already-seen claim → `SHOWCASE_CLAIM_DUPLICATE`.
5. A reference to a roadmap or excluded capability id, cross-checked against the `CapabilityModel` → `SHOWCASE_CLAIM_ROADMAP_PROMOTED` / `SHOWCASE_CLAIM_EXCLUDED_CAPABILITY`; a reference to a *qualified* capability id sets a separate flag that, if nothing else rejects the claim, resolves to `approved_with_qualification` status below (not a rejection reason).
6. Scale/adoption claim types with no matching `.rvs/product.yml` `runtime_claims` entry → `SHOWCASE_CLAIM_UNSUPPORTED_SCALE` / `SHOWCASE_CLAIM_UNSUPPORTED_ROI`.
7. Zero evidence ids → `SHOWCASE_CLAIM_UNSUPPORTED` — except `maturity` claims, which are permitted zero evidence ids because a maturity statement is a structural count over the `CapabilityModel` itself, not a citation-backed assertion.

A claim with any rejection reason becomes `status: "rejected"`. An
override-sourced runtime claim with no other rejection reason becomes
`"runtime_verification_required"`. A claim referencing a qualified
capability with no other rejection reason becomes
`"approved_with_qualification"`. Everything else clears as `"approved"`.

`ShowcaseClaimRejectionReasonCode` (11 codes, from `contracts.ts`) and
whether `classifyDraft()` currently reaches them:

| Code | Reachable | Meaning |
|---|---|---|
| `SHOWCASE_CLAIM_GENERIC_MARKETING` | yes | text contains a `GENERIC_MARKETING_TERMS` phrase |
| `SHOWCASE_CLAIM_ABSOLUTE_LANGUAGE` | yes | text contains an `ABSOLUTE_SUPERIORITY_TERMS` phrase |
| `SHOWCASE_CLAIM_TOO_TECHNICAL` | yes | text matches `TECHNICAL_TOKEN_PATTERN` |
| `SHOWCASE_CLAIM_DUPLICATE` | yes | normalized text duplicates an earlier claim |
| `SHOWCASE_CLAIM_ROADMAP_PROMOTED` | yes | references a roadmap-only capability id |
| `SHOWCASE_CLAIM_EXCLUDED_CAPABILITY` | yes | references an excluded candidate id |
| `SHOWCASE_CLAIM_UNSUPPORTED_SCALE` | yes | a `scale` claim with no matching override `runtime_claims` entry |
| `SHOWCASE_CLAIM_UNSUPPORTED_ROI` | yes | an `adoption` claim with no matching override `runtime_claims` entry |
| `SHOWCASE_CLAIM_UNSUPPORTED` | yes | zero evidence ids (non-`maturity` claim) |
| `SHOWCASE_CLAIM_UNQUALIFIED_PARTIAL` | **no** — see [Known limitations](#known-limitations) | — |
| `SHOWCASE_CLAIM_RUNTIME_UNVERIFIED` | **no** — see [Known limitations](#known-limitations) | — |

Every rejected claim is still returned (in `rejectedClaims`), not discarded
— `rvs showcase explain <claim-id>` (below) depends on rejected claims
remaining inspectable, so a reviewer can see exactly why the showcase does
not say something, not just that it doesn't.

## Executive narrative synthesis

`packages/product-intelligence/src/narrative.ts`.
`buildExecutiveNarrative(identity, claims, audience)` composes an
`ExecutiveNarrative` — `objective`, `centralMessage`, `problemStatement`,
`productPromise`, `valuePillars`, `proofPoints`, `differentiators`,
`limitations`, `closingMessage` — entirely from `approvedClaims` /
`qualifiedClaims` text and the identity's own `limitations`/`evidence`
fields. `AudienceType` (9 values) shapes tone/objective phrasing
(`objectiveForAudience()`) but never unlocks a claim claim control rejected
— audience-awareness governs framing, not evidentiary standard.

`proofPoints` are built from claims whose evidence is `confirmed` or
`derived` — never from `suggested`-confidence evidence alone, keeping proof
points at the same evidentiary bar the identity model itself enforces.

## Showcase plan and scene sequencing

`packages/product-intelligence/src/showcase-plan.ts`.
`SHOWCASE_MIN_SCENES = 7`, `SHOWCASE_MAX_SCENES = 10`.
`SHOWCASE_HEADLINE_PREFERRED_MAX_WORDS = 12`,
`SHOWCASE_HEADLINE_HARD_MAX_WORDS = 14`.

`DEFAULT_SEQUENCE` (8 scene types, always attempted in this order):
`showcase-hero` → `showcase-problem` → `showcase-identity` →
`showcase-operating-model` → `showcase-value-pillars` →
`showcase-capabilities` → `showcase-differentiators` → `showcase-closing`.

`selectSceneTypes()` is **evidence-gated, not count-gated** — scenes are
never padded to hit the 7-10 band artificially:

- `showcase-differentiators` is only inserted when `identity.differentiators.length > 0`.
- `showcase-proof` (optional, not in the default 8) is only inserted when ≥3 confirmed/derived proof points exist.
- `showcase-limitations` (optional) is only inserted when `narrative.limitations.length > 0`.
- `portfolio-overview` (optional, see "Portfolio intelligence" below) is only inserted when portfolio input is supplied.

`ShowcaseSceneType` (11 values total, including the 3 conditional/optional
ones above): `showcase-hero`, `showcase-problem`, `showcase-identity`,
`showcase-operating-model`, `showcase-value-pillars`,
`showcase-capabilities`, `showcase-differentiators`, `showcase-proof`,
`showcase-limitations`, `showcase-closing`, `portfolio-overview`. Each maps
to a fixed `ShowcaseVisualMetaphor` (`VISUAL_METAPHOR_BY_TYPE`, 10 values:
`hero`, `causal-flow`, `layered-architecture`, `pillar-grid`,
`capability-map`, `differentiator-lens`, `proof-ledger`,
`limitation-ledger`, `north-star`, `portfolio-grid`) and a fixed
`narrativeRole` (`NARRATIVE_ROLE_BY_TYPE`) — the mapping is generic and
scene-type-keyed, never repository-specific.

`buildScenesForTypes()` constructs each scene's `headline`,
`subheadline?`, `capabilityIds`, `claimIds`, `evidenceIds`, and
`qualifiers` purely from the already-classified claims and narrative —
headlines are truncated to the word-count caps above, never hand-written.

`buildMetrics()` selects the top 4 confirmed/derived proof points as
`ShowcaseMetric[]`. `buildEvidenceSummary()` tallies evidence-strength and
claim-status counts. `buildShowcasePlan()` assembles the full `ShowcasePlan`
(`identity`, `narrative`, `scenes`, `metrics`, `evidenceSummary`,
`generationMetadata`).

## Showcase plan validation

Pure structural, no rendered DOM — mirrors
[`validateProductIdentityModel()`](./product-identity-intelligence.md#validation).
`validateShowcasePlan(plan, capabilityModel)`
(`packages/product-intelligence/src/validation.ts`), run automatically
against `.rvs/cache/showcase-plan.json` by `rvs validate --ci` when present
(`validateCachedShowcasePlan()` in `packages/cli/src/commands/validate.ts`).

| Code | Severity | Meaning |
|---|---|---|
| `SHOWCASE_TOO_FEW_SCENES` | warning | fewer than `SHOWCASE_MIN_SCENES` (7) scenes — may reflect genuinely weak evidence, not a bug |
| `SHOWCASE_TOO_MANY_SCENES` | warning | more than `SHOWCASE_MAX_SCENES` (10) scenes |
| `SHOWCASE_MISSING_CENTRAL_MESSAGE` | error | `narrative.centralMessage` is blank |
| `SHOWCASE_HEADLINE_TOO_LONG` | error | a scene headline exceeds `SHOWCASE_HEADLINE_HARD_MAX_WORDS` (14 words) |
| `SHOWCASE_GENERIC_HEADLINE` | error | a scene headline is a generic slide label (e.g. "Overview", "Features") rather than a conclusion |
| `SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED` | warning | a scene headline is phrased as a question (ends with "?") |
| `SHOWCASE_SCENE_TOO_DENSE` | warning | a scene's `capabilityIds.length + claimIds.length + evidenceIds.length` exceeds the item budget for its declared `density` (15 for `low`, 25 for `medium`) |
| `SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM` | error | a scene references a qualified capability but neither its headline nor qualifiers disclose the limitation |
| `SHOWCASE_HEADLINE_ROADMAP_PROMOTED` | error | a scene references a roadmap-only capability id |
| `SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED` | error | a scene references an excluded candidate id |
| `SHOWCASE_RUNTIME_CLAIM_UNVERIFIED` | warning | a scene references a `runtime_verification_required` claim without a qualifier disclosing it is unverified |
| `SHOWCASE_SCENE_WORD_BUDGET_EXCEEDED` | warning | a scene's headline + subheadline exceeds the 30-word narrative budget |
| `SHOWCASE_DUPLICATE_SCENE_PURPOSE` | warning | two scenes share the same `narrativeRole` + headline |
| `SHOWCASE_NONDETERMINISTIC_ORDER` | error | a scene's `capabilityIds` are not sorted by id |
| `SHOWCASE_UNSUPPORTED_METRIC` | warning | a metric has zero `evidenceIds`, or none resolve to a real evidence item's `sourceId` |
| `SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY` | error | a metric's resolved evidence traces back to a roadmap-only or excluded capability |
| `SHOWCASE_EVIDENCE_MISSING` | warning | a claim in `narrative.rejectedClaims` has zero recorded rejection reason codes |
| `SHOWCASE_FONT_BELOW_MINIMUM` | *(unimplemented — see [Known limitations](#known-limitations))* | — |
| `SHOWCASE_LOW_CONTRAST` | *(unimplemented — see [Known limitations](#known-limitations))* | — |

`SHOWCASE_HEADLINE_ROADMAP_PROMOTED`/`SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED`/
`SHOWCASE_NONDETERMINISTIC_ORDER` share a code with an identity-level check
of the same name in
[docs/product-identity-intelligence.md#validation](./product-identity-intelligence.md#validation)
— both packages check the same invariant at a different layer, so the same
code can legitimately fire from either validator depending on which artifact
carries the defect.

## CLI

```bash
rvs synthesize product-identity        # see docs/product-identity-intelligence.md
rvs create slides --profile showcase [--audience executive|...] [--theme executive-dark|...]
  # -> runs buildProductClaims + buildExecutiveNarrative + buildShowcasePlan
  # -> VisualDoc via the new "showcase" presentation profile -> artifacts/visuals/deck.html

rvs export product-identity --output product-identity.json
rvs export showcase-plan --output showcase-plan.json
rvs showcase explain <claim-id>
  # prints the claim's text, status, evidence ids, qualifiers, and (if rejected) every rejection reason code
```

`rvs validate --ci` runs the showcase scene renderer through the same
Playwright deterministic checks (overflow, min font size, contrast,
citation presence) as every other profile — no showcase-specific validator
exemptions exist.

## Portfolio intelligence (optional)

`ProductIdentityModel`/`ShowcasePlan` accept an optional portfolio input
(multiple `ProductIdentity` summaries) that, when supplied, unlocks the
`portfolio-overview` scene type. Omitted entirely for a single-repository
run — this is why the `repo-visual-studio` self-hosting proof below has no
`portfolio-overview` scene.

## Self-hosting proof

Run against `repo-visual-studio` itself: `rvs synthesize product-identity` →
`rvs create slides --profile showcase` → `rvs export showcase-plan` → `rvs
showcase explain <claim-id>` → `rvs validate --ci`.

**Result: 7 scenes generated (`showcase-hero`, `showcase-problem`,
`showcase-identity`, `showcase-operating-model`, `showcase-value-pillars`,
`showcase-capabilities`, `showcase-closing`), 4 approved claims + 1 claim
approved with qualification, 2 claims rejected, 0 differentiator claims, 28
Playwright checks passed / 0 failed, exit code 0.** `rvs validate --ci` also
reports 1 `SHOWCASE_UNSUPPORTED_METRIC` warning on the plan itself (only
reachable after the §6 validator-code-coverage closure pass wired it up) —
one showcase metric doesn't resolve to identity-model evidence, correctly
flagged rather than silently rendered.

This is claim control working end to end on real, weak self-hosting
evidence, not a curated demo:

- **`showcase-differentiators` was correctly omitted.** `identity.differentiators` is `[]` (see the Product Identity Intelligence self-hosting proof — no differentiator cleared any of the 4 structural criteria against RVS's own thin, 0-included-capability model), and `selectSceneTypes()`'s evidence gate means the scene is never inserted just to pad toward the 7-10 band. The sequence lands at exactly 7 scenes — the `DEFAULT_SEQUENCE` 8 minus the one gated-out type.
- **5 claims were approved (4 fully, 1 with qualification).** `identity`
  ("Repo Visual Studio is a Software platform."), `purpose`, `maturity`
  ("0 of 16 evaluated capabilities are currently included, with 2 included
  under a stated qualification."), and `outcome` (the "General Automation"
  pillar's outcome statement, all `approved`), plus one `capability` claim
  ("Other Automation: 1 workflow that did not match a named automation
  family.") that references a qualified (not included) capability and so
  correctly landed as `approved_with_qualification` rather than `approved`.
- **2 claims were rejected, both `SHOWCASE_CLAIM_TOO_TECHNICAL`.** The
  drafted capability claim `"Cli: Workspace package \"@rvs/cli\"
  (package.json) with 27 scanned files."` and the drafted outcome claim for
  the "General automation" pillar both matched
  `TECHNICAL_TOKEN_PATTERN` on the literal package path `@rvs/cli` — the
  claim-control engine correctly refused to let a package-manifest string
  leak into executive-facing prose, exactly the class of defect §10's
  "must never inflate maturity, invent adoption, or promote unfinished
  capabilities" mandate exists to prevent (a technical implementation
  detail masquerading as a customer-facing claim).
- **The `maturity` claim is the only claim with zero evidence ids**, per
  the documented exception in `classifyDraft()` — it is a structural count
  over `CapabilityModel` (16 evaluated, 0 included, 2 qualified), not a
  citation-backed assertion, and is still `approved` despite having no
  `evidenceIds`.
- The showcase's own maturity claim text — "0 of 16 evaluated capabilities
  are currently included" — is itself the strongest proof the anti-inflation
  mandate holds: a repository with almost no included capabilities gets an
  honest, unflattering showcase, not a polished one.
- `rvs validate --ci` confirms the rendered scenes (including the min-font-size
  fix documented below) pass all 28 deterministic checks — 0 failures, 0
  warnings, exit code 0.

### CSS defect found and fixed during this proof

The first real `rvs validate --ci` run against the rendered showcase scenes
failed 2 of 28 checks with `min-font-size` violations:
`showcase:scene:showcase-value-pillars:4` at 13.0px (`.showcase-pillar-qualifier`)
and `showcase:scene:showcase-capabilities:5` at 11.0px (`.showcase-chip-badge`),
both below the validator's 14px minimum. Neither unit tests nor the
TypeScript build could have caught this — it only surfaces in real rendered
HTML, the same class of defect `docs/capability-intelligence.md`'s own
"Closure-condition remediation" section documents for Milestone 4. Fixed by
raising both selectors in `packages/renderer-html/src/styles.ts` to
`font-size: 14px`. Re-running the full pipeline afterward produced the clean
28/28 result reported above.

## Known limitations

- Claim control's technical-token detection is a generic regex
  (`TECHNICAL_TOKEN_PATTERN`), not a repository-specific denylist; a
  legitimate product term that happens to look like a package path or
  camelCase identifier (e.g. a real product feature literally named that
  way) will also be rejected as `SHOWCASE_CLAIM_TOO_TECHNICAL`. This is the
  intended conservative bias — false rejections are preferred over false
  approvals of leaked implementation detail — and is why every rejected
  claim stays inspectable via `rvs showcase explain`.
- A repository whose `ProductIdentityModel` has `archetype: "unknown"` still
  produces a full showcase — the identity/hero scenes fall back to the
  generic `descriptor` ("Software platform") rather than blocking showcase
  generation entirely, consistent with the identity layer's own conservative
  fallback rather than treating `"unknown"` as an error state.
- `SHOWCASE_CLAIM_UNQUALIFIED_PARTIAL` and `SHOWCASE_CLAIM_RUNTIME_UNVERIFIED`
  are declared in `ShowcaseClaimRejectionReasonCode` but not emitted by
  `classifyDraft()`. Both codes are rejection reasons, and `ProductClaim.
  rejectionReasons` is only populated when `status === "rejected"` — but the
  states these two codes describe (a qualified-capability claim, an
  override-sourced runtime claim) are deliberately *not* rejections in this
  design; they resolve to the separate statuses
  `"approved_with_qualification"` / `"runtime_verification_required"` instead,
  communicated via `ProductClaim.status` and `.qualifiers`, not via a
  rejection-reason code. Wiring these two codes would require broadening
  `rejectionReasons`'s semantic scope beyond "why a claim was rejected" —
  judged out of proportion to a validator-code-reachability fix; the
  information itself is not lost (`rvs showcase explain <claim-id>` already
  surfaces status + qualifiers for both cases).
- `SHOWCASE_FONT_BELOW_MINIMUM` and `SHOWCASE_LOW_CONTRAST` are declared in
  `ProductIntelWarningCode` but not emitted by `validateShowcasePlan()`. Both
  would require DOM-inspection logic (measuring rendered font size and
  computing WCAG contrast ratios) that already exists, at higher fidelity,
  in `@rvs/validator`'s generic `min-font-size`/`contrast` Playwright checks
  (`packages/validator/src/checks.ts`) — and `rvs validate --ci` already
  fails unconditionally on either check's failure
  (`packages/cli/src/commands/validate.ts`), independent of any
  `config.quality` flag, for every scene type including showcase scenes.
  Duplicating that logic inside `@rvs/product-intelligence`'s pure,
  DOM-free `validation.ts` would add real implementation complexity (a
  second rendering/measurement pipeline) without adding coverage beyond
  what already blocks CI. See the CSS defect fix above for a real example of
  this exact class of failure being caught by the existing generic checks.

## Package summary

Same package as Product Identity Intelligence:
`packages/product-intelligence` (`@rvs/product-intelligence`). The showcase
scene types, visual metaphors, and CSS live in `@rvs/renderer-html`; the new
"showcase" `VisualDoc` profile assembly lives in `@rvs/narrative-planner`.
No external model call anywhere in either package.
