# Capability Intelligence (reference)

Use when: the task asks what a product can do, which capabilities are
partial, or what gaps exist (`MASTER_AGENT.md` §2.2).

**Prerequisite**: `architecture-intelligence.json` exists and is fresh
(§ `intelligence-routing.md`). Do not route directly here if it's missing
or stale — regenerate Architecture Intelligence first.

**Command**:

```bash
rvs synthesize capabilities
```

**Output**: `.rvs/cache/capability-model.json` — one entry per detected
capability with an evidence-strength score, an inclusion/exclusion
decision, and a readiness tier (current / partial / roadmap / excluded).
Excluded candidates carry one of 13 documented exclusion reason codes
rather than being silently dropped.

**Validation**: structural checks run automatically inside `rvs validate
--ci` whenever `capability-model.json` is present. `rvs capabilities
explain <capability-id>` prints the full evidence, readiness reasoning, and
(for excluded candidates) the exclusion reason for one capability.

**Export**: `rvs export capabilities [--output CAPABILITIES.md]` renders
the human-readable capability doc, with `--include-partial`,
`--include-gaps`, `--include-roadmap`, `--include-excluded` toggles.

Full technical reference: `docs/capability-intelligence.md` (evidence
strength model, incomplete-signal keywords, readiness scoring, the 13
exclusion codes, self-hosting proof).
