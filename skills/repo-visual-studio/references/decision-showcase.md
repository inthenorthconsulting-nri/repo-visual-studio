# Decision Showcase: Slides (reference)

Use when: the task wants a rendered HTML deck summarizing decisions —
landscape, status, implementation coverage, drift, debt, governance impact.

**Prerequisite**: `rvs decisions analyze` has run and produced
`.rvs/cache/decisions/decision-plan.json`.

**Command**:

```bash
rvs create slides --profile decisions
```

**Output**: `deck.html` under the configured `output_dir`, rendered via
the configured design system. The completion log line reports the scene
count and design system id used.

**Key facts to get right when explaining this to a user**:

- 17 scene kinds are implemented (`decision-hero`, `decision-landscape`,
  `decision-status`, `decision-architecture-map`, `decision-capability-map`,
  `decision-product-map`, `decision-portfolio-map`,
  `decision-implementation`, `decision-assumptions`, `decision-supersession`,
  `decision-conflicts`, `decision-coverage`, `decision-drift`,
  `decision-debt`, `decision-governance-impact`, `decision-review-required`,
  `decision-validation`) — not 15, correcting an earlier estimate from the
  originating design plan.
- This profile hardcodes `audience: "decisions"` and
  `theme: "technical-grid"` — there is no `--audience` flag on this path
  today.
- Every scene is a structural reprojection of already-computed
  `DecisionPlan` fields — nothing is synthesized at render time.

**Validation**: `rvs validate --ci` applies the same overflow/contrast/
evidence checks to a decisions deck as to any other profile.

Full technical reference: `docs/decision-showcase.md` (the full 17-scene
table, the `DecisionSceneSchema` addition to the `VisualDoc` discriminated
union, `renderDecisionScene()`'s exhaustive switch, and the CLI log-line
format).
