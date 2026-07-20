# Governance Showcase: the `governance` Presentation Profile (Milestone 7)

How a completed governance comparison (`rvs governance compare`) is
rendered to a slide deck: the `governance-scene` VisualDoc pointer type,
the `GovernancePlan.scenes[]` array it points into, the 13 canonical
`GovernanceSceneKind` values and when each is evidence-gated, and
`rvs create slides --profile governance`. This mirrors
[docs/portfolio-showcase.md](portfolio-showcase.md)'s structure for the
portfolio profile; see
[docs/architecture-governance.md](architecture-governance.md) and
[docs/continuous-intelligence.md](continuous-intelligence.md) for the data
these scenes present.

## The `governance-scene` pointer type

Like `showcase-scene` and `portfolio-scene` before it, a `governance-scene`
VisualDoc scene never embeds its own content. It is a pure pointer into a
separately cached `GovernancePlan`:

```ts
// packages/visualdoc-schema/src/schema.ts
export const GovernanceSceneSchema = BaseSceneSchema.extend({
  type: z.literal("governance-scene"),
  plan_id: z.string().min(1),
  scene_id: z.string().min(1),
});
```

`BaseSceneSchema` (shared by every scene type) additionally requires `id`
(non-empty string), `headline` (non-empty string), and `evidence` (an
array of `EvidenceRef`, defaulting to `[]`). `buildGovernanceVisualDocScenes()`
(`packages/narrative-planner/src/governance-visualdoc-builder.ts`) maps
each `GovernancePlan.scenes[]` entry to one `governance-scene`:

```ts
{
  id: scene.scene_id,
  type: "governance-scene",
  headline: scene.title,
  evidence: [],       // GovernanceSceneContent.evidence_refs is a different
                       // shape (EvidenceRef paths) from the EvidenceManifest
                       // claim ids this field expects -- left empty, matching
                       // buildPortfolioVisualDocScenes()'s identical precedent.
  plan_id: plan.id,
  scene_id: scene.scene_id,
}
```

