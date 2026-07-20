# Commit policy

Commits must be intentional, scoped, reviewable, free of unrelated changes,
and supported by validation. Never commit without explicit, current-turn
authorization (`MASTER_AGENT.md` §1.3) — implementing code is not that
authorization.

## Message patterns

```
Add <capability>
Fix <specific defect>
Harden <specific subsystem>
Document <specific workflow>
Refactor <specific component>
Test <specific behavior>
```

Imperative mood, specific to what changed — not `Update files` or `WIP`.

## Before committing

1. Inspect `git status` — know every file that will be touched.
2. Inspect the complete diff, not just a summary.
3. Inspect staged changes separately from the working tree, once staged.
4. Verify no secrets (`.env`, keys, tokens) and no local absolute paths
   leaked into any file.
5. Run the tests relevant to the change (and the broader suite before
   anything that will be pushed).
6. Confirm any generated artifact in the diff is intentional, not
   accidental scratch output.
7. Confirm no unrelated files are staged (`references/task-boundaries.md`).
8. Report the proposed commit boundary — which files, why — before
   creating the commit.

## Never

- Use `git add -A` or `git add .` blindly — stage files by explicit path so
  nothing unintended rides along.
- Commit secrets.
- Amend a commit without explicit, separate authorization.
- Rewrite a commit that has already been reviewed (pushed, or part of an
  open PR) without explicit authorization.
- Combine implementation and unrelated cleanup in one commit.
- Claim a commit exists before its hash has been verified
  (`git rev-parse HEAD` or the tool output actually returned one).

## After committing, report

Commit hash · commit message · files changed · insertions/deletions ·
working-tree status afterward · branch ahead/behind status relative to its
base and to `origin`.
