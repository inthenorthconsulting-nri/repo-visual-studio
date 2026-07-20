# Dependency maintenance

## Supported analyses

- Dependency inventory (per package, `dependencies` vs. `devDependencies`).
- Outdated-dependency analysis (`pnpm outdated` or equivalent, read not
  auto-applied).
- Security-advisory review (`pnpm audit` or equivalent).
- Duplicate-version detection across the workspace (`pnpm-lock.yaml`).
- Unused-dependency detection — cross-check an import actually exists
  before recommending removal (see the evidence bar in
  `dead-code-and-artifact-cleanup.md`, which applies equally here).
- Runtime vs. dev-dependency classification correctness (a package used
  only in tests/build tooling shouldn't be a runtime `dependency`).
- Lockfile integrity (`pnpm install --frozen-lockfile` succeeding is the
  check; don't hand-edit the lockfile).
- Upgrade planning — a written plan, not an applied upgrade, unless
  implementation was explicitly requested.

## Rules

- Never perform a broad upgrade incidentally while doing something else.
- One dependency-maintenance task normally gets its own branch and PR
  (`skills/pr-governance/references/task-boundaries.md` — this is exactly
  the kind of work that must not be bundled into a feature branch).
- Separate major-version upgrades from each other unless they're tightly
  coupled (e.g. a framework and its official plugin that must move
  together).
- Read the actual release notes for a major bump before recommending or
  applying it — don't assume semver compliance.
- Verify peer-dependency compatibility across the workspace before
  upgrading a shared dependency.
- After any applied upgrade: run the package's build, the full test suite,
  and — where the change could affect packaging —
  `RVS_TEST_PACKAGE=1 pnpm test` (`release-readiness.md`).
- Never weaken a security control or a version pin to make an upgrade
  easier; if a pin exists, find out why before removing it.
