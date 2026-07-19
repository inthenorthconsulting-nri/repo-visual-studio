# Intelligence routing

RVS has four intelligence layers, each built strictly on evidence from the
layer(s) below it. Never skip a required layer, and never run a layer the
task doesn't need — see `MASTER_AGENT.md` §2-§3 for the authoritative
routing table and matrix; this file expands the reuse/regeneration rule
those sections point to.

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

A layer's synthesis command refuses to run without its required upstream
cache file present — this is enforced by the CLI, not just documented here.

## When each layer is needed

| Task | Layers needed |
|---|---|
| "What does this repo do / how is it structured" | Architecture only |
| "What capabilities exist / are partial / gaps" | Architecture → Capability |
| "Product overview / executive deck / differentiation" | Architecture → Capability → Product |
| "Compare products / portfolio overlaps / ecosystem deck" | Portfolio (consuming each product's already-generated Architecture/Capability/Product artifacts) |
| Ordinary code implementation, bug fix, CI failure | None, unless repository orientation is itself materially needed |

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
