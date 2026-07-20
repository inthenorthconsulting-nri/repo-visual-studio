---
name: pr-governance
version: 1.0.0
description: Enforce one-task-per-branch/PR discipline and Git publication boundaries (commit, push, PR, merge) for repo-visual-studio. Use for any code implementation task, any PR review/review-feedback task, or whenever a task is about to produce a commit.
---

# PR Governance

This skill governs how work turns into branches, commits, pull requests,
and merges in `repo-visual-studio`. It is loaded whenever `MASTER_AGENT.md`
routes a task to class 2.5 (code implementation), 2.8 (repository
maintenance producing a change), or 2.9 (PR review / review feedback).

**Default policy**: every new implementation task gets a new task branch
and, eventually, a new pull request. The skill's job is distinguishing a
genuinely new task from continuation work on one already in flight — see
`references/task-boundaries.md` first, before creating anything.

## Workflow

1. **Classify**: new task, or continuation of an existing branch/PR?
   `references/task-boundaries.md`.
2. **Branch** (new task only): `references/branch-policy.md` — naming,
   base selection, the pre-creation inspection sequence.
3. **Implement**, scoped to the task. Never fold in unrelated changes
   discovered along the way — record them as findings instead
   (`references/task-boundaries.md#do-not-bundle`).
4. **Commit** (only when explicitly authorized):
   `references/commit-policy.md` — what to inspect first, what a commit
   message should look like, what the post-commit report must include.
5. **Push** (only when explicitly authorized, separately from commit
   authorization).
6. **Open a PR** (only when explicitly authorized, separately from push
   authorization): `references/pull-request-policy.md` — pre-flight
   checks, title/description requirements.
7. **Review feedback** (continuation work, not a new PR):
   `references/review-policy.md`.
8. **Merge** (only when explicitly authorized, separately from PR
   authorization): `references/merge-policy.md`.

## The four publication boundaries

Commit → Push → PR → Merge. Authorization for one **never** implies
authorization for the next. A request to implement code does not authorize
committing it; a request to commit does not authorize pushing; a request to
push does not authorize opening a PR; a request to open a PR does not
authorize merging it. See `MASTER_AGENT.md` §1.3 — this skill exists to
operationalize that rule, not to relax it.

## Dirty-tree protection

If the working tree already has uncommitted changes when a task starts,
identify what pre-existed before touching anything. Never stage, commit, or
discard changes the current task didn't create — `MASTER_AGENT.md` §1.4.

## Destructive operations

`git reset --hard`, `git clean -fd`, `git push --force[-with-lease]`,
`git branch -D`, `git rebase`, `git commit --amend`, `git checkout -- .`,
`git restore .` all require explicit authorization, a stated need, and a
recovery plan — `MASTER_AGENT.md` §10. This skill never issues one of these
as a convenience shortcut.

Narrative version with worked examples: `docs/pr-governance.md`.
