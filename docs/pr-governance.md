# PR Governance (Milestone 6.2, part 2)

This document explains the reasoning behind `skills/pr-governance/SKILL.md`
and its references. Read the skill for the actual procedures — this is the
narrative version, with the "why" and worked examples.

## One task, one branch, one PR

The default is deliberately rigid: every new, independently reviewable
piece of work gets its own branch and, eventually, its own PR. The
alternative — bundling several unrelated changes onto whatever branch is
already checked out — produces a PR a reviewer cannot cleanly approve or
reject as a unit; they either approve unrelated changes they didn't
actually evaluate, or block unrelated good work behind one contested piece.
Neither outcome is what "review" is supposed to produce.

## New task vs. continuation

The rigid default would be counterproductive if it also forced review
feedback, CI fixes, and deferred test coverage for an *already open* PR
into new branches — that would fragment one review decision into several,
which is the same failure mode from the other direction. §9 of the original
milestone spec (mirrored in
`skills/pr-governance/references/task-boundaries.md`) draws the line at:
does this request introduce a new, independently reviewable change, or does
it refine a change that's already under review? The test in the reference
file — "would a reviewer who already approved the current PR need to
re-review this as a separate decision" — is the operational version of that
distinction.

### Worked example: new task

*"Add a command to export architecture decisions."* This is new capability,
independently reviewable on its own merits. It gets a new branch
(`feature/export-architecture-decisions` or similar) and, once
implementation is authorized to proceed to that point, its own PR.

### Worked example: continuation

*"The CI run on PR #4 is failing on a TypeScript error in the new file."*
This is not a new task — it's completing work already under review on an
existing branch. Stay on that branch, fix the type error, push a follow-up
commit (once authorized), and let the same PR pick it up.

### Worked example: do-not-bundle

*"While implementing the export command, I noticed three dependencies are
outdated."* The dependency upgrade is real, but it is not what the current
PR is about, and a reviewer evaluating "does this export command work
correctly" should not also have to evaluate "were these version bumps
safe." Record it as a finding in the completion report; it becomes its own
task only when the user decides to pursue it.

## Branch naming and base selection

`references/branch-policy.md` is intentionally mechanical: lowercase
kebab-case, a fixed set of type prefixes, no generic names. The pre-creation
inspection sequence (`git status`, `git branch --show-current`, `git
rev-parse HEAD`, `git remote -v`, `git fetch --prune`, `git rev-list
--left-right --count`) exists so that "branch from the expected base" is
something an agent verified, not assumed — a branch cut from a stale local
`main` silently reintroduces already-reverted code the next time it's
compared against the real base.

## Commit boundaries

A commit is the smallest unit a reviewer will actually read as a step in
the change's story. `references/commit-policy.md`'s pre-commit checklist —
inspect status, inspect the full diff, inspect staged changes separately,
check for secrets, run relevant tests, confirm no unrelated files — exists
because each of those is a distinct failure this repository has already
seen elsewhere in its history addressed reactively (e.g. Milestone 6.1's
hardening pass existed specifically to close gaps a less careful commit
boundary would have shipped). Catching them before the commit is cheaper
than catching them after.

## PR requirements

The description sections required by `references/pull-request-policy.md`
(executive summary, problem, scope, implementation, validation, test
totals, package/runtime proof, known limitations, risks, rollback,
out-of-scope, relationship to prior milestones/PRs) are the same shape this
repository's actual merged PRs have already used successfully (see PR #4's
description for a live example) — the policy formalizes an existing,
working pattern rather than inventing a new one.

## Review-fix behavior

Rebasing or squashing an already-reviewed commit destroys the reviewer's
prior context — a comment that pointed at a specific line in a specific
commit no longer resolves to anything meaningful once that commit is gone.
`references/review-policy.md` requires follow-up commits instead,
preserving that history until the PR is actually approved, at which point
the repository's chosen merge strategy (`references/merge-policy.md`) — not
an ad hoc rebase mid-review — is what collapses the history.

## Merge authorization

Merging is the last and most consequential of the four publication
boundaries — it changes the base branch every other contributor builds on
top of. `references/merge-policy.md`'s pre-merge checklist (approvals, CI,
resolved threads, mergeability, no new unreviewed commits) is standard
practice; the one addition specific to this repository's governance model
is the explicit "do not automatically start another task" after merging —
completing one authorized task is not itself authorization for the next
one, even an obviously related one.
