# Repository health review

A point-in-time inspection, not a monitor. Run it, report findings in the
four categories from `SKILL.md`, and stop — do not modify the repository
unless the user separately asked for implementation.

## Inspect

- Branch state (`git branch --show-current`, ahead/behind its base, any
  stale local branches already merged upstream).
- Working-tree state (`git status --short`) — uncommitted or untracked
  files, and whether they look intentional.
- Package structure (`pnpm-workspace.yaml`, each `packages/*/package.json`
  — name, dependencies, whether `typecheck`/`test` scripts exist and match
  the workspace convention).
- Build configuration (`tsconfig.base.json` and any package-local
  overrides).
- Test configuration (how `pnpm test` at the root actually discovers test
  files — there is no root `vitest.config.*` at the time of writing, so it
  relies on Vitest's default include glob).
- CI workflows (`.github/workflows/*.yml`) — do the jobs still match what
  `package.json` scripts and the CLI actually expose.
- Documentation entry points (`README.md`, `docs/*.md`, `skills/**/SKILL.md`).
- Generated artifacts that should be gitignored but might have leaked
  (`artifacts/`, `.rvs/cache/`, `*.tgz`, packed tarballs) — cross-check
  against `.gitignore`.
- Temporary/scratch files that don't belong in the repository.
- Ignored files that are nonetheless referenced by documentation (a
  documentation bug, not a code bug).
- Public exports (each package's `main`/`types` entry and what it actually
  re-exports) versus what's documented as public API.
- Deprecated-code markers and `TODO`/`FIXME` comments — report them, don't
  resolve them as a side effect of a health review.
- Duplicate configuration (e.g. two files expressing the same TypeScript
  compiler options divergently).
- Stale scripts (a `package.json` script that references a file or command
  that no longer exists).
- Unsupported or overly loose runtime declarations (`engines` ranges wider
  than what's actually tested in CI).

## Output shape

For each finding: category (confirmed / probable / recommendation / out of
scope), a one-line description, the file(s)/command(s) that support it, and
— for "probable" — what additional check would confirm it.
