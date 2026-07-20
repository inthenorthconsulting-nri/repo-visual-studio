# Authoring Governance Policies (Milestone 7)

This document is a policy-authoring guide for `.rvs/policies/*.yml` files,
centered on a mapping table from worked-example governance scenarios to the
real rule kind + condition configuration that expresses them. See
[docs/continuous-intelligence.md](continuous-intelligence.md) for the
policy file's overall Zod schema, the exceptions mechanism, and how
findings/severity/`--ci` fit together; this document goes one level deeper
on each of the 11 `GovernanceRuleKind` evaluators (`policy-evaluator.ts`)
and how to configure each one for a real scenario.

Every rule kind is a closed, finite literal — there is no general
expression language, and a policy file cannot invent a 12th kind. Two
consequences worth internalizing before authoring a policy:

- **A rule's `condition.kind` must match its own `kind`** (enforced by
  `PolicyFileSchema`'s `superRefine`) — the condition shape is a
  discriminated union, not a free-form object.
- **Several rule kinds can only check what the underlying `GovernanceChangeEntry`
  actually carries**, not what the scenario name might suggest is possible.
  Where a rule kind's real check is narrower than its name implies (e.g.
  `forbid_component_removal`'s `component_type` field being present in the
  schema but ignored by the evaluator), that gap is called out explicitly
  in the table below — never silently assumed away.

## Worked-example mapping table

Each row is a distinct, real scenario, with the exact rule `kind` and
`condition` that expresses it. Multiple rows per kind show the different
ways that one evaluator can be configured.

