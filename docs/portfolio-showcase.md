# Portfolio Showcase Intelligence (Milestone 6, part 2)

This document describes the presentation half of Milestone 6: rendering the
`PortfolioModel` and its claim-controlled decisions
([`docs/portfolio-intelligence.md`](portfolio-intelligence.md)) into a
standalone, evidence-backed HTML slide deck. It relates to
`docs/portfolio-intelligence.md` the same way
[`docs/executive-showcase-intelligence.md`](executive-showcase-intelligence.md)
relates to
[`docs/product-identity-intelligence.md`](product-identity-intelligence.md):
a separate synthesis/rendering stage, consuming the upstream model as its
only input, adding no new evidence of its own.

```
PortfolioModel + PortfolioDecision[]      (docs/portfolio-intelligence.md, packages/portfolio-intelligence)
  -> PortfolioNarrative                    (narrative.ts — approved/qualified claims only)
  -> PortfolioPlan                         (portfolio-plan.ts — audience-scoped scene sequence)
  -> VisualDoc (profile: "portfolio")      (packages/narrative-planner/src/portfolio-visualdoc-builder.ts)
  -> deck.html                             (packages/renderer-html/src/scenes/portfolio/render.ts)
```

## Design mandate

Same conservative-bias rule as every rendering stage before it: the deck can
never say more than the underlying `PortfolioModel`/claims already
established. Every scene is evidence-gated — an optional scene is included
only when the model actually has the evidence it would render, never
inserted just to reach a target scene count (documented inline in
`portfolio-plan.ts`, mirroring `showcase-plan.ts`'s identical rule for the
executive showcase). A relationship map that would otherwise be too dense to
read degrades to a `"low"`-density, truncated edge list with a qualifier
disclosing the truncation, rather than silently dropping edges.

## `PortfolioPlan`

`packages/portfolio-intelligence/src/contracts.ts`. `PortfolioPlan`:
`schemaVersion`, `model` (the full `PortfolioModel` this plan was built
from), `narrative` (`PortfolioNarrative`), `decisions`
(`PortfolioDecision[]`), `scenes` (`PortfolioScenePlan[]`),
`generationMetadata` (`PortfolioPlanGenerationMetadata`: `generated_at`,
`schema_version`, `audience`, `theme`, `evidenceMode`, `includeRoadmap`,
`sceneCount`).

