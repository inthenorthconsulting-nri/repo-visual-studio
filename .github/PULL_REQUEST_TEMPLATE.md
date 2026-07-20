<!--
See docs/pr-governance.md and skills/pr-governance/references/pull-request-policy.md
for the full policy this template implements. Leave a section's default
text in place (or note "Not applicable") rather than deleting the heading —
that keeps the template usable for documentation-only or test-only PRs
where a section genuinely doesn't apply.
-->

## Summary

<!-- One or two sentences: what this PR does and why. -->

## Problem

<!-- What was broken, missing, or needed. Not applicable for pure additions. -->

## Scope

<!-- What's in this PR. Explicitly note what's deliberately NOT in it if that's likely to be asked. -->

## Implementation

<!-- The approach, and any non-obvious decision worth a reviewer knowing about. -->

## Validation

<!-- Commands actually run, e.g. `pnpm -r exec tsc --noEmit`, `pnpm test`. -->

## Tests

<!-- Test totals (passed/failed/skipped). "No new tests — doc-only change" is fine if true. -->

## Package/runtime proof

<!-- If this touches packaging or CLI behavior: RVS_TEST_PACKAGE=1 pnpm test results. Otherwise: not applicable. -->

## Documentation

<!-- Docs added/updated, or "not applicable." -->

## Known limitations

<!-- Anything intentionally left unhandled, with why. -->

## Risks

<!-- What could this break, and how would you notice. -->

## Rollback

<!-- How to revert this if it needs to come back out. -->

## Out of scope

<!-- Follow-up work this PR deliberately does not include. -->

## Checklist

- [ ] This PR represents one coherent review decision (see `docs/pr-governance.md#pr-requirements`)
- [ ] No unrelated changes are bundled in
- [ ] `pnpm -r exec tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] Documentation reflects the actual current implementation
