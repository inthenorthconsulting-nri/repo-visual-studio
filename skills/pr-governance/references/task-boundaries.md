# Task boundaries — new task vs. continuation

Decide this before creating anything. Getting it wrong in either direction
either fragments one reviewable change across many PRs, or bundles
unrelated changes into one PR a reviewer can't cleanly approve.

## New task → new branch, eventually a new PR

The request introduces:

- A new feature
- A new defect fix
- A new refactor
- A new documentation initiative
- A new maintenance initiative
- A new milestone
- Any other independently reviewable change

## Existing task → continue the current branch and PR

The request is:

- Addressing review feedback on an open PR
- Fixing CI for that PR
- Completing acceptance criteria that were explicitly deferred within the
  same task
- Correcting documentation for the same feature the branch already
  implements
- Adding tests required for the same PR
- Resolving merge conflicts for that PR
- Responding to requested changes

When in doubt, ask: would a reviewer who approved the current PR need to
re-review this as a separate decision? If yes, it's a new task.

## Do not bundle

Never add unrelated work to an existing branch merely because it's
convenient or was discovered along the way. These always need their own
branch, even when found mid-task:

- A dependency upgrade unrelated to the current feature
- Repository cleanup discovered during feature work
- A separate product capability
- An unrelated documentation correction
- Broad refactoring not required by the current task
- A follow-up enhancement outside the accepted scope

Record the discovery as an unrelated finding in the completion report
(`MASTER_AGENT.md` §7) instead of implementing it. Let the user decide
whether and when it becomes its own task.

## Worked check

Before every commit, ask: does every file in this diff exist because of
*this* task's stated goal? If a file is touched only for reasons unrelated
to the task, split it out — either drop it from the commit or flag it as a
separate follow-up.
