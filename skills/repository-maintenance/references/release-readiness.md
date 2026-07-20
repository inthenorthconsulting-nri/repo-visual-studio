# Release readiness

Assesses whether the repository *would* be ready to publish — it never
publishes anything itself. Publishing (an npm `publish`, a GitHub release)
is explicitly outside normal maintenance and needs its own explicit
authorization (`MASTER_AGENT.md` §1.3), the same as any other write action.

## Supported checks

- Version consistency across `package.json` files that should move
  together.
- Changelog readiness — is there an entry (or `docs/milestones.md` entry,
  which currently serves that role) describing what's shipping.
- Package contents — `pnpm --filter <pkg> pack` and inspect the resulting
  tarball's file list for anything unintended (source maps, test fixtures,
  local paths) or anything missing that the package needs at runtime.
- Build reproducibility — a clean install + build produces the same
  output twice.
- Tarball smoke test — install the packed tarball into a scratch directory
  and confirm the CLI runs (`packages/cli/src/__tests__/package-smoke.test.ts`
  is this repository's existing implementation of exactly this check, run
  via `RVS_TEST_PACKAGE=1 pnpm test`).
- Source/package equivalence — packaged output matches source-run output
  structurally (`source-vs-package-equivalence.test.ts`, same env gate).
- CLI help output — `--help` on the packaged binary matches the documented
  command surface.
- Migration notes — anything a consumer needs to do differently after
  upgrading.
- Breaking-change disclosure — any removed command, changed default, or
  changed output shape is called out explicitly, not left for a consumer to
  discover.
- Release-artifact validation — whatever gets attached to a release (deck
  output, docs) actually builds from the code being released.
- Rollback notes — what reverting this release would require.

## Rule

A "release readiness: pass" report is not itself a release. It hands the
user a decision, with evidence, about whether to authorize the publish
step — it never triggers that step on its own.