`plan.id` is `governance:plan:<sanitized report id>` (`buildPlanId()`,
`ids.ts`). The renderer (`renderer-html`'s `scenes/governance/render.ts`)
resolves `plan_id`/`scene_id` back to the matching `GovernanceSceneContent`
in the cached `GovernancePlan` and switches on its `kind` to lay it out —
narrative-significant ordering and per-scene `data` stay entirely owned by
`@rvs/governance-intelligence`, never duplicated into the VisualDoc scene
itself. This is the same "avoid parallel rendering architecture" pattern
`PortfolioSceneSchema` established (spec §28).

## `GovernancePlan.scenes[]`

```ts
interface GovernanceSceneContent {
  scene_id: string;        // governance:scene:<report id>:<kind>
  kind: GovernanceSceneKind;
  title: string;
  data: Record<string, unknown>;  // one different projection per kind
  evidence_refs: EvidenceRef[];
}

interface GovernancePlan {
  schema_version: number;
  id: string;               // governance:plan:<report id>
  report: ContinuousIntelligenceReport;
  narrative: GovernanceNarrative;
  scenes: GovernanceSceneContent[];  // sorted by SCENE_KIND_ORDER, then scene_id
  evidence_refs: EvidenceRef[];
  generation: { generated_at: string };
}
```

`GovernanceGenerationMetadata` is deliberately minimal — just
`generated_at`. Unlike `PortfolioPlan`'s `generationMetadata`, there is no
`audience`/`theme` field here at all; see "No `--audience`/`--theme` for
this profile" below for why that matters at render time.

`buildGovernancePlan()` (`governance-plan.ts`) builds all 13 scene
candidates unconditionally, filters out every `undefined`, then sorts the
survivors by `SCENE_KIND_RANK` (index into the canonical order below) and
then `scene_id` as a tiebreak. `scene_id` itself is built by a small local
helper (`buildSceneId(reportId, kind)` -> ``governance:scene:<sanitized
report id>:<sanitized kind>``), intentionally duplicated from `ids.ts`'s
convention rather than widening that module's public surface for one call
site.

## The 13 scene kinds, in canonical order

`SCENE_KIND_ORDER` in `governance-plan.ts` is the single source of truth
for both the emitted order and the `GovernanceSceneKind` union's
declaration order in `contracts.ts`. The first 3 are unconditional — every
`GovernancePlan` has them, regardless of what the comparison found. The
remaining 10 are each independently evidence-gated: the builder returns
`undefined` (no scene emitted) rather than emitting an empty presentational
scene.

| # | Kind | Shows | Gated? | Omitted when |
|---|---|---|---|---|
| 1 | `governance-hero` | The comparison's headline: narrative summary, top-level `compatibility`, and total finding count. | No | Always present. |
| 2 | `snapshot-comparison` | Source/target snapshot ids, `compatibility`, and `repository_id`. | No | Always present. |
| 3 | `change-summary` | Non-`unchanged` change counts broken down by domain (architecture/capability/product, plus portfolio when present). | No | Always present. |
| 4 | `architecture-change-map` | Total architecture changes, counts by change type, and the sorted list of changed entity ids. | Yes | No architecture change has `type !== "unchanged"`. |
| 5 | `capability-regression` | Capability changes specifically of type `"reclassified"` or `"removed"` — a genuine regression signal, narrower than the generic change-summary. | Yes | No capability change is `"reclassified"` or `"removed"`. |
| 6 | `product-change` | Total product changes, counts by type, and changed entity ids. | Yes | No product change has `type !== "unchanged"`. |
| 7 | `portfolio-change` | Total portfolio changes, counts by type, and changed entity ids. | Yes | `report.portfolio_changes` is absent, **or** present but every change is `"unchanged"` (both checked — an empty-but-present portfolio changeset is gated the same as a missing one). |
| 8 | `evidence-regression` | Evidence changes whose type is not `"added"` (i.e. `"removed"`/`"unresolved"`), counted by type. | Yes | Every evidence change is `type === "added"` (nothing regressed). |
| 9 | `blast-radius` | Total blast-radius entries, counted by `level`. | Yes | `report.blast_radius.entries` is empty. |
| 10 | `policy-findings` | Total findings, counted by `severity` and by `result` (via `summarizeFindings()`). | Yes | `report.findings` is empty. |
| 11 | `exceptions` | Findings where `excepted === true`, listed by finding id. | Yes | No finding is excepted. |
| 12 | `decision-required` | Findings where `human_review_required === true` **and** `result !== "excepted"` — an already-excepted finding already received its human decision, so it is excluded here even if `human_review_required` is also true. | Yes | No finding both needs review and isn't already excepted. |
| 13 | `governance-validation` | Data-completeness/verifiability concerns about the report itself: overall `compatibility` and the count/ids of findings with `result === "unverifiable"`. | Yes | `report.compatibility === "compatible"` **and** no finding is `"unverifiable"` (both conditions must hold to omit it). |

Two gating details worth calling out precisely, since they are judgment
calls documented directly in the source comments:

- **`governance-validation`'s gate is on the report itself, not a re-run of
  `validateGovernancePlan()` against the plan being built** — that would be
  circular, since the plan doesn't exist yet while its own scenes are
  still being assembled. It is a narrower, source-data-only check.
- **`decision-required` explicitly excludes excepted findings** even when
  `human_review_required` is true on them, because an exception is itself
  a human decision already made — see
  [docs/continuous-intelligence.md](continuous-intelligence.md#exceptions).

Every gated scene's `evidence_refs` is built from exactly the entries that
justified showing it (deduped + sorted via `dedupeEvidenceRefs`/
`sortEvidenceRefs`) — e.g. `capability-regression`'s `evidence_refs` comes
only from the regressed changes' own refs, not the full capability
changeset. `governance-validation` is the one exception: when there are no
unverifiable findings (only a non-`"compatible"` top-level status), its
`evidence_refs` falls back to the whole report's `evidence_refs`, since
there is no narrower finding-level evidence to point at.

## `rvs create slides --profile governance`

```bash
rvs governance compare            # writes .rvs/cache/governance/governance-plan.json, among other outputs
rvs create slides --profile governance
```

`--profile governance` is one of the 9 recognized `--profile` values
(`repository-inventory|executive-overview|architecture-review|
engineering-onboarding|operating-review|repository-audit|showcase|
portfolio|governance`). Unlike `showcase`/`portfolio`, the governance
profile never synthesizes anything fresh at render time — it reads the
already-cached `GovernancePlan` directly:

```ts
// packages/cli/src/commands/create-slides.ts, runCreateGovernanceSlides
const plan = readGovernanceCachedJsonOptional<GovernancePlan>(repoRoot, GOVERNANCE_OUTPUT_FILES.governancePlan);
if (!plan) {
  throw new Error("No cached governance plan found. Run `rvs governance compare` first.");
}
const doc = buildGovernanceVisualDoc(plan);
```

If `.rvs/cache/governance/governance-plan.json` doesn't exist yet (i.e.
`rvs governance compare` hasn't been run), the command fails with exactly
that error message rather than attempting a partial render. On success it
writes `<output_dir>/deck.html` and `.rvs/cache/visualdoc.json`, and logs:

```
Rendered <N> governance scenes to <output_dir>/deck.html using "<design-system-id>"
```

`--design-system <id>` still applies normally (it resolves to
`config.defaults.design_system` when omitted, exactly as for every other
profile) — only `--audience`/`--theme` are special-cased away, described
next.

## No `--audience`/`--theme` for this profile

The CLI accepts `--audience <id>` and `--theme <id>` as flags on
`create slides`, but their help text says plainly: "only used with
--profile showcase|portfolio". For `--profile governance` specifically,
both are silently ignored — not rejected, just never read:
`runCreateSlides()` dispatches to `runCreateGovernanceSlides(repoRoot,
model, evidence, tokens, themeId, config, logger)`, a call that does not
forward the parsed `options` (`{audience, theme}`) object at all, unlike
the showcase/portfolio branches which do. (`themeId` here is
`--design-system`'s resolved value, not `--theme`'s — the two flags are
distinct.)

The VisualDoc's `document.audience`/`document.theme` fields are instead
fixed constants, hardcoded directly in the builder:

```ts
// packages/narrative-planner/src/governance-visualdoc-builder.ts
export function buildGovernanceVisualDoc(plan: GovernancePlan): VisualDoc {
  return {
    version: 1,
    document: {
      type: "presentation",
      title: `Architecture Governance: ${plan.report.source_snapshot_id} -> ${plan.report.target_snapshot_id}`,
      aspect_ratio: "16:9",
      audience: "governance",
      theme: "technical-grid",
    },
    scenes: buildGovernanceVisualDocScenes(plan),
  };
}
```

This is a deliberate deviation from the showcase/portfolio precedent, and
the reason is structural, not cosmetic: `PortfolioPlan` carries its own
`generationMetadata.audience`/`.theme` (chosen per-render from the
narrative profile), but `GovernanceGenerationMetadata` is intentionally
minimal — just `generated_at` (see "`GovernancePlan.scenes[]`" above). A
governance comparison is a single deterministic artifact of the two
snapshots being compared, not something meaningfully re-derived per
reader/audience the way a showcase or portfolio narrative is — there is no
"executive" vs. "architect" version of "did policy X pass between snapshot
A and snapshot B." Every governance deck therefore renders with the same
fixed `audience: "governance"` / `theme: "technical-grid"` pair regardless
of who asked for it.

## Known limitations

- **One deck per comparison.** `rvs create slides --profile governance`
  always renders the single most recently cached `GovernancePlan`
  (`.rvs/cache/governance/governance-plan.json`, written by the most
  recent `rvs governance compare`) — there is no way to select an older
  cached comparison's plan from this command.
- **`evidence: []` on every emitted `governance-scene`.** As documented
  above, `GovernanceSceneContent.evidence_refs` (a list of `EvidenceRef`
  paths) is a structurally different shape from the `EvidenceManifest`
  claim ids the VisualDoc `Scene.evidence` field expects, so it is left
  empty at the VisualDoc layer; the real evidence trail lives one level
  down, on the `GovernanceSceneContent` itself inside the cached plan.
- **`--theme` and `--audience` are accepted but silently ignored** for
  `--profile governance` — there is currently no CLI-level warning when a
  caller passes them alongside `--profile governance`.

See also: [docs/architecture-governance.md](architecture-governance.md)
for the change-set/blast-radius/compatibility data these scenes present;
[docs/continuous-intelligence.md](continuous-intelligence.md) for
findings, the narrative, and claims; [docs/governance-baselines.md](governance-baselines.md)
for how the baseline behind a comparison is established;
[docs/portfolio-showcase.md](portfolio-showcase.md) for the audience/theme
-scoped presentation profile this one deliberately does not follow.
