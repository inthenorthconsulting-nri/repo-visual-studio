# Merge policy

**Merging always requires explicit, current-turn authorization** — separate
from PR-opening authorization (`MASTER_AGENT.md` §1.3).

## Before merging

- Required approvals obtained.
- Required CI checks green.
- Review threads resolved.
- Branch up to date with, or cleanly mergeable into, its base.
- No new, unreviewed commits landed since the last approval.
- Release or migration notes complete, if the change needs them.
- Rollback path understood, where relevant.
- No unresolved blocking warning from any validation layer
  (`rvs validate --ci`, typecheck, test suite, packaging checks).

## Merge strategy

Use the repository's established preference (merge / squash / rebase) —
check existing merged PR history rather than assuming. Do not switch
strategy mid-milestone without a stated reason.

## After merging

- Verify the merged commit or PR state directly (`gh pr view`, `git log`)
  rather than assuming the merge succeeded.
- Report the merge strategy actually used.
- Do not delete the source branch unless separately authorized.
- Do not automatically start another task — report completion and wait.
