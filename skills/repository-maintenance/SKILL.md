---
name: repository-maintenance
version: 1.0.0
description: Deterministic repository-hygiene workflows for repo-visual-studio — health review, dependency review, documentation/test maintenance, dead-code and artifact cleanup, release readiness. Use for repository maintenance tasks; not for continuous or autonomous monitoring.
---

# Repository Maintenance

This skill is loaded when `MASTER_AGENT.md` routes a task to class 2.8
(repository maintenance). It provides deterministic, on-demand maintenance
workflows — it is explicitly **not** continuous repository monitoring,
scheduled synthesis, or autonomous change-making. Every workflow here
inspects and reports; it modifies the repository only when the user
requested implementation, and any resulting change still goes through
`skills/pr-governance/SKILL.md` for its own branch and PR.

## Workflows

| Task | Reference |
|---|---|
| General hygiene sweep: branch/tree state, build/test/CI config, generated artifacts, TODOs, deprecated markers | `references/repository-health.md` |
| Dependency inventory, outdated/security/duplicate/unused analysis, upgrade planning | `references/dependency-maintenance.md` |
| Command/path/schema verification, cross-reference and link validation | `references/documentation-maintenance.md` |
| Flaky/dead/over-mocked test review, boundary/negative test coverage, fixture integrity | `references/test-maintenance.md` |
| Unused-code and stale-artifact removal, evidence-gated deletion | `references/dead-code-and-artifact-cleanup.md` |
| Version consistency, packaging smoke test, source/package equivalence, breaking-change disclosure | `references/release-readiness.md` |

## Reporting convention

Every maintenance workflow's output is one of exactly four categories per
finding — never a flat list:

- **Confirmed issue** — verified against the actual code/config, not just
  suspected.
- **Probable issue requiring validation** — pattern-matched but not yet
  independently confirmed; say what would confirm it.
- **Recommendation** — a change worth making that isn't a defect.
- **Out of scope** — noticed, but belongs to a different task or milestone;
  record it, don't act on it (`skills/pr-governance/references/task-boundaries.md`).

## What this skill never does on its own

- Modify the repository without an explicit implementation request.
- Perform a broad dependency upgrade "while we're in here."
- Delete anything without the evidence bar in
  `references/dead-code-and-artifact-cleanup.md`.
- Publish a package or cut a release — release readiness only assesses
  whether the repository *would* be ready; publishing needs its own
  explicit authorization (`MASTER_AGENT.md` §1.3).
- Run on a schedule, watch the repository continuously, or scan other
  GitHub repositories/organizations — that is out of this milestone's scope
  entirely (Architecture Governance / Continuous Intelligence, not yet
  built).

Narrative version with rationale: `docs/repository-maintenance.md`.
