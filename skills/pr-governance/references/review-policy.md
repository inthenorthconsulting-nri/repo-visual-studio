# Review-feedback policy

When the task is to update an existing PR (`MASTER_AGENT.md` §2.9):

- Do not open another PR — this is continuation work
  (`references/task-boundaries.md`).
- Add focused follow-up commits addressing the actual feedback.
- Do not amend already-reviewed commits unless explicitly requested — a
  follow-up commit preserves the review history a rebase/squash would
  destroy.
- Reply to review findings with evidence (a test result, a line reference,
  a reproduction), not just a claim that it's fixed.
- Resolve a review thread only when its specific concern has actually been
  addressed — do not resolve threads in bulk.
- Re-run the tests affected by the fix, and re-run full required validation
  (typecheck + full suite) before signaling the PR is ready again.
- Update the PR description when the scope or validation evidence has
  materially changed since it was opened — an out-of-date description is
  worse than a short one.

## CI fixes specifically

- Diagnose the actual failure before editing anything — read the log, don't
  guess from the check name.
- Never disable a check merely to obtain a green run.
- Never weaken an assertion without first proving the original assertion
  was actually wrong (not just inconvenient).
- Distinguish an infrastructure failure (flaky runner, network, cache) from
  a genuine code failure before deciding what to change.

## Reviewing someone else's PR

When the task is "review this PR" rather than "fix my PR":

1. Read the PR description and diff in full before commenting.
2. Inspect unresolved comments and failing checks.
3. Validate findings against the actual code — don't take a stale comment
   thread's premise at face value if the code has since changed.
4. Only apply fixes when explicitly authorized to; a review can surface
   findings without being asked to resolve them.
5. Re-run validation after any authorized fix.