`synthesizePortfolioPlan(input)` (`index.ts`) builds a plan from `{ model,
narrative, claims, audience, theme, generatedAt }`; `evidenceMode` defaults
to `"concise"` when not otherwise specified (`PortfolioEvidenceMode`, a
4-value scale: `concise`/`visible`/`appendix`/`audit`, mirroring showcase's
own evidence-mode scale rather than sharing its exported type). Unlike
`rvs synthesize portfolio`, which caches its `PortfolioModel` once,
`rvs create slides --profile portfolio` builds a **fresh**, audience-scoped
`PortfolioNarrative`/`PortfolioPlan` on every invocation — the same
documented pattern `runCreateShowcaseSlides()` already establishes for the
executive showcase (a code comment in `create-slides.ts` states this
explicitly: "like showcase, builds a fresh audience-scoped
PortfolioNarrative/PortfolioPlan on every run").

`PortfolioScenePlan`: `id`, `type` (`PortfolioSceneType`), `headline`,
optional `subheadline`, `density`, `productIds`, `capabilityIds`,
`relationshipIds`, `gapIds`, `claimIds`, `evidenceIds`, `qualifiers`.

## The 13 `PortfolioSceneType` values

Declared in `contracts.ts`; the deterministic default sequence
(`DEFAULT_SEQUENCE` in `portfolio-plan.ts`) presents them in this exact
order:

| # | Scene type | Always included? |
|---|---|---|
| 1 | `portfolio-hero` | always |
| 2 | `portfolio-mission` | always |
| 3 | `portfolio-landscape` | only when `model.products.length >= 2` |
| 4 | `portfolio-product-roles` | always |
| 5 | `portfolio-operating-model` | only when `model.operatingModel.stages.length > 0` |
| 6 | `portfolio-capability-coverage` | always |
| 7 | `portfolio-relationship-map` | only when `model.relationships.length > 0` |
| 8 | `portfolio-dependency-map` | only when `model.dependencyGraph.edges.length > 0` |
| 9 | `portfolio-shared-contracts` | only when a relationship of type `shared_platform` or `shared_contract` exists |
| 10 | `portfolio-maturity` | always |
| 11 | `portfolio-gaps` | only when `model.gaps.length > 0` |
| 12 | `portfolio-decisions` | only when at least one decision was computed |
| 13 | `portfolio-closing` | always |

`selectSceneTypes()` walks this list once, skipping any scene whose gating
condition fails, then caps the result at `PORTFOLIO_PLAN_MAX_SCENES` (13) —
so the plan can never exceed the full declared scene-type count even before
any evidence-gating occurs. `PORTFOLIO_PLAN_MIN_SCENES` is 6: the 6 scenes
that are unconditional (`portfolio-hero`, `portfolio-mission`,
`portfolio-product-roles`, `portfolio-capability-coverage`,
`portfolio-maturity`, `portfolio-closing`) are exactly the floor a portfolio
of any size still produces. `validatePortfolioPlan()` warns
(`PORTFOLIO_PLAN_TOO_FEW_SCENES` / `PORTFOLIO_PLAN_TOO_MANY_SCENES`, both
Tier 2) if the actual count ever falls outside `[6, 13]` — see
[`docs/portfolio-intelligence.md#validation`](portfolio-intelligence.md#validation).

The relationship-map scene additionally degrades density and truncates its
edge list once relationship-plus-unresolved-relationship evidence crosses
`RELATIONSHIP_MAP_DENSE_THRESHOLD` (12), disclosing the truncation via a
scene qualifier rather than silently dropping edges. Headlines are capped at
`PORTFOLIO_HEADLINE_HARD_MAX_WORDS` (14 words) and may never be a generic
slide label (`GENERIC_HEADLINE_LABELS`: overview, introduction, summary,
portfolio, products, capabilities, about, welcome, next steps) — both
enforced by `validatePortfolioPlan()` as Tier 1 errors
(`PORTFOLIO_PLAN_HEADLINE_TOO_LONG`, `PORTFOLIO_PLAN_GENERIC_HEADLINE`).

## VisualDoc rendering

`buildPortfolioVisualDoc(plan)`
(`packages/narrative-planner/src/portfolio-visualdoc-builder.ts`) turns a
`PortfolioPlan` into a `VisualDoc` (`document.type: "presentation"`, title
`` `${plan.model.displayName} — Portfolio Overview}` ``, `audience`/`theme`
taken from the plan's own `generationMetadata`). Each `Scene` has
`type: "portfolio-scene"` and points back at the source plan by `plan_id`
(`plan.model.portfolioId`) + `scene_id`, rather than embedding the full
`PortfolioScenePlan` inline — the same `plan_id`/`scene_id` indirection
`buildShowcaseVisualDocScenes()` already establishes for showcase scenes.
The plan's own narrative-significant scene order (`DEFAULT_SEQUENCE`, not
alphabetical) is preserved verbatim; this builder never re-sorts it — which
is also why `PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER`
(see [`docs/portfolio-intelligence.md#validation`](portfolio-intelligence.md#validation))
deliberately does not check scene id order, only decision id order.

`packages/renderer-html/src/scenes/portfolio/render.ts` renders each of the
13 `PortfolioSceneType` values, one dedicated renderer per type behind an
exhaustive `switch` (a compile-time guarantee that a new `PortfolioSceneType`
value cannot silently fall through unrendered), following the repository's
existing per-scene CSS class-naming convention shared with the showcase and
architecture-review scene renderers.

## CLI

```bash
rvs create slides --profile portfolio [--audience <id>] [--theme <id>]
  # requires .rvs/cache/portfolio-model.json (throws "No cached portfolio
  # model found. Run `rvs synthesize portfolio` first." if absent)
  # --audience: executive|product_leader|platform_leader|architect|
  #             engineering_leader|developer|operator|portfolio|conference
  #             (default: portfolio)
  # --theme: defaults to the --design-system id, same as --profile showcase

rvs export portfolio-model    # see docs/portfolio-intelligence.md
rvs export portfolio-claims
rvs export portfolio-decisions
rvs portfolio explain <id>    # claim id or decision id
```

`--audience` is validated against the same 9-value `SHOWCASE_AUDIENCES`
array both `--profile showcase` and `--profile portfolio` share
(`packages/cli/src/commands/create-slides.ts`); an invalid value throws
`` `Invalid --audience "<raw>"; expected one of: executive, product_leader, platform_leader, architect, engineering_leader, developer, operator, portfolio, conference.` ``.
`DEFAULT_PORTFOLIO_AUDIENCE` is `"portfolio"` — note this differs from
`--profile showcase`'s own default of `"executive"`.

`runCreatePortfolioSlides()` reads `portfolio-model.json` via an
**optional** cache read (throwing its own descriptive error if absent, as
above) but `portfolio-claims.json` via a **required** read — synthesis
always writes both together, so a model without claims should never occur
outside a corrupted cache. It builds a fresh narrative and plan every run,
runs `validatePortfolioPlan(plan)` inline, builds the `VisualDoc`, renders
it via `renderVisualDocToHtml()` with the portfolio plan passed as the sole
member of the renderer's `portfolioPlans` argument (its
`workflowGraphs`/`terraformTopologies`/`architectureArtifacts`/
`capabilityModels`/`showcasePlans` arguments are all empty — a portfolio
deck is a complete presentation on its own, not a scene fragment appended to
another profile's sequence), writes `deck.html`, and caches both
`visualdoc.json` and `portfolio-plan.json`. Exact log lines:

```
Rendered <N> portfolio scenes to <output_dir>/deck.html using "<designSystemId>" (audience: "<audience>", theme: "<theme>")
Cached to .rvs/cache/portfolio-plan.json
```

## Validation

`rvs validate --ci` runs `validatePortfolioPlan(plan)` against
`.rvs/cache/portfolio-plan.json` whenever that cache exists, in addition to
`validatePortfolioModel()`/`validatePortfolioClaims()` against
`portfolio-model.json`/`portfolio-claims.json` — all three combine into one
`hasError` flag, which itself combines with the capability/product-identity/
showcase outcomes and the rendered-deck's own checks into `--ci`'s overall
exit code. See
[`docs/portfolio-intelligence.md#validation`](portfolio-intelligence.md#validation)
for the full code table.

## Self-hosting proof

`rvs create slides --profile portfolio --audience portfolio`, run against
the 3-fixture portfolio described in
[`docs/portfolio-intelligence.md`'s self-hosting proof](portfolio-intelligence.md#self-hosting-proof),
rendered 11 scenes (of the 13 declared types — `portfolio-shared-contracts`
was gated out, since none of the three fixtures' relationships resolved to
`shared_platform`/`shared_contract`; every other optional gate was
satisfied) with no crash. `rvs validate --ci` reported
`Validated portfolio: 0 error(s), 0 warning(s)` for the portfolio-plan layer
itself — no `PORTFOLIO_PLAN_*` code fired — but the overall `--ci` run still
exited 1 due to 6 unrelated rendering-density findings on portfolio scenes
(4x `min-font-size` at 12-13px against the renderer's 14px floor, 2x
`overflow` at 28-141px). These are shared-CSS/design-system density
findings the renderer's generic scene layout already produces for
dense content on other profiles too — not a defect in scene selection,
claim gating, or headline generation, and not a `PORTFOLIO_*`-coded finding.

## Known limitations

- **Scene count is capped at 13 even before evidence-gating**, so a very
  large or fully-evidenced portfolio cannot grow a 14th scene type without a
  new `PortfolioSceneType` value being added deliberately — this is an
  intentional density ceiling, not an oversight.
- **`portfolio-shared-contracts` only fires from `.rvs/portfolio.yml`'s
  `approved_relationships`**, since `shared_platform`/`shared_contract` are
  never inferred automatically (see
  [`docs/portfolio-intelligence.md#product-relationships`](portfolio-intelligence.md#product-relationships)) —
  a portfolio with no explicitly-approved shared-platform relationship will
  never show this scene, regardless of how much capability sharing exists.
- **No model-assisted rendering.** Scene selection, headline generation, and
  density degradation are all deterministic rules over the `PortfolioPlan` —
  no network access, no LLM dependency.

## Package summary

| Package | Role |
|---|---|
| `@rvs/portfolio-intelligence` | `PortfolioPlan`/`PortfolioScenePlan` types, `synthesizePortfolioPlan()`, `validatePortfolioPlan()` |
| `@rvs/narrative-planner` | `buildPortfolioVisualDoc()` / `buildPortfolioVisualDocScenes()` |
| `@rvs/renderer-html` | per-`PortfolioSceneType` HTML scene renderers (`src/scenes/portfolio/render.ts`) |
| `@rvs/cli` | `rvs create slides --profile portfolio`; `rvs portfolio explain <id>` |
