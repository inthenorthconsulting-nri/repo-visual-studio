# Intelligence routing

RVS has four intelligence layers, each built strictly on evidence from the
layer(s) below it, plus a fifth layer — Governance Intelligence — built on
top of cached snapshots of the other four rather than on repository
evidence directly, plus a sixth layer — Architecture Decision Intelligence
— built directly from decision documents already present in the
repository (never from the other five layers' artifacts as its primary
input, though it optionally links against them), plus a seventh layer —
Knowledge Graph — built by unifying whichever of the six layers above are
already cached into one queryable graph, and layering impact analysis,
root-cause grouping, decision-invalidation analysis, and change planning on
top of it. Never skip a required layer, and never run a layer the task
doesn't need — see `MASTER_AGENT.md` §2-§3 for the authoritative routing
table and matrix; this file expands the reuse/regeneration rule those
sections point to.

## The four layers, in dependency order

1. **Architecture Intelligence** (`architecture-intelligence.md`) — built
   from `repository-model.json` + `evidence-manifest.json` (the Milestone 1
   scan) plus workflow/Terraform graphs. Produces
   `architecture-intelligence.json`: identity, capability domains, workflow
   families, responsibilities, flows/boundaries.
2. **Capability Intelligence** (`capability-intelligence.md`) — built from
   `architecture-intelligence.json`. Produces `capability-model.json`: one
   evidence-scored entry per capability, with an inclusion/exclusion
   decision and a readiness tier.
3. **Product Intelligence** (`product-intelligence.md`) — built from
   `capability-model.json` + `architecture-intelligence.json`. Produces
   `product-identity-model.json` (archetype, value pillars,
   differentiators) and, downstream of that, an `ExecutiveNarrative` and
   `ShowcasePlan` under claim control.
4. **Portfolio Intelligence** (`portfolio-intelligence.md`) — built from
   *multiple products'* already-generated `capability-model.json` +
   `product-identity.json` pairs, listed in `.rvs/portfolio.yml`. Produces
   `portfolio-model.json`, portfolio claims, portfolio decisions, and a
   `PortfolioPlan`.
5. **Governance Intelligence** (`docs/architecture-governance.md`,
   `docs/continuous-intelligence.md` — no dedicated skill reference file
   yet) — built from an `IntelligenceSnapshot` (`rvs snapshot create`) of
   whichever of the four layers above are already cached, never from
   repository source directly and never from an external model. Produces
   change sets, a conservative blast-radius assessment, policy findings,
   and a `ContinuousIntelligenceReport` (`rvs governance
   compare`/`check`/`explain`).
6. **Architecture Decision Intelligence** (`docs/architecture-decision-intelligence.md`
   and its 6 companion documents; skill references:
   `references/architecture-decision-intelligence.md`,
   `references/decision-discovery.md`, `references/decision-linking.md`,
   `references/decision-governance.md`, `references/decision-drift.md`,
   `references/decision-showcase.md`) — built from ADR/RFC/design-decision/
   decision-log documents discovered under the paths named in
   `.rvs/decisions.yml` (`rvs decisions analyze`), never from the other five
   layers' cached artifacts as its primary input. Optionally *links* against
   Architecture/Capability/Product/Portfolio/Governance artifacts when they
   are already cached (an unresolved link is kept and reported, never
   dropped, when they aren't). Produces a `DecisionSnapshot`, decision
   links/dependencies/supersession, drift and debt findings, a
   `DecisionIntelligenceReport`, and — additively, opt-in, **not yet wired
   into `rvs governance compare`/`check`** — 10 decision-aware policy rule
   kinds on top of Governance Intelligence's own engine.
7. **Knowledge Graph** (`docs/architecture-knowledge-graph.md` and its 5
   companion documents; skill references:
   `references/architecture-knowledge-graph.md`,
   `references/graph-construction.md`,
   `references/graph-impact-analysis.md`, `references/graph-root-cause.md`,
   `references/graph-decision-impact.md`,
   `references/graph-change-planning.md`, `references/graph-showcase.md`) —
   built from whichever of the six layers above are already cached
   (`rvs graph build`), never from repository source directly and never
   from an external model; a missing upstream artifact is treated as
   `unresolved`, kept and reported, never dropped or assumed. Produces a
   `KnowledgeGraphSnapshot` of nodes and edges, impact-analysis and
   blast-radius results, root-cause groups, decision-invalidation results,
   and removal-only change plans (`rvs graph impact/path/roots/compare/
   plan-change/explain`).

A layer's synthesis command refuses to run without its required upstream
cache file present — this is enforced by the CLI, not just documented here.
Architecture Decision Intelligence and Knowledge Graph are the two
exceptions: `rvs decisions analyze` only requires `.rvs/decisions.yml` to
name at least one decision source, and `rvs graph build` reads all six
upstream artifacts as optional — neither requires any of the other layers'
artifacts to exist to run, though both produce a more complete result when
more of them are already cached.

## When each layer is needed

| Task | Layers needed |
|---|---|
| "What does this repo do / how is it structured" | Architecture only |
| "What capabilities exist / are partial / gaps" | Architecture → Capability |
| "Product overview / executive deck / differentiation" | Architecture → Capability → Product |
| "Compare products / portfolio overlaps / ecosystem deck" | Portfolio (consuming each product's already-generated Architecture/Capability/Product artifacts) |
| "What changed architecturally / is this a CI-blocking regression / explain a finding" | Governance Intelligence, consuming cached snapshots of whichever of the four layers above are needed — never a fresh scan |
| "What decisions explain this / which accepted decisions aren't implemented / did this violate a decision" | Architecture Decision Intelligence, optionally consuming whichever of the four layers above (plus Governance) are already cached for link resolution — never a fresh scan of those layers |
| "What is affected if this component changes / gets removed" / "what's the blast radius" / "why did these governance findings appear together" / "what decisions depend on this capability" | Knowledge Graph, consuming whichever of the six layers above are already cached (`rvs graph build`, then `impact`/`roots`/`path`/`plan-change`/`explain`) — never a fresh scan or re-synthesis of those layers |
| Ordinary code implementation, bug fix, CI failure | None, unless repository orientation is itself materially needed |

## Governance baseline changes are their own authorization boundary

Comparing against, checking against, or explaining a finding from the
configured governance baseline never authorizes replacing it —
`rvs governance baseline set` is a distinct write action requiring its own
explicit, current-turn authorization. Full rule: `MASTER_AGENT.md` §1.3,
§2.10.

## Reuse vs. regenerate

Prefer reusing an existing cache artifact. Regenerate only the specific
artifact that fails freshness — never the whole stack — when it is: missing,
stale relative to the relevant commit, on an incompatible schema version,
identity-mismatched to the repository, missing required evidence, or the
user has explicitly asked for a fresh scan. Full rule: `MASTER_AGENT.md`
§4.

For a portfolio task specifically: validate each listed product's artifact
pair against `.rvs/portfolio.yml`'s compatibility gate
(`docs/portfolio-intelligence.md#intake-and-compatibility-gate`) before
assuming regeneration is needed — most portfolio tasks touch zero upstream
product repositories.

## Claim control applies past Capability Intelligence

Any layer that produces an executive-facing statement (Product Intelligence's
`ExecutiveNarrative`/`ShowcasePlan`, Portfolio Intelligence's portfolio
claims) routes every claim through claim control before it can appear in a
deck: approved / qualified-with-evidence / rejected-with-reason. Never
present a claim that skipped this gate. Full mechanics:
`docs/executive-showcase-intelligence.md#claim-control` and
`docs/portfolio-intelligence.md#claims-and-claim-control`.
