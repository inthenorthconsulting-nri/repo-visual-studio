# Dead code and artifact cleanup

## Supported targets

Unused exports · unused files · dead branches (already-merged, stale local
or remote branches) · superseded documentation · temporary archives ·
packaged tarballs left in the tree · generated scratch output · local-path
leakage in committed files · debug logging left in from development ·
commented-out implementation code · stale fixtures no longer exercised by
any test.

## Evidence bar for deletion

Deletion requires demonstrating, not assuming:

- No importers (`grep`/type-checker confirms nothing references the
  export or file).
- No CLI registration (not wired into `packages/cli/src/bin.ts`).
- No documented runtime use (not referenced by any `docs/*.md` or
  `SKILL.md` as a supported behavior).
- No test dependency (no `__tests__` file imports or exercises it).
- No package export (not part of a package's public `main`/`index.ts`
  surface that another package or an external consumer could depend on).
- No build or release dependency (not referenced by a `package.json`
  script, `tsconfig`, or CI workflow step).

**Do not delete based only on filename or apparent age.** A file named
`legacy-*` or one that hasn't changed in months is not evidence by itself —
run the checks above before treating it as dead.

## Known, deliberately-kept exceptions

Some exports look unused by the checks above but are intentionally public
API surface, not dead code — e.g. a validator or id-generation function
exported for external consumers or future callers even though nothing in
this workspace currently calls it. Cross-check `docs/*.md`'s "Known
limitations" sections before proposing removal; several intentional
scope-trims are already documented there (see e.g.
`docs/portfolio-intelligence.md#known-limitations`) and are not cleanup
targets.

## Process

1. Gather evidence per target using the checklist above.
2. Categorize per `SKILL.md`'s four-way report (confirmed / probable /
   recommendation / out of scope).
3. Only remove what's confirmed, and only when the user requested
   implementation — a cleanup finding is not itself authorization to
   delete.
4. Any resulting deletion is its own reviewable change
   (`skills/pr-governance/references/task-boundaries.md`) — don't fold it
   into an unrelated feature branch.
