# Product Intelligence (reference)

Use when: the task asks for a product overview, executive narrative,
differentiation statement, or showcase deck (`MASTER_AGENT.md` §2.3).

**Prerequisite**: `capability-model.json` and `architecture-intelligence.json`
both exist and are fresh.

**Commands**:

```bash
rvs synthesize product-identity
rvs create slides --profile showcase --audience executive
```

**Output**: `.rvs/cache/product-identity-model.json` — archetype
classification, confidence, value pillars, differentiator candidates — then
(via `create slides --profile showcase`) an `ExecutiveNarrative` and
`ShowcasePlan`, both cached to `showcase-plan.json`.

**Claim control**: every executive-facing statement in the narrative/plan
is independently checked against the evidence before it can render as
approved. A claim without sufficient evidence is either qualified (rendered
with a caveat) or rejected (never rendered, with the reason recorded) — this
is not optional and is not bypassed by asking for a "punchier" narrative.

**Override**: `.rvs/product.yml` lets a human correct the archetype or
value-pillar framing without touching the deterministic pipeline; see
`docs/product-identity-intelligence.md#override-file-rvsproductyml`.

**Validation / explain**: structural checks run inside `rvs validate --ci`.
`rvs showcase explain <claim-id>` prints the text, status, qualifiers,
rejection reasons, and evidence for one claim.

**Export**: `rvs export product-identity`, `rvs export showcase-plan`.

Full technical reference: `docs/product-identity-intelligence.md` and
`docs/executive-showcase-intelligence.md` (claim control mechanics,
showcase scene sequencing, self-hosting proof).