| # | Scenario | Rule kind | Condition (YAML) | Notes |
|---|---|---|---|---|
| 1 | Protect an entire component family from removal | `forbid_component_removal` | `component_id_pattern: "^payments-.*"` | `component_type` is accepted by the schema but **ignored** by the evaluator — `GovernanceChangeEntry` carries no component-kind field to check it against. Scope only ever narrows by id pattern. |
| 2 | Protect one named critical component from removal | `forbid_component_removal` | `component_id_pattern: "^auth-gateway$"` | Same evaluator, narrower pattern. `fail` if the matching component's change `type === "removed"`; `unverifiable` if `"unresolved"`. |
| 3 | Require every entry point to survive | `require_runtime_entrypoint` | `entrypoint_id_pattern:` *(omitted)* | Omitted pattern matches every `.implementation.entryPoints`-scoped change; `fail` only on removal. |
| 4 | Protect one public API's entry point specifically | `require_runtime_entrypoint` | `entrypoint_id_pattern: ".*:entrypoint:public-api.*"` | Matched against `domain_path` values shaped `components.<componentId>.implementation.entryPoints`. |
| 5 | Capabilities must stay at least "included" (strictest floor) | `require_capability_status_at_least` | `minimum_status: includedCapabilities` | `minimum_status` is one of the 6 **bucket** names (`CAPABILITY_BUCKET_RANK` keys), not a raw `CapabilityStatus` literal — the evaluator compares bucket rank via `domain_path`, since bucket (not status) is what a `GovernanceChangeEntry` directly carries. |
| 6 | Capabilities may drop to "qualified" but no further (verification-requirement-adjacent) | `require_capability_status_at_least` | `minimum_status: qualifiedCapabilities` | A capability moving from `includedCapabilities` to `qualifiedCapabilities` passes; a further drop to `roadmapCapabilities` fails. |
| 7 | Roadmap-promotion protection: capabilities must not fall out of the roadmap entirely | `require_capability_status_at_least` | `minimum_status: roadmapCapabilities` | The most permissive floor of the three — only a drop to `gapCapabilities`/`excludedCandidates`/`unresolvedCapabilities` (or removal) fails. |
| 8 | Block any operational-to-planned-shaped capability regression, repo-wide | `forbid_operational_to_planned_regression` | `capability_id_pattern:` *(omitted)* | Judgment call: the evaluator cannot distinguish specifically "operational -> planned" from other regressions without parsing free-text `detail`, so **any** `type === "reclassified"` capability change matching the pattern is treated as a violation. |
| 9 | Block operational-to-planned-shaped regression within one capability family | `forbid_operational_to_planned_regression` | `capability_id_pattern: "^billing-.*"` | Same evaluator, scoped. |
| 10 | Deployment-evidence protection: architecture changes must cite architecture evidence | `require_evidence_type` | `required_evidence_source: architecture` | The one cross-domain evaluator — scans architecture + capability + product + portfolio changes together; `fail` if a non-`unchanged` matching entry has no `evidence_ref` with that `source_artifact`. |
| 11 | Verification-requirement enforcement: capability changes must cite capability evidence | `require_evidence_type` | `entity_id_pattern: "^cap:.*"`<br>`required_evidence_source: capability` | Same evaluator, scoped by `entity_id_pattern` (matched against `entity_id`, domain-agnostic). |
| 12 | Cross-product changes must cite portfolio-sourced evidence | `require_evidence_type` | `required_evidence_source: portfolio` | Same evaluator; useful paired with rule 15/16 below when a dependency's shared-contract linkage is itself unverifiable. |
| 13 | Dependency-removal protection, repo-wide | `forbid_dependency_removal` | `dependency_id_pattern:` *(omitted)* | Scope = architecture changes with `domain_path === "dependencies"`; `fail` on removal. |
| 14 | Dependency-removal protection, scoped to external dependencies only | `forbid_dependency_removal` | `dependency_id_pattern: "^external-.*"` | Same evaluator, narrower pattern. |
| 15 | Shared-contract-for-dependency requirement, repo-wide | `require_shared_contract_for_dependency` | `dependency_id_pattern:` *(omitted)* | Judgment call: no id linkage exists between architecture dependencies and portfolio relationships, so this is a **proxy** check — `fail` only if the flagged dependency's own `evidence_refs` include no `source_artifact === "portfolio"` ref. `not_applicable` if no portfolio changeset ran at all and scope is empty. |
| 16 | Shared-contract-for-dependency requirement, scoped | `require_shared_contract_for_dependency` | `dependency_id_pattern: "^payments-.*"` | Same proxy evaluator, narrower pattern. |
| 17 | Approved-claim-without-lineage protection, repo-wide | `forbid_approved_claim_without_lineage` | `claim_id_pattern:` *(omitted)* | Judgment call: `ProductChangeSet` never diffs "claims" as such (those live on `ExecutiveNarrative`/`ShowcasePlan`, outside snapshot scope); the checked scope is instead the two claim-bearing domain paths, `identity.valuePillars` and `identity.differentiators`. "Approved" status has no home on a `GovernanceChangeEntry`, so it is not itself checked — only `lineage`. |
| 18 | Approved-claim-without-lineage protection, scoped to differentiators only | `forbid_approved_claim_without_lineage` | `claim_id_pattern: "^differentiator-.*"` | Same evaluator, narrower id pattern (still only ever scoped to the 2 claim-bearing domain paths above). |
| 19 | Product-role requirement (presence-only) | `require_product_role` | `required_role: "core"` | Can only verify **presence** of the named product across the comparison, not the specific role value — `portfolio-diff.ts` diffs each product entry as an opaque `sameValue` comparison, so `required_role` is recorded but not itself matched against anything. `fail` only if `type === "removed"`. |
| 20 | Product-role requirement, scoped to one product id pattern | `require_product_role` | `product_id_pattern: "^governance-.*"`<br>`required_role: "governance_system"` | Same presence-only evaluator, scoped. `not_applicable` if no portfolio changeset ran at all. |
| 21 | Unresolved-relationship limit: zero tolerance | `limit_unresolved_relationships` | `max_unresolved: 0` | Count-based whole-rule aggregate (not per-entity): counts portfolio changes with `domain_path === "unresolvedRelationships"` and `type !== "removed"`; `fail` once the count exceeds the configured max. |
| 22 | Unresolved-relationship limit: tolerate a small backlog | `limit_unresolved_relationships` | `max_unresolved: 3` | Same evaluator, looser threshold — useful while a portfolio is still being normalized. |
| 23 | Snapshot-compatibility requirement: require full compatibility | `require_compatible_snapshot` | `minimum_status: compatible` | Checks the top-level `ContinuousIntelligenceReport.compatibility` directly — never scans any change set. Fails on anything worse than `compatible`. |
| 24 | Snapshot-compatibility requirement: tolerate staleness warnings only | `require_compatible_snapshot` | `minimum_status: compatible_with_warnings` | Same evaluator, looser floor — passes `compatible`/`compatible_with_warnings`, fails `partial`/`incompatible`. |

## A full real policy file exercising most of the 11 kinds

