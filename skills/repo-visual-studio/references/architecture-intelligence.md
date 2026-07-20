# Architecture Intelligence (reference)

Use when: the task is repository orientation (`MASTER_AGENT.md` §2.1) or a
prerequisite for Capability/Product/Portfolio Intelligence (§2.2-§2.4).

**Prerequisite**: `rvs inspect` has run at least once
(`.rvs/cache/repository-model.json` and `evidence-manifest.json` exist).

**Command**:

```bash
rvs synthesize architecture
```

**Output**: `.rvs/cache/architecture-intelligence.json` — system identity
(name + basis), capability domains, workflow families (with a selected
representative workflow), responsibilities/component map, flows and
boundaries. Every field traces back to a specific evidence citation; nothing
is inferred beyond what the scan + workflow/Terraform graphs support.

**Validation**: structural checks in
`packages/architecture-intelligence/src/validate-structure.ts` (e.g. generic
system-name detection, over-granular capability-domain flags, workflow
families missing a representative). These run automatically as part of
`rvs validate --ci` whenever the cache file is present — no separate command
needed.

**Do not** re-run `rvs inspect` just to refresh Architecture Intelligence;
re-run it only when the underlying repository content changed. Do not hand-
edit `architecture-intelligence.json` — it will be silently overwritten by
the next `synthesize architecture` run.

Full technical reference: `docs/architecture-intelligence.md` (design
mandate, contract shape, synthesis pipeline, narrative profiles, known
limitations).
