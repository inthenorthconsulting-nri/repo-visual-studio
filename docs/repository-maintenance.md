# Repository Maintenance (Milestone 6.2, part 3)

This document explains the reasoning behind
`skills/repository-maintenance/SKILL.md` and its six workflow references.
Read the skill for the actual checklists — this is the narrative version.

## Why a maintenance skill, and why now

Milestones 1-6 each added a synthesis engine; none of them added a
standard way to ask "is the repository itself healthy" independent of any
specific feature. Without one, maintenance requests get answered ad hoc —
inconsistent depth, inconsistent evidence bar, and (the actual risk) an
agent treating "the user asked me to clean up dead code" as license to
delete anything that merely looks unused. This skill exists to make
maintenance requests produce the same quality of evidence-backed answer
every other RVS workflow does, and to keep every maintenance workflow
strictly on-demand — inspect and report, never continuous, never
autonomous.

## Health review

`references/repository-health.md` inspects the state a "how healthy is
this repository" question actually needs — branch/tree state, build and
test configuration, CI workflows, documentation entry points, generated
artifacts that might have leaked past `.gitignore`, and code-hygiene
markers (`TODO`/`FIXME`, deprecated markers, duplicate configuration). The
four-way report shape (confirmed / probable / recommendation / out of
scope) exists so a health review's findings can't be mistaken for
already-applied fixes — a "confirmed issue" is still just a report until
someone authorizes acting on it.

## Dependency maintenance

Dependency work is scoped narrowly on purpose:
`references/dependency-maintenance.md` supports inventory, staleness,
security, duplication, and unused-dependency analysis, but explicitly
forbids folding an upgrade into an unrelated feature branch. The reasoning
is the same as `docs/pr-governance.md`'s do-not-bundle rule: a dependency
bump and a feature change fail for different reasons and should be
revertable independently. Reading real release notes before a major bump,
and re-running the packaging smoke test (`RVS_TEST_PACKAGE=1 pnpm test`)
afterward, exists because this repository has already documented a real
packaging failure class (`docs/milestones.md`'s "Known Limitation —
External CLI Packaging" entry, later fixed by the Packaging Hardening
Milestone) that a dependency change could plausibly reintroduce if
packaging weren't re-verified.

## Documentation maintenance

`references/documentation-maintenance.md`'s central rule — check a
documented claim against source before restating it — exists because this
codebase's own documentation style leans heavily on specific, checkable
claims (exact test counts, exact command flags, exact file paths). That
style is valuable exactly because it's checkable; documentation maintenance
is the workflow that actually does the checking, rather than assuming a
previous author already got it right.

## Test maintenance

`references/test-maintenance.md` protects two things this repository's test
suite is unusually good at: boundary tests at an exact threshold (see
Milestone 6.1's `DECISIONS_MAX`/`CAPABILITY_COVERAGE_MAX` boundary tests)
and determinism proofs via real re-synthesis rather than mocking (see
`packages/portfolio-intelligence/src/__tests__/index.test.ts`). A test
maintenance pass that "simplifies" either pattern into a looser assertion or
a snapshot would quietly remove the exact property that made the original
test valuable. The explicit "do not remove a test merely because it fails"
rule exists because a failing test is information, not friction to be
cleared.

## Dead code and artifact cleanup

The evidence bar in `references/dead-code-and-artifact-cleanup.md` (no
importers, no CLI registration, no documented runtime use, no test
dependency, no package export, no build/release dependency) is deliberately
higher than "looks unused." This repository already has precedent for
exports that look dead by a shallow check but are intentional public
surface — e.g. `resolveCanonicalProductIds` in
`packages/portfolio-intelligence/src/identity-reconciliation.ts`, exported
and independently tested but not currently called by any production code
path, flagged as a non-blocking finding during Milestone 6.1's review
rather than deleted outright. The cleanup workflow is built to produce that
same "confirmed vs. probable, with a documented reason to keep it" outcome
by default, not to encourage deletion on filename or age alone.

## Release readiness

`references/release-readiness.md` assesses without publishing. The
tarball smoke test and source/package equivalence check it points to
(`package-smoke.test.ts`, `source-vs-package-equivalence.test.ts`) already
exist in this repository from the Packaging Hardening Milestone and
Milestone 6.1's hardening pass — this workflow's contribution is making
"run these before claiming release readiness" a named, repeatable step
rather than something only invoked reactively when a packaging bug is
already suspected.

## What maintenance does not do automatically

No workflow in this skill modifies the repository, upgrades a dependency,
deletes a file, or publishes a package without an explicit implementation
request for that specific action. Every workflow's default output is a
report; turning a report into a change is a separate decision, and — once
made — that change still goes through the same branch/PR governance as any
other task (`docs/pr-governance.md`).