```yaml
schema_version: 1
id: repository-governance-baseline
name: "Repository governance baseline"
rules:
  - id: no-removing-payment-components
    title: "Payment components must not be removed"
    description: "Blocks removal of any component whose id starts with payments-."
    kind: forbid_component_removal
    condition:
      kind: forbid_component_removal
      component_id_pattern: "^payments-.*"
    severity: blocking
    enabled: true

  - id: public-api-entrypoints-required
    title: "Public API entry points must remain"
    description: "Blocks removal of any entry point matching the public-api naming convention."
    kind: require_runtime_entrypoint
    condition:
      kind: require_runtime_entrypoint
      entrypoint_id_pattern: ".*:entrypoint:public-api.*"
    severity: blocking
    enabled: true

  - id: capabilities-stay-qualified-or-better
    title: "Capabilities must not regress below qualified"
    description: "Fails if a capability drops out of includedCapabilities/qualifiedCapabilities."
    kind: require_capability_status_at_least
    condition:
      kind: require_capability_status_at_least
      minimum_status: qualifiedCapabilities
    severity: review_required
    enabled: true

  - id: no-operational-to-planned-regressions
    title: "Operational-shaped capabilities must not regress toward planned"
    description: "Flags any reclassified capability change as a potential regression for review."
    kind: forbid_operational_to_planned_regression
    condition:
      kind: forbid_operational_to_planned_regression
    severity: advisory
    enabled: true

  - id: architecture-changes-need-architecture-evidence
    title: "Architecture changes must cite architecture evidence"
    description: "Fails architecture changes with no architecture-sourced evidence ref."
    kind: require_evidence_type
    condition:
      kind: require_evidence_type
      required_evidence_source: architecture
    severity: advisory
    enabled: true

  - id: no-removing-dependencies
    title: "Architecture dependencies must not be removed"
    description: "Blocks silent removal of any tracked dependency."
    kind: forbid_dependency_removal
    condition:
      kind: forbid_dependency_removal
    severity: blocking
    enabled: true

  - id: dependencies-need-shared-contract
    title: "Cross-product dependencies need a shared contract on record"
    description: "Flags architecture dependencies with no portfolio-sourced evidence (proxy check)."
    kind: require_shared_contract_for_dependency
    condition:
      kind: require_shared_contract_for_dependency
    severity: advisory
    enabled: true

  - id: differentiators-need-lineage
    title: "Product differentiators must keep evidence lineage"
    description: "Fails when a value pillar or differentiator's evidence lineage is broken."
    kind: forbid_approved_claim_without_lineage
    condition:
      kind: forbid_approved_claim_without_lineage
    severity: review_required
    enabled: true

  - id: core-product-role-required
    title: "The core product must remain present in the portfolio"
    description: "Fails if the core product is removed from the portfolio."
    kind: require_product_role
    condition:
      kind: require_product_role
      product_id_pattern: "^core-.*"
      required_role: "core"
    severity: blocking
    enabled: true

  - id: unresolved-relationships-capped
    title: "Unresolved portfolio relationships must stay under 3"
    description: "Fails once the unresolved-relationship count exceeds 3."
    kind: limit_unresolved_relationships
    condition:
      kind: limit_unresolved_relationships
      max_unresolved: 3
    severity: advisory
    enabled: true

  - id: snapshots-must-stay-compatible
    title: "Compared snapshots must remain fully compatible"
    description: "Fails if the two compared snapshots are anything less than fully compatible."
    kind: require_compatible_snapshot
    condition:
      kind: require_compatible_snapshot
      minimum_status: compatible
    severity: blocking
    enabled: true

exceptions:
  - rule_id: no-removing-payment-components
    scope: "payments-legacy-adapter"
    reason: "Component is being decommissioned per RFC-114; removal is intentional."
    approval_reference: "RFC-114, approved by @platform-lead"
    expiry: "2026-12-31T00:00:00.000Z"
```

This one file exercises 10 of the 11 kinds (`require_evidence_type` is used
once here, but see rows 10-12 above for its other two shapes); the 11th,
`require_capability_status_at_least`, appears once (rows 5-7 above show its
other two floors). A repository is free to split rules across multiple
files under `.rvs/policies/` — `governance.yml`'s `policies:` list accepts
any number of paths, and `loadPolicyFiles()` aggregates load failures
across all of them before throwing.

## Enabling and disabling rules

`enabled: false` makes a rule produce **zero** findings for that run — not
`not_applicable`, not `excepted`, simply skipped by `evaluatePolicy()`'s
`continue`. This is the correct way to stage a new policy: land it
disabled, verify its `condition` matches the intended entities via
`rvs governance explain <finding-id>` on a manual dry run, then flip it to
`enabled: true`.

See also: [docs/continuous-intelligence.md](continuous-intelligence.md) for
exceptions, findings, `--ci`, and the full `ContinuousIntelligenceReport`
shape; [docs/architecture-governance.md](architecture-governance.md) for
the change-set/blast-radius data every rule kind reads.
