# Pull-request policy

Every new task (`references/task-boundaries.md`) ultimately gets its own
PR, unless: the user explicitly says not to open one, the task is
abandoned, the work is intentionally local/experimental, the repository
doesn't use pull requests, or the work continues an existing PR
(`references/review-policy.md`).

**Opening a PR always requires explicit, current-turn authorization** —
separate from commit authorization and separate from push authorization
(`MASTER_AGENT.md` §1.3).

## Before opening a PR

1. Confirm the working tree is clean.
2. Confirm the intended commit(s) — what's actually going into this PR.
3. Confirm the expected base branch.
4. Confirm the branch has been pushed (a PR cannot precede its branch on
   the remote).
5. Confirm CI-relevant tests passed locally (typecheck + test suite, and
   package verification where the change touches packaging).
6. Review the remote diff against the base (`git diff <base>..HEAD` or
   equivalent) one more time, not just the local diff — catch anything a
   rebase or force-push elsewhere might have introduced.
7. Confirm no unrelated changes are included.
8. Prepare an accurate title and description — see below.

## Title patterns

```
Add <capability>
Fix <specific defect>
Harden <subsystem>
Document <workflow>
```

## Description requirements

Every PR description includes, adapted to what actually applies:

- Executive summary
- Problem
- Scope
- Implementation
- Files or components affected
- Validation performed
- Test totals
- Package/runtime proof, where applicable
- Screenshots or artifacts, where applicable
- Known limitations
- Risks
- Rollback considerations
- Explicit out-of-scope items
- Relationship to preceding milestones or PRs

Never copy a raw agent transcript into a PR description — synthesize it
into the sections above.

## Size and task boundaries

A PR should represent one coherent review decision. Split the work when it
contains independently approvable changes: feature implementation bundled
with an unrelated refactor, a runtime feature bundled with a dependency
upgrade, a product capability bundled with repository cleanup, multiple
unrelated defects, separate documentation initiatives, or distinct
milestones.

Do not split tightly coupled implementation, tests, schema changes, CLI
wiring, and documentation merely to reduce file count or line count — a
large PR is acceptable when the domain change is genuinely cohesive and the
validation evidence backing it is strong.
