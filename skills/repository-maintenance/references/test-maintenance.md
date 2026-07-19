# Test maintenance

## Supported reviews

- Flaky-test investigation — reproduce first (re-run in isolation, check
  for order-dependence or timing assumptions) before concluding a test is
  flaky rather than genuinely broken.
- Dead-test identification — a test that no longer exercises the code path
  its name claims to (e.g. the code changed underneath it and it now
  trivially passes).
- Unreachable diagnostic tests — a test gated behind a condition
  (environment variable, `it.skip`) that never actually runs in CI; confirm
  whether that's intentional (like `RVS_TEST_PACKAGE`-gated packaging
  tests, which are intentionally opt-in) or an oversight.
- Over-mocked tests — a test that mocks so much of the system under test
  that a real regression could pass it; prefer this repository's existing
  pattern of testing against real fixtures (`makeRepositoryModel()`,
  `makePortfolioModel()`, etc.) over introducing new mocking.
- Source/package equivalence coverage — does a change to packaged behavior
  have a corresponding check in
  `packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` (or
  its pattern), not just a source-level test.
- Boundary tests — an array/count-based limit (e.g. `DECISIONS_MAX`,
  `CAPABILITY_COVERAGE_MAX`) has a test at exactly the threshold and one
  test one over it, not just an arbitrary large-N test.
- Negative tests — a validator has a test proving it actually fires on the
  bad input it claims to catch, not only tests proving it stays quiet on
  good input.
- Fixture integrity — shared fixtures (`__tests__/fixtures.ts` per package)
  stay representative of real shapes as the underlying types evolve.
- Snapshot misuse review — a snapshot test replacing what should be a
  semantic assertion (a snapshot that would still "pass" after a real
  regression, because the regression got baked into the snapshot).
- Environment-gated test review — confirm the gate (env var, platform
  check) is still necessary and still documented where it's used.

## Rules

- Do not remove a test merely because it fails — fix the code, fix the
  test's own bug, or (rarely, with a stated reason) determine the test's
  premise is no longer valid. A failing test is a finding, not license to
  delete it.
- Do not replace a semantic assertion (`expect(x).toBe(specificValue)`)
  with a snapshot without justification — snapshots are appropriate for
  large structural output, not for the specific behavioral claims this
  repository's tests are built around (see the determinism-proof pattern in
  `packages/portfolio-intelligence/src/__tests__/index.test.ts`).
