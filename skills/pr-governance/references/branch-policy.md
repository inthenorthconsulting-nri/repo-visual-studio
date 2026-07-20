# Branch policy

## Naming

```
feature/<concise-task-name>
fix/<concise-defect-name>
docs/<concise-documentation-task>
refactor/<concise-refactor-name>
test/<concise-test-task>
chore/<concise-maintenance-task>
release/<release-identifier>
```

- Lowercase kebab-case.
- No personal names.
- No generic names (`updates`, `changes`, `fix`) — name the actual task.

## Before creating a branch

Run, in order, and read the output before acting on it:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
git fetch --prune
git rev-list --left-right --count <base>...HEAD
```

Do not run a destructive command (`reset --hard`, `clean -fd`, `checkout
--`) to force a clean starting point — if the tree isn't clean, follow
`MASTER_AGENT.md` §1.4 instead: identify what's already there, and stop
before doing anything destructive with it.

## Rules

- Branch from the repository's expected base branch (`main` unless the
  task specifies otherwise).
- Refresh the base first only when authorized and safe (a `git fetch` is
  always safe; a `git pull`/rebase onto a moved base is not automatic).
- Record the base commit the branch was cut from — it belongs in the
  eventual commit/PR report.
- Verify the new branch contains no unrelated commits before building on
  it.
- Never reuse an already-merged task branch for a new task.
- Never force-push without explicit authorization.
- Never delete a branch without explicit authorization.

## Local branch creation vs. authorization to publish

Creating a **local** task branch may be treated as part of implementation
(no separate authorization needed beyond "start this task") when: the user
explicitly asked to begin a new task, one-task-per-branch governance
requires it, the working tree is clean, the correct base is known, and no
remote write occurs.

Creating a local branch does **not** authorize: pushing it, opening a PR,
committing changes, closing another branch, or deleting another branch.
Each of those still needs its own explicit go-ahead (`MASTER_AGENT.md`
§1.3).

When any of the preconditions above isn't met — dirty tree, unclear base,
ambiguous task boundary — preserve the current state and report the
proposed branch instead of creating it.
