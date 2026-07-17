# Milestone completion record

## Milestone 1 — HTML Slide MVP

**Status: complete**, verified inside the pnpm workspace. `rvs init → inspect →
brief → create slides → validate --ci → export pdf` runs end-to-end,
self-hosted against this repository, with zero overflow/contrast/evidence
failures and a paginated PDF produced from the rendered deck.

Fully verified inside the workspace:

- Repository inspection
- Evidence extraction
- Audience-aware brief generation
- HTML slide generation
- CI validation
- PDF export
- Deterministic evidence identifiers
- Stable content hashing
- Offline execution after Playwright browser installation

### Known Limitation — External CLI Packaging

The Milestone 1 CLI is fully functional inside the repository's pnpm
workspace, but it is not yet installable as a standalone npm package.

A packaged-install test was performed using:

```
pnpm --filter @rvs/cli pack
npm install /path/to/rvs-cli.tgz
```

Installation in a clean temporary repository failed because the packed CLI
retains unresolved monorepo assumptions.

**Confirmed packaging gaps**

1. **Workspace dependencies.** The CLI package contains dependencies using
   the `workspace:*` protocol, including `@rvs/core`. These dependencies
   are resolvable inside the pnpm workspace but cannot be resolved by npm
   when the CLI tarball is installed independently.

   Observed failure:

   ```
   npm error 404 Not Found - GET https://registry.npmjs.org/@rvs%2fcore
   ```

2. **No distributable build output.** The CLI `bin` field currently points
   to `src/bin.ts`. The package does not yet produce a compiled `dist/`
   entry point. A standalone installation would therefore require a
   TypeScript runtime such as `tsx`, which is not currently included as a
   production dependency and should not be required for a published CLI.

3. **Monorepo-relative asset resolution.** The CLI currently resolves
   `DESIGN_SYSTEMS_ROOT` relative to its location inside the repository.
   That path assumption works in the monorepo but would fail once the CLI
   is installed under another repository's `node_modules` directory or
   globally.

**Scope decision**

These gaps were not fixed during Milestone 1 because standalone package
distribution was explicitly deferred to the later packaging milestone.

Resolving them requires a coordinated packaging design rather than a small
patch, including:

- A production build process
- Compiled or bundled CLI output
- Publishable dependency versioning or package bundling
- Inclusion and resolution of runtime assets
- A package-content allowlist
- Clean-install and global-install testing
- Version compatibility between the CLI, internal packages, schemas,
  skills and design systems

**Milestone 1 status impact**

This limitation does not invalidate the Milestone 1 North Star proof. All
of the functional verification listed above remains fully verified inside
the workspace. Standalone npm installation must remain documented as
unsupported until the packaging work is completed.

Resolved by: [Packaging Hardening Interlude](#packaging-hardening-interlude) below.

## Milestone 2 (slice 1) — Workflow and Architecture Engine

**Status: complete** for the scoped slice (GitHub Actions workflows only).
See [`docs/workflow-engine.md`](workflow-engine.md) for the full design.
Verified end-to-end in the workspace: `rvs create workflow --all --renderer
both` → `rvs create slides` → `rvs validate --ci` (0 failures, 0 warnings)
→ `rvs export pdf`. Terraform, generic source-code architecture extraction,
and repository dependency mapping remain out of scope, deferred to future
slices that reuse the same `WorkflowGraph`-shaped contract.

Milestone 2 inherits Milestone 1's packaging limitation unchanged — the new
`@rvs/workflow-graph`, `@rvs/workflow-mermaid`, and `@rvs/workflow-svg`
packages are additional internal workspace packages, which only makes the
eventual packaging problem larger if left unaddressed before further
adapters are added.

## Packaging Hardening Interlude

**Status: complete.** `@rvs/cli` now installs and runs as a standalone npm
package outside the pnpm workspace. All 13 acceptance criteria below are
verified. Completed before Terraform/topology work, per the scope decision
recorded in the Known Limitation above.

### 1. Distribution model selected and rationale

**Bundling**, not multi-package publishing. All internal `@rvs/*` packages
are compiled straight into a single `dist/bin.cjs` via esbuild, so a
consumer of `@rvs/cli` never resolves `workspace:*` or any `@rvs/*`
dependency — after the build, there aren't any. `playwright` is the one
exception: kept external and a real npm dependency, because it manages its
own browser-binary download logic keyed to its own package location, and
bundling it would fight that rather than help it (and the spec explicitly
forbids bundling browser binaries).

This was the user-stated preferred default ("bundle the internal runtime
into the CLI unless there is a strong reason to publish every internal
package independently"), and an audit of all 10 internal packages'
dependency graphs confirmed every third-party transitive dependency
(commander, yaml, zod, fast-glob, mdast-util-to-string, remark-parse,
unified, unist-util-visit, simple-git) is pure JS and bundle-safe.

### 2. Build tool and output structure

`esbuild`, driven by a plain Node script (`packages/cli/scripts/build.mjs`,
not itself bundled — it runs directly under Node before any bundle exists).
The script:

- wipes and recreates `dist/` and `assets/`
- bundles `src/bin.ts` → `dist/bin.cjs` (CJS, `target: node20`, `bundle:
  true`, `sourcemap: true`, `external: ["playwright"]`)
- copies `design-systems/` → `assets/design-systems/` and
  `skills/repo-visual-studio/` → `assets/skills/repo-visual-studio/`

CJS output (not ESM): several bundled CJS dependencies (e.g. `yaml`'s CJS
build) contain interop-only `require("process")`-style calls that esbuild
cannot statically resolve when targeting ESM output, and throw at runtime
("Dynamic require ... is not supported"). CJS output lets esbuild pass
those requires through natively. The `.cjs` extension forces Node to parse
the file as CommonJS regardless of the package's own `"type": "module"`.

`node scripts/build.mjs` is deterministic and reproducible — re-running it
against unchanged source produces byte-identical output apart from the
sourcemap's embedded absolute paths.

### 3. Package manifest changes

`packages/cli/package.json`:

- `bin.rvs`: `src/bin.ts` → `dist/bin.cjs`
- added `"engines": { "node": ">=20" }`
- added `"files": ["dist/**", "assets/**", "README.md"]`
- added `"build": "node scripts/build.mjs"` script
- `dependencies` reduced to `{ "playwright": "^1.48.0" }` only
- all `@rvs/*` packages, `commander`, `esbuild`, `typescript`,
  `@types/node` moved to `devDependencies`

### 4. Internal dependency handling

Internal `@rvs/*` packages moved from `dependencies` to `devDependencies`.
pnpm still creates workspace symlinks for `devDependencies`, so `tsx`-based
dev mode and `tsc --noEmit` typecheck are unaffected. But `npm install
<tarball>` — a consumer installing this package as *their* dependency —
never installs another package's `devDependencies`, so the effective
published runtime dependency list is just `playwright`. Verified by
extracting the packed tarball's `package.json` directly: its
`dependencies` field contains no `workspace:*` string and no `@rvs/*` key.

### 5. Runtime asset-resolution design

`packages/cli/src/paths.ts` resolves assets relative to the running
module's own directory (via a new `module-dir.ts` helper), not the
monorepo layout:

- `DESIGN_SYSTEMS_ROOT` checks for a packaged copy at
  `<module-dir>/../assets/design-systems` first (populated only by the
  build script, shipped inside the npm tarball); falls back to the
  monorepo root's `design-systems/` when running unbuilt in dev (`tsx`
  running `src/bin.ts` directly, no `assets/` dir present).
- `RVS_INSTALL_ROOT` is one level up from the running module — the
  `@rvs/cli` package's own root, correct both in-monorepo
  (`packages/cli`) and once installed under a consumer's
  `node_modules/@rvs/cli`.

`module-dir.ts` provides a `moduleDir(importMetaUrl)` helper that works in
both module systems the CLI actually runs under: dev-mode `tsx` (ESM,
`import.meta.url` available, no `__dirname`) and the compiled CJS bundle
(`__dirname` available natively via esbuild's CJS shim, `import.meta.url`
becomes an empty object and throws if passed to `fileURLToPath`). It probes
with `typeof __dirname !== "undefined"`, which never throws in either
module system.

### 6. Tarball contents

`npm pack --dry-run` (run from `packages/cli/`) reports exactly 15 files,
717 KB packed / 3.6 MB unpacked:

```
assets/design-systems/**  (7 files: 3 packs × {tokens.json, preview.md} + index.json)
assets/skills/repo-visual-studio/**  (4 files: SKILL.md, 2 references, generated JSON schema)
dist/bin.cjs
dist/bin.cjs.map
package.json
README.md
```

No source `.ts` files, no test fixtures, no `.rvs/cache`, no monorepo-only
config, no dev caches, no credentials, no Playwright browser binaries.

### 7. Clean-install results

`pnpm --filter @rvs/cli pack` → `npm install <tarball>` in a fresh scratch
repo (`git init && npm init -y && npm install <tgz>`) succeeded with 0
vulnerabilities, 3 packages added (the CLI plus its 2 transitive
dependencies of `playwright`). Full pipeline run via `npx rvs` from that
scratch repo:

```
npx rvs --version    → 0.1.0
npx rvs doctor        → correct version/paths/schema info, asset path under
                         node_modules/@rvs/cli/assets, Chromium launches
npx rvs init           → wrote .rvs/config.yml
npx rvs inspect        → scanned repo, wrote cache
npx rvs brief           → wrote narrative-brief.yml
npx rvs create slides   → rendered 8 scenes to deck.html
npx rvs create workflow --all --renderer both
                        → warned "no workflow files found" (expected —
                          empty fixture repo), did not crash
npx rvs validate --ci   → ran the check; exited 1 on the same sparse-
                          fixture missing-evidence warning already known
                          from Milestone 2's own fixture verification —
                          not a packaging defect
npx rvs export pdf      → exported 8-page PDF
```

### 8. Project-level install results

Same as above (`npm install` without `-g`, from within the consumer
project) — this *is* the clean-install workflow tested in item 7, since a
non-global `npm install <tarball>` is a project-level install by
definition.

Additionally re-tested from an install directory whose path contains a
space (`/tmp/rvs package test with spaces/`): install, `doctor`, `init`,
`inspect`, `brief`, `create slides`, `create workflow`, `validate --ci`,
and `export pdf` all completed correctly, with `doctor` correctly reporting
the space-containing install and asset paths.

### 9. Global-install results

Tested via `npm install -g <tarball> --prefix <isolated-prefix>` (isolated
prefix used instead of the machine's real global prefix, to avoid touching
shared state). The `rvs` bin resolved on `PATH`, `rvs doctor` reported the
correct `lib/node_modules/@rvs/cli` install path and matching asset path,
and a full `init → inspect → brief → create slides → validate --ci →
export pdf` run against a fresh directory succeeded (8-page PDF exported).

### 10. Full slide and workflow pipeline results

Both the Milestone 1 slide pipeline and the Milestone 2 workflow pipeline
were exercised from the installed tarball in every environment above
(clean project install, spaces-in-path install, global install):
`create slides` and `create workflow --all --renderer both` both ran
without crashing; `create workflow` correctly detected the absence of
`.github/workflows/` in these minimal fixtures and warned rather than
failing. `validate --ci` and `export pdf` both function identically to the
workspace-run CLI.

### 11. Offline verification

Re-ran the pipeline (`create slides` → `validate --ci` → `export pdf`)
against the installed tarball with `HTTP_PROXY`/`HTTPS_PROXY` pointed at an
unreachable local port (`127.0.0.1:1`, nothing listening). All steps
succeeded identically to the unpoisoned run, confirming no code path in the
compiled distribution attempts an HTTP/HTTPS request — offline behavior is
unchanged from the source workspace.

### 12. Compatibility results for Milestones 1 and 2

Both milestones' full pipelines pass unmodified from the packaged
distribution (see items 7–10). `rvs doctor` in the packaged distribution
reports the same `VisualDoc schema version: 1` and
`WorkflowGraph schema version: 1` as the workspace source, confirming
schema compatibility travels correctly into the bundle. A byte-for-byte
comparison of `deck.html` generated from the same fixture repo by (a) the
dev-mode `tsx` CLI and (b) the packaged tarball CLI, normalizing only the
wall-clock `generated_at`/`data-generated-at` timestamp fields, produced
**identical output** (same `content_spec_hash`, same SHA-256 after
normalization) — satisfying the "source workspace and packaged
distribution produce equivalent deterministic artifacts" acceptance
criterion.

Existing workspace test suite: 149 tests passed, 0 failed (plus 4 new
package-level tests, skipped by default — see item below). Workspace
typecheck (`pnpm -r run typecheck`, all 11 packages including `cli`):
clean, 0 errors.

Version/compatibility metadata (`rvs doctor` output): CLI version, Node
version + OS/arch, install path, asset path, design-systems-found status,
VisualDoc schema version, WorkflowGraph schema version, `.rvs/config.yml`
presence, and Playwright/Chromium launch check. Versioning relationship:
the CLI version, VisualDoc schema version, and WorkflowGraph schema
version are independent counters — a schema version only increments when
its shape changes in a way that breaks older readers, not on every CLI
release, so most CLI patch/minor releases require no schema bump at all.
Design-system packs and the agent skill each carry their own `version`
field (`design-systems/index.json` per-pack, `skills/repo-visual-studio/
SKILL.md` frontmatter) for the same reason — they evolve independently of
the CLI's own version.

An automated package-level test suite was added at
`packages/cli/src/__tests__/package-smoke.test.ts`, covering: `pnpm pack`,
tarball installation into a clean temp directory (whose name contains a
space), `rvs doctor` asset-resolution-outside-the-monorepo assertions,
the full `init → inspect → brief → create slides → validate → export pdf`
pipeline, a Chromium-available/unavailable branch for `export pdf`
(asserting a clear failure message rather than a crash when Chromium is
missing), and a no-crash assertion for `create workflow` against a
workflow-less fixture. It exercises the packed tarball via `npx rvs` in a
scratch temp directory, never the workspace source directly. Because it performs
a real build, a real npm install, and a real Playwright PDF export, it is
gated behind `RVS_TEST_PACKAGE=1` and skipped by default so the fast
`pnpm test` loop used by every other package is unaffected — confirmed via
a plain `pnpm test` run showing `4 skipped` and all 149 other tests still
passing.

### 13. Remaining limitations

- The global-install test used an isolated `npm --prefix` sandbox rather
  than the machine's real global npm prefix, to avoid mutating shared
  system state without being asked; behavior should be identical, but the
  literal system-wide `npm install -g` path is untested.
- The package-level test suite is opt-in (`RVS_TEST_PACKAGE=1`), not part
  of the default `pnpm test` run or (not yet configured) any CI workflow —
  wiring it into CI as an explicit separate job is future work.
- `npm pack --dry-run`'s file list was inspected manually, not asserted in
  the automated test suite; a regression there (e.g. an accidentally
  broadened `files` glob) would not yet be caught automatically.
- Publishing to a real npm registry was not attempted or configured (no
  `publishConfig`, no CI publish step) — this milestone only proves the
  tarball is installable, not that a `npm publish` flow exists.

### 14. Confirmation nothing was committed

`git status --short` shows the same untracked-only state as before this
work began — no commits were made at any point during the packaging
hardening work, per the explicit "Nothing is committed unless explicitly
requested" acceptance criterion.

## Packaging Hardening Milestone — Standalone RVS CLI Distribution

**Status: complete.** A second, follow-on hardening pass on top of the
[Packaging Hardening Interlude](#packaging-hardening-interlude) above. That
interlude proved the tarball is installable and runnable; this milestone
closes the gaps it explicitly left open: no monorepo/workspace
auto-detection for `rvs init` run against a multi-package repo, no
machine-readable way for an agent to locate the packaged skill directory,
no hardened default excludes for common secret-bearing file patterns, no
automated comparison proving source-mode and packaged-mode output are
identical (item 12 above only asserted this for `deck.html`, manually), and
no single up-to-date reference doc for the whole distribution design. All
of Section 1's stable interfaces (VisualDoc, WorkflowGraph, evidence-
reference format, deterministic IDs, `content_spec_hash`, CLI
commands/options, validation-report schema, workflow warning codes,
Mermaid/SVG semantics, design systems, self-hosting flow, offline
behavior, M1/M2 fixtures) were preserved unchanged — no packaging blocker
required touching any of them.

### 1. Monorepo/workspace auto-detection for `rvs init`

New `packages/core/src/workspace.ts`: `detectWorkspace(repoRoot)` reads
`pnpm-workspace.yaml`, `package.json#workspaces` (array or `{packages}`
form, with `yarn.lock` presence distinguishing Yarn from npm workspaces),
falls back to `single-package` for anything else (including a malformed
`package.json`, handled without throwing). `workspaceSourcePatterns()`
expands detected package globs into `<glob>/package.json` +
`<glob>/src/**` include patterns and `**/node_modules/**` /
`**/dist/**` excludes, layered on top of (never replacing) the existing
single-package defaults. `defaultConfig(projectName, workspace?)` gained an
optional second parameter — omitting it reproduces the exact prior output
byte-for-byte (backward-compatibility asserted with an exact-array test).
`rvs init` (`packages/cli/src/commands/init.ts`) now calls
`detectWorkspace` and logs which kind was detected and what was added to
`sources.include`/`sources.exclude`, or explicitly logs that no workspace
manifest was found. 11 unit tests cover single-package, pnpm (with and
without an explicit `packages:` field), npm, Yarn, negated-glob handling,
and the malformed-manifest fallback
(`packages/core/src/__tests__/workspace.test.ts`), plus a packaged-CLI
integration test that runs `rvs init` from outside the monorepo against a
nested pnpm-workspace fixture and asserts on both the log output and the
written `.rvs/config.yml`.

### 2. Extended `rvs doctor` and `rvs skill path`

`rvs doctor` gained: installation type (`packaged` vs. `workspace-source`,
by checking for a packaged `assets/` directory next to the install root),
the CLI executable path (`process.argv[1]`), the resolved package root,
the current working directory, and the detected repository root (walking
up from `cwd` looking for `.git`, returning "not inside a git repository"
rather than throwing if none is found) — alongside the asset/schema/skill
paths and Playwright/Chromium checks that already existed. A new
`SKILLS_ROOT`/`SCHEMAS_ROOT` pair in `packages/cli/src/paths.ts` follows
the same packaged-vs-monorepo-fallback pattern as `DESIGN_SYSTEMS_ROOT`.
`rvs skill path` (new `packages/cli/src/commands/skill.ts`) prints just the
resolved skill directory, or throws (non-zero exit) if it's missing — for
scripts or agents that need to locate the packaged skill programmatically
without parsing `doctor`'s full output. Reading the Playwright package
version from inside a doctor check required a new `isomorphicRequire()`
helper in `doctor.ts` (`typeof require !== "undefined" ? require :
createRequire(importMetaUrl)`), mirroring the existing `moduleDir()`
isomorphic-probe pattern — `createRequire(import.meta.url)` alone breaks
once esbuild bundles to CJS, where `import.meta.url` is a dead reference.

### 3. Hardened default source excludes

`DEFAULT_EXCLUDE` in `packages/core/src/config.ts` extended with `.env`,
`.env.*` (deliberately including `.env.example` — a repo can re-include it
via `sources.include` if it's genuinely useful evidence, but the
out-of-the-box default must never risk treating a same-named real secrets
file as safe because a benign-looking sibling exists), `**/*.pem`,
`**/*.key`, `**/*.p12`, `**/*.pfx`, `.aws/credentials`, `.rvs/cache/**`,
and `artifacts/**` (excluding the tool's own generated output and cache
from being re-scanned as if it were source evidence). A new integration
test (`packages/repository-model/src/__tests__/security-exclusions.test.ts`)
builds a real fixture repo containing non-dot-prefixed secret-like
filenames (`src/certs/server.pem`, `src/keys/id.key` — chosen specifically
so the assertions exercise the new exclude patterns themselves, not
`fast-glob`'s separate `dot: false` hidden-file behavior which already
blocks dot-prefixed paths like `.env` for free) and asserts they never
appear in `buildRepositoryModel()`'s scanned file list, alongside
`.rvs/cache/**` and `artifacts/**` content.

### 4. Automated source-vs-package structural equivalence

Item 12 of the interlude above proved deck.html equivalence once, by hand.
This milestone adds a permanent automated test,
`packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` (gated
behind `RVS_TEST_PACKAGE=1`, like the existing package-smoke suite): builds
one canonical fixture repo (fixed `package.json` name, a real multi-job
GitHub Actions workflow, git-initialized and committed once), copies it
byte-for-byte — including `.git` — into two install roots so both runs
scan identical content and produce an identical `git_commit` stamp, then
runs the full `init → inspect → brief → create workflow --all --renderer
both --format visualdoc → create slides` pipeline once via the workspace
source (`tsx` against `packages/cli/src/bin.ts`) and once via the packaged
tarball (`npx rvs` from an `npm install`ed copy). It then compares, field
by field: `.rvs/config.yml` (byte-identical), `repository-model.json` and
`evidence-manifest.json` (deep-equal after stripping the legitimately
run-specific `generated_at` timestamp and, for the model, the absolute
`repo_root` path), `narrative-brief.yml`, `workflow-graphs.json`, the
rendered `.mmd`/`.svg`/`.visualdoc.json` workflow artifacts, and the cached
`visualdoc.json` (all byte-identical — none of these carry timestamps), and
finally `deck.html`'s `content_spec_hash`, `git_commit` stamp, and the full
ordered list of rendered scene IDs (extracted via regex, since the HTML as
a whole differs only in its own `generated_at` attribute). **Passed on
first real run** (`RVS_TEST_PACKAGE=1 npx vitest run
packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` — 1/1).

### 5. Extended package-smoke test

`packages/cli/src/__tests__/package-smoke.test.ts` was extended with: a
richer fixture (`package.json`, `README.md`, `src/index.ts`,
`docs/architecture.md`, and this repo's own `.github/workflows/ci.yml`
reused verbatim, replacing the near-empty prior fixture), the full doctor
field set added in item 2 above asserted against real packaged output, a
`--format visualdoc` assertion on `rvs create workflow`'s output files, a
new test that runs `rvs init` against a nested pnpm-workspace fixture from
outside the monorepo and asserts on the detection log and written config,
and workflow-graph-cache assertions (`graph.nodes.length >= 5`,
`graph.edges.length > 0`, matching the real 5-job `ci.yml`). Two assertions
had to be corrected against real output during verification: `process.
argv[1]` for an `npx`-invoked bin resolves through the `node_modules/
.bin/rvs` symlink, not into `@rvs/cli`'s own directory (only "Package
root" — derived from the running module's own file location — points
inside `@rvs/cli`); and `mkdtempSync(tmpdir())` on macOS returns a
`/var/...` path that the OS transparently resolves to `/private/var/...`,
so the install-directory comparison had to go through `realpathSync`
first. All 5 tests pass (`RVS_TEST_PACKAGE=1 npx vitest run
packages/cli/src/__tests__/package-smoke.test.ts`).

### 6. Full clean-install pipeline — exact counts

A dedicated clean-install run (fresh temp directory outside the monorepo,
name containing a space, `git init && npm init -y && npm install
<tarball>`, no reuse of any workspace `node_modules`), against a fixture
with a README, one TypeScript source file, an architecture doc, and this
repo's own real 5-job `.github/workflows/ci.yml`:

```
npm install <tarball>          → added 3 packages, 0 vulnerabilities
npx rvs --version               → 0.1.0
npx rvs doctor                  → Installation type: packaged; all asset/
                                   schema/skill paths resolved under
                                   node_modules/@rvs/cli/assets; Playwright
                                   package available (v1.61.1); Chromium
                                   launches successfully
npx rvs init                     → wrote .rvs/config.yml (single-package)
npx rvs inspect                  → Scanned 5 files, extracted 4 evidence
                                    claims
npx rvs brief --audience architecture-review
                                  → wrote narrative-brief.yml
npx rvs create workflow --all --renderer both --format visualdoc
                                  → Parsed 1 workflow(s) (0 errors, 6
                                    warnings — matrix collapse, step-detail
                                    collapse, 4 label-truncation warnings,
                                    all expected at "jobs" detail level);
                                    cached 1 workflow graph
npx rvs create slides             → Rendered 10 scenes to deck.html using
                                     "executive-dark"
npx rvs validate --ci             → Validated 10 scenes: 40 passed, 0
                                     failed, 0 warnings
npx rvs export pdf                → Exported 10-page PDF to deck.pdf
npx rvs skill path                → resolved to node_modules/@rvs/cli/
                                     assets/skills/repo-visual-studio
```

`deck.html` (26,381 bytes) and `deck.pdf` (110,393 bytes) were both
produced. Verified: no absolute monorepo filesystem path appears anywhere
in `deck.html` (the one substring match for "repo-visual-studio" is
literal fixture README content, correctly cited as evidence — not a path
leak); the only external-URL-shaped string in the whole deck is the
standard `http://www.w3.org/2000/svg` XML namespace attribute (not a
network fetch); no AWS-key or private-key-block pattern appears anywhere
under `.rvs/` or `artifacts/`.

### 7. Full workspace re-verification after all changes

`pnpm -r exec tsc --noEmit` across every package: clean, 0 errors.
`pnpm test`: **163 tests passed, 0 failed**, 21 test files run, 2 files (6
tests) correctly skipped by default (`package-smoke.test.ts` and the new
`source-vs-package-equivalence.test.ts`, both gated behind
`RVS_TEST_PACKAGE=1`) — both of those gated suites were independently run
and confirmed passing in items 4 and 5 above.

### 8. Confirmation nothing was committed

`git status --short` at the end of this milestone shows 13 untracked
top-level entries and zero commits (`git log` reports "your current branch
'main' does not have any commits yet") — the same state as before this
work began, per the explicit "Do not commit changes" instruction.

### 9. Remaining limitations

Unchanged from the interlude's item 13 above, plus:

- Workspace auto-detection covers pnpm, npm, and Yarn classic workspace
  manifests; it does not attempt to detect Lerna-only or Nx-only
  monorepos that don't also declare a `workspaces` field.
- `rvs skill path` reports where the packaged skill directory is; it does
  not install, copy, or register it into any agent tool's skill directory
  — that remains explicitly out of scope (`rvs agent install` is not
  implemented).
- The source-vs-package equivalence test's fixture uses a single,
  non-workspace repo with one workflow file; it does not separately
  re-verify equivalence for a multi-workflow or workspace-detected
  fixture, though the underlying rendering/hashing code paths are the same
  ones already covered.

## Milestone 2 Slice 2 — Terraform Topology Engine: Complete

**Status: complete.** The Terraform topology engine — `TerraformTopology`,
its two-pass declare/link builder, expression classification, Mermaid/SVG
renderers, and layout/evidence/divergence validation — was already
implemented prior to this closure pass; this milestone entry records the
coverage and documentation closure work that verified it against the full
22-scenario fixture matrix, proved it end to end via a self-hosted example,
re-confirmed it inside the packaged CLI distribution, and brought its
documentation in line with `docs/workflow-engine.md`'s bar. See
[`docs/terraform-topology.md`](terraform-topology.md) for the full design.

### 1. Fixture matrix coverage

All 22 required scenarios are represented as focused, single-behavior
fixtures under
`packages/terraform-graph/src/__tests__/fixtures/`: single AWS resource,
explicit `depends_on`, resource-reference expression, data-source
consumption, local module call, remote/opaque module call, multiple
provider aliases, variables/outputs, a sensitive variable, dynamic
`for_each`, a dynamic provider expression, a module input referencing a
resource, an output referencing a module, multiple independent root
modules, a large topology requiring scene splitting, invalid HCL, an
unsupported top-level block, a checked-in `.tfstate`/`.tfstate.backup`/
`.tfplan` (all ignored), a `.terraform/` cache directory (ignored even
though it contains a `.tf` file), a Databricks provider example,
cross-platform nested paths, and a repository path containing spaces.
`packages/terraform-graph/src/__tests__/fixture-matrix.test.ts` adds **42
tests** across 22 `describe` blocks mapping 1:1 to these scenarios, all
passing alongside the pre-existing `topology.test.ts` (23 tests).

### 2. A genuine defect found and fixed

Writing the "unsupported block" fixture surfaced a real gap:
`TERRAFORM_UNSUPPORTED_BLOCK` was declared in `TerraformWarningCode` but
never emitted — an unrecognized top-level HCL block (e.g. `moved`,
`import`, `check`) was silently ignored rather than surfaced. Per this
milestone's "do not redesign unless a closure test reveals a genuine
defect" constraint, this was judged in-scope and fixed minimally: a
`KNOWN_TOP_LEVEL_BLOCK_KEYS` set plus a warning push for any other
top-level key, added only to the declare pass
(`packages/terraform-graph/src/topology.ts`). Verified regression-free
against every pre-existing fixture and test.

### 3. Self-hosting example

`examples/terraform/self-hosting/` is a small, synthetic, non-deployable
Terraform root module composed to exercise every construct class the
engine supports in one readable tree: one provider, one data source, one
explicit `depends_on`, static resource-to-resource references, one local
child module (fully resolved), one remote registry module (intentionally
opaque), one sensitive variable, one intentionally dynamic expression
(`count = var.environment == "demo" ? 1 : 0`), and one output — documented
in its own [README](../examples/terraform/self-hosting/README.md). It is
excluded from ordinary `rvs inspect` scans without any new code:
`rvs inspect`'s evidence scanner has no Terraform adapter at all, and the
example's path isn't in `.rvs/config.yml`'s `sources.include` globs — it
is only ever included when a `rvs create topology` invocation names or
discovers it directly.

### 4. Self-hosting pipeline proof

With `.rvs/cache/` and `artifacts/` cleared first, the full pipeline
(`init` → `inspect` → `brief` → `create workflow --all --renderer both` →
`create topology --source examples/terraform/self-hosting --renderer both
--format visualdoc` → `create slides` → `validate --ci` → `export pdf`)
ran end to end inside the workspace with exit code 0 at every step.
Extracted topology: **18 nodes, 38 edges**, 8 resources, 1 data source, 1
provider, 4 variables, 1 output, 2 modules (root + 1 local child), 1
external/opaque module, 3 informational warnings
(`TERRAFORM_SENSITIVE_VALUE_REDACTED`, `TERRAFORM_DYNAMIC_EXPRESSION`,
`TERRAFORM_REMOTE_MODULE_OPAQUE`) — 0 errors. The sensitive variable's
default value (`example-not-a-real-secret`) was confirmed absent from the
topology cache, the `.mmd`, the `.svg`, and the `.visualdoc.json` output
(`grep -c` returned 0 in all four). `rvs create slides` rendered 12 scenes;
`rvs validate --ci` passed all 48 checks with 0 failures and 0 warnings;
`rvs export pdf` produced a 12-page, ~147 KB PDF.

### 5. Packaged CLI re-proof

`RVS_TEST_PACKAGE=1 pnpm test` — which independently packs the CLI,
installs it into a clean temporary repository, and runs the full
init→inspect→brief→workflow→topology→slides→validate→export pipeline plus
a source-vs-package structural equivalence check — passed **6/6** tests. As
a supplementary manual proof, the tarball was also installed into a
project-local `node_modules` under an install path containing spaces
(`pkg dir with spaces/`) and run by hand against a small target repo
containing one Terraform file and one GitHub Actions workflow: `rvs doctor`
reported installation type `packaged`; the full pipeline completed with 0
errors, 0 warnings, 48/48 validation checks passed, and a 12-page PDF.
Confirmed in the installed package: no `workspace:*` dependency remains in
`node_modules/@rvs/cli/package.json`'s `dependencies` (only
`@cdktf/hcl2json` and `playwright`); no TypeScript runtime dependency ships
(`typescript` only appears under `devDependencies`, which npm does not
install for a consumer); the only "repo-visual-studio" strings inside the
compiled `dist/bin.cjs` are the packaged asset directory name
(`skills/repo-visual-studio`) and a doctor-mode fallback path resolved at
runtime relative to the CLI's own location — not a baked-in absolute
monorepo path. No network requests occurred during the pipeline run.

### 6. Documentation

- [`docs/terraform-topology.md`](terraform-topology.md) (new): purpose,
  pipeline, parser selection rationale (`@cdktf/hcl2json`, WASM runtime,
  packaging externalization, offline behavior), root-module discovery, the
  full `TerraformTopology` contract, static-reference extraction rules,
  local-vs-remote module handling, security/redaction behavior, the
  `topology` VisualDoc scene, both renderers, large-topology splitting, the
  complete warning-code table, tested known limitations, and the extension
  path for a future repository-dependency-mapping adapter.
- Root [`README.md`](../README.md): Milestone 2 intro now covers both
  slices; workspace and standalone-tarball command examples include
  `create topology`; a new "Terraform topology" subsection documents
  supported constructs, explicit limitations, security behavior, outputs,
  and the `@cdktf/hcl2json` packaging note; the "Self-hosting" section and
  "Repository layout" tree were updated to include the new packages and
  example; "Current limitations" no longer falsely claims Terraform
  topology doesn't exist.

### 7. Full workspace re-verification

`pnpm -r exec tsc --noEmit`: clean, 0 errors. `pnpm test`: **270 tests
passed, 0 failed, 6 skipped** (26 of 28 test files; the 2 skipped files are
the `RVS_TEST_PACKAGE`-gated packaging suites, independently confirmed
passing below). `RVS_TEST_PACKAGE=1 pnpm test`: **276 tests passed, 0
failed** across all 28 test files, including the newly-added
`fixture-matrix.test.ts` (42 tests) and the pre-existing
`topology.test.ts` (23 tests) — zero regressions introduced anywhere in
the workspace by this closure work.

### 8. Confirmation nothing was committed

`git diff --check` reported no whitespace errors (exit 0). `git status
--short` shows the same **13 untracked top-level entries** as the prior
milestone's verification (`.github/`, `.gitignore`, `.rvs/`, `README.md`,
`design-systems/`, `docs/`, `examples/`, `package.json`, `packages/`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `skills/`,
`tsconfig.base.json`) — `artifacts/` and `.rvs/cache/` stay correctly
excluded by `.gitignore` even after this segment's repeated pipeline runs.
`git log --oneline` still reports that branch `main` has no commits.
Nothing was committed during this closure pass, per the explicit
instruction.

### 9. Remaining limitations

Unchanged from the interlude's item 13 and the prior milestone's item 9
above (Terraform-specific limitations are documented in full in
[`docs/terraform-topology.md`](terraform-topology.md#known-limitations)),
plus two spec-vs-implementation gaps identified and deliberately left
alone rather than "fixed" (fixing either would mean redesigning the CLI or
narrative planner, which this milestone's governing instructions
explicitly forbid absent a genuine defect):

- `rvs create topology` has no `--type` flag — root-module selection is via
  `--source <dir>` or `--all` only, with root/child classification handled
  automatically by `classifyRootModules`.
- The narrative planner's actual scene sequence for this repository's
  current content is a fixed, content-driven sequence of title,
  section-divider, headline, architecture, metric, workflow, and topology
  scenes — not a fixed catalog of dedicated categories per source type.
  Every generated scene still carries full evidence traceability; the
  sequence simply reflects what narrative sections the deterministic brief
  builder actually populates for a given repository's content, the same
  behavior the workflow slice already relies on.

## Milestone 3 — Architecture Intelligence Engine

**Status: complete, within the milestone's explicitly bounded scope.** The
Architecture Intelligence Engine — `@rvs/architecture-intelligence`'s pure
synthesis pipeline, its `ArchitectureIntelligence` contract, six narrative
profiles, the `architecture-intelligence` VisualDoc scene and its
renderer-html templates, `rvs synthesize architecture`, and two new tiers of
validator checks (9 structural codes + 5 rendered-output codes, 14 total) —
converts the `RepositoryModel`/`WorkflowGraph[]`/`TerraformTopology[]`
evidence Milestones 1-2 already produce into a coherent, audience-aware,
four-level architecture narrative, never lowering the level of evidence
behind a raised level of abstraction: every synthesized statement carries an
inference class (`confirmed`/`derived`/`suggested`/`unresolved`), and
`suggested`/`unresolved` claims are rendered with an explicit "Likely" /
"Unconfirmed" qualifier rather than presented as fact. Model-assisted
synthesis (`--assist`) was explicitly out of scope and was not built — every
narrated statement is deterministic, rule-based synthesis. See
[`docs/architecture-intelligence.md`](architecture-intelligence.md) for the
full design.

### 1. Fixture and unit-test coverage

`packages/architecture-intelligence/src/__tests__/` covers the synthesis
pipeline (`synthesize.test.ts`, 16 tests, including confirmed/derived/
suggested/unresolved classification, capability-domain grouping, and
outcome quantification refusing to fabricate numbers without evidence),
label normalization (`label.test.ts`, 9 tests), workflow-family synthesis
(`workflow-families.test.ts`, 4 tests), deterministic ID generation
(`ids.test.ts`, 4 tests), and the shared `collectStatements`/qualifier
helpers (`inference.test.ts`, 5 tests) — 38 tests in the core package alone,
all against hand-built deterministic fixtures, no model dependency anywhere.
`packages/narrative-planner/src/__tests__/architecture-visualdoc-builder.test.ts`
(10 tests) covers all six profiles' scene sequencing.
`packages/renderer-html/src/__tests__/architecture-intelligence-scene.test.ts`
(4 tests) covers the new scene templates.
`packages/validator/src/__tests__/architecture-intelligence-checks.test.ts`
(16 tests) covers all 5 Tier 2 codes; the existing `validate-structure.ts`
Tier 1 codes were already covered by `synthesize.test.ts`'s assertions on
the synthesized artifact's `metadata.confidence_summary` and per-entity
evidence.

### 2. Defects found and fixed

A flow-ID collision was found and fixed during the self-hosting proof
against `looker-admin-repo` (surfaced only once synthesis ran against a
real repository with many workflows sharing similar trigger/job shapes, not
against the smaller unit-test fixtures) — flow IDs are now derived from a
collision-resistant composite key rather than a name-only slug. No other
genuine defects were found during this closure pass; one factual
inaccuracy was found and corrected in this closure's own documentation
draft before it was finalized (see §6), which is a documentation-process
correction, not a product defect.

### 3. Self-hosting example and comparison

`rvs create slides --profile architecture-review` was run against a real
external repository clone (`looker-admin-repo`, an internal Looker
administration platform with 65 checked-in GitHub Actions workflows) and
compared against the same repository's legacy `rvs create slides`
(`repository-inventory` profile) output:

| | `repository-inventory` (legacy) | `architecture-review` (new) |
| --- | --- | --- |
| Total scenes | 74 | 22 |
| Workflow diagram scenes | 65 (one per workflow, undifferentiated) | 11 (representative, grouped into capability domains) |
| Narrative scenes | title/headline/metric/section-divider only | 11 architecture-intelligence scenes (executive framing, system-context, logical-architecture, capability map, key flows, operating model, workflow-family map, outcomes, risks, evidence-confidence) |
| Evidence citations | present, per-scene | 66 `arch-evidence` citations, still resolving to real file paths/line ranges |

The 65 near-identical raw workflow diagrams collapse into 11 labeled
capability domains without losing traceability to any individual workflow —
directly the "raise the level of abstraction, never lower the level of
evidence" behavior the design mandate requires. A third, independently
hand-built "gold standard" comparison artifact was also reviewed; the
remaining stylistic gap versus that artifact was confirmed to be the
deferred `--assist` model-assisted synthesis path, not a defect in the
deterministic engine.

### 4. Self-hosting pipeline proof

Running the new Tier 2 checks against the `architecture-review` deck
produced exactly one warning —
`ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED` on the `outcomes` scene (153 words
against a 120-word budget) — a genuine, non-spurious finding. `rvs
validate`'s existing Playwright checks separately flagged `min-font-size`
(13.0px against a 14px floor) on two unrelated scenes: `boundary-map` (an
SVG diagram scene, dense with 11 capability domains' worth of boundary
nodes via the shared `renderBoxDiagram` grid layout) and
`evidence-confidence` (a CSS confidence-bar-and-legend scene, not a diagram
— its legend text shrinks independently). Both are pre-existing
rendering-density issues in `renderer-html`'s architecture-intelligence
scene templates, documented in "Remaining limitations" below rather than
fixed, since fixing either means redesigning the shared diagram/legend
layout code, out of scope for this milestone.

### 5. Packaged CLI re-proof

`RVS_TEST_PACKAGE=1 npx vitest run packages/cli` — which independently
packs the CLI, installs it into a clean temporary repository, and runs the
full init→inspect→brief→workflow→topology→slides→validate→export pipeline
plus a source-vs-package structural equivalence check — passed **6/6**
tests (`source-vs-package-equivalence.test.ts`, 1 test;
`package-smoke.test.ts`, 5 tests), confirming the new
`@rvs/architecture-intelligence` package and its CLI wiring
(`rvs synthesize architecture`, `rvs create slides --profile <id>`) survive
packaging with no `workspace:*` dependency leakage and no TypeScript
runtime dependency, matching the packaging guarantees established in
Milestone 2 Slice 2.

### 6. Documentation

- [`docs/architecture-intelligence.md`](architecture-intelligence.md)
  (new): design mandate, the full `ArchitectureIntelligence` contract, the
  synthesis pipeline module-by-module, all six narrative profiles, the
  `architecture-intelligence` VisualDoc scene and its rendering, both
  validator-check tiers with full warning-code tables, CLI usage, the
  self-hosting proof above, and known limitations. One factual
  inaccuracy in the first draft — misattributing both `min-font-size`
  failures to the same diagram-density cause — was caught during a
  source-code verification pass (re-checking the rendered HTML's
  `aria-label`s and `renderEvidenceConfidence()`'s actual implementation)
  and corrected before this entry was written, consistent with this
  milestone's instruction not to overstate findings.
- Root [`README.md`](../README.md): a new paragraph introducing Milestone
  3 in the intro; two new CLI walkthrough commands
  (`rvs synthesize architecture`, `rvs create slides --profile
  architecture-review`); a new "Architecture Intelligence" subsection
  mirroring the existing "Terraform topology" subsection's structure; the
  "Repository layout" package tree updated with
  `packages/architecture-intelligence/`; "Current limitations" updated
  with the new package's explicit scope boundary.

### 7. Full workspace re-verification

`pnpm -r exec tsc --noEmit`: clean, 0 errors. `npx vitest run`: **338
tests passed, 6 skipped** across 34 passed test files (2 skipped files are
the `RVS_TEST_PACKAGE`-gated packaging suites, independently confirmed
passing below) — includes every `@rvs/architecture-intelligence`,
architecture-intelligence-scene, and architecture-intelligence-checks test
file listed in §1, alongside every pre-existing Milestone 1/2 test, zero
regressions. `RVS_TEST_PACKAGE=1 npx vitest run packages/cli`: **6 tests
passed, 0 failed**.

### 8. Confirmation nothing was committed

Unlike Milestones 1-2's closure entries above, this milestone's work was
done on a dedicated branch on top of one pre-existing commit, not on a
zero-commit `main`: `git branch --show-current` reports
`feature/architecture-intelligence-engine`; `git log --oneline -5` shows a
single commit, `748b500 Initial commit: Milestone 1 MVP + Milestone 2
workflow/Terraform engines`, present before this milestone's work began.
`git status --short` shows **14 modified files** (existing package.json/
index.ts/schema.ts/bin.ts wiring plus `README.md` and `pnpm-lock.yaml`)
and **9 untracked entries** (`docs/architecture-intelligence.md`, the new
`packages/architecture-intelligence/` package, and the new
architecture-intelligence-specific files inside `cli`, `narrative-planner`,
`renderer-html`, and `validator`) — 23 changed/untracked entries in total,
all uncommitted. `git diff --check` reported no whitespace errors (exit
0). Nothing was committed during this closure pass, per the explicit
instruction.

### 9. Remaining limitations

Documented in full, with the same "tested, actual limitations, not
aspirational ones" framing as the milestones above, in
[`docs/architecture-intelligence.md#known-limitations`](architecture-intelligence.md#known-limitations).
In summary: no model-assisted synthesis (`--assist` was explicitly
deferred, not built); no new evidence adapters (Kubernetes, LookML, dbt,
OpenAPI, Databricks, Python AST, TypeScript AST all remain out of scope);
the `focus_ids` narrowing mechanism is mechanically supported by the schema
and renderer but never triggered by any current profile; the shared
`renderBoxDiagram` grid layout and the `evidence-confidence` scene's legend
text are both not density-aware and can fail the Playwright `min-font-size`
check on repositories with many capability domains (observed directly in
§4 above, on a repository with 11 domains); and the Level 1 implementation-
detail-leak check is a heuristic file-path-like-substring regex, not a
full static analysis.

## Milestone 3.1 — Architecture Presentation Quality Remediation

**Status: complete, within an explicitly bounded "Phase 1" slice of the
26-section remediation spec.** Objective: improve the generated
architecture-review presentation so it reads like an architect-authored
design review rather than a repository inventory, without lowering the
level of evidence, adding new source adapters, starting any deferred
milestone's scope (Kubernetes/LookML/dbt/OpenAPI/Databricks/repository-
dependency-graphs/model-assisted-synthesis), or committing anything. This
pass deliberately scoped to a high-value, repository-agnostic slice of the
spec — sharper labeling/identity/purpose synthesis, a coarser capability
model, better representative-workflow selection, conclusion-oriented
headlines, a logical-architecture scene that filters out noise, and three
new validator codes — rather than attempting all 26 sections literally; see
"What was not attempted" below for an honest accounting of the gap between
this slice and the full spec.

### 1. Renderer correctness fixes (shared SVG renderers)

`packages/workflow-svg` and `packages/terraform-svg`: fixed raw (non-
normalized) label text being truncated blindly instead of measured, and an
opaque background rect that could occlude adjacent diagram content. Both
predate this milestone's synthesis-layer work and were caught during
reconnaissance before any new feature work began.

### 2. Type extensions

`packages/architecture-intelligence/src/types.ts`: `NormalizedLabel.basis`
(optional — tags *how* a label was derived: `"readme-title"`,
`"environment-heuristic"`, `"dynamic-expression"`, etc. — presentation
traceability, not evidence) and `LogicalComponentOrigin` (`"repository-
directory" | "terraform-module" | "workflow-family"`, added to
`LogicalComponent.origin`, distinguishing real automation/infra-derived
components from raw top-level-directory groupings).
`packages/repository-model/src/tech-stack.ts`: `TechStack.manifestDescription`
(optional, sourced from `package.json`'s `description` field) — a fallback
evidence source for the system's one-line description.

### 3. Label, identity, and purpose synthesis

`packages/architecture-intelligence/src/label.ts`: `normalizeEnvironmentLabel()`
detects a leading/trailing deployment-tier keyword (prod/dev/staging/qa/uat/
test/sandbox) and reorders it into a readable form (e.g. `"admin-prod"` →
`"Production Admin"`); wired into boundary synthesis
(`synthesize/flows-boundaries.ts`).
`packages/architecture-intelligence/src/synthesize/identity-purpose.ts`:
system-name fallback chain (distinctive README H1 title, filtered against
the markdown adapter's path-as-title quirk and against matching the raw
slug → else the raw slug, tagged `basis: "readme-title"` when a real title
is used) and one-line-description fallback chain (README lead paragraph →
`manifestDescription` → `unresolved`).
`packages/architecture-intelligence/src/text.ts`: `compressToAtomicClaim()`,
a word/sentence-boundary-aware compressor for the purpose/outcome slides,
replacing a blind `.slice(0, 240)` truncation that could cut mid-word or
mid-sentence.

### 4. Capability model and representative selection

`packages/architecture-intelligence/src/synthesize/responsibilities-capabilities.ts`:
a `CAPABILITY_DOMAIN_ROLLUP` map coarsens ~11 fine-grained workflow-family
labels into ~6-7 generic business-capability domains (unmapped labels fall
back to standalone domains) — proven on real evidence in §8 below, not just
a synthetic fixture.
`packages/architecture-intelligence/src/synthesize/workflow-families.ts`:
`pickRepresentative()` ranks candidate workflows for supplementary detail
scenes by (1) has an approval node, (2) is `workflow_call`/reusable, (3)
most complex graph (most nodes), (4) first alphabetically by id — replacing
an unranked/arbitrary pick.

### 5. Presentation layer

`packages/narrative-planner/src/architecture-visualdoc-builder.ts`:
`headlineFor()` derives conclusion-oriented headlines from real structural
counts (component/domain/family/risk/boundary/outcome/question counts)
under a 14-word budget, replacing static per-kind labels.
`packages/renderer-html/src/scenes/architecture-intelligence/diagrams.ts`:
`renderLogicalArchitecture()` excludes `"repository-directory"`-origin
components from the diagram when real architectural components exist (with
a safe empty-fallback to showing directories when nothing else is
available) — `repository-map` is unaffected and still shows everything.
`packages/renderer-html/src/styles.ts`: `.arch-card-kind`/`.arch-card-meta`
raised from 13px to 14px, fixing a `min-font-size` policy violation that
Milestone 3's own self-hosting proof had documented as an open, out-of-
scope issue (see §8 below and the corrected
[`docs/architecture-intelligence.md`](architecture-intelligence.md#self-hosting-proof)).

### 6. Validator codes

Three new Tier 1 structural codes added to
`packages/architecture-intelligence/src/validate-structure.ts`
(`ARCH_INTEL_GENERIC_SYSTEM_NAME`, `ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR`,
`ARCH_INTEL_WORKFLOW_FAMILY_NO_REPRESENTATIVE`), bringing the combined
Tier 1 + Tier 2 code count from 14 to 17. Separately, while investigating
the `min-font-size` finding above, found and fixed a real Tier 2 coverage
gap in `packages/validator/src/architecture-intelligence-checks.ts`:
`boundary-map` was grouped with the three genuinely SVG-diagram scene
kinds and exempted from the label-integrity/word-budget checks, but it
actually renders as an `.arch-card` prose grid (the same mechanism
`capability-map`/`workflow-family-map` use) — meaning a `suggested` or
`unresolved` boundary claim could have rendered without its qualifier and
nothing would have caught it. Moved `boundary-map` into the checked set and
gave it a 150-word budget; this is a correctness fix in service of the
"never lower the level of evidence" mandate, not a new feature.

### 7. Test coverage

Eight new/updated test files this pass:
`packages/architecture-intelligence/src/__tests__/label.test.ts` (+4 tests,
`normalizeEnvironmentLabel`), `text.test.ts` (new, 6 tests,
`compressToAtomicClaim`), `identity-purpose.test.ts` (new, 6 tests,
`buildSystemIdentity`), `workflow-families.test.ts` (+4 tests,
representative selection — including a self-caught test-fixture bug where a
workflow named "Release Approval" was itself misclassified into the
"Review and approval" family by the production `FAMILY_RULES` keyword-order
logic before family lookup even ran, unrelated to the representative-
selection logic under test; renamed the fixture and documented the
precedence trap in a code comment), `capability-domains.test.ts` (new, 5
tests, 11-fixture rollup-to-7-domains proof),
`validate-structure.test.ts` (new, 6 tests, all three new codes),
`packages/narrative-planner/src/__tests__/architecture-visualdoc-builder.test.ts`
(+4 tests, headline word-budget/determinism/content), and
`packages/renderer-html/src/__tests__/logical-architecture-diagram.test.ts`
(new, 2 tests, directory-exclusion and empty-fallback). Plus 2 new tests in
`packages/validator/src/__tests__/architecture-intelligence-checks.test.ts`
for the boundary-map coverage fix in §6. `pnpm -r --if-present run
typecheck`: clean, 0 errors, across all 17 packages. `npx vitest run`:
**377 tests passed, 6 skipped** across 39 passed test files (2 skipped
files are the `RVS_TEST_PACKAGE`-gated packaging suites, unaffected by this
milestone's changes and not re-run this pass since no CLI-packaging-
relevant code changed) — up from Milestone 3's 338 passed.

### 8. Self-hosting proof

Re-run against the same real external repository as Milestone 3
(`looker-admin-ops`, 65 checked-in GitHub Actions workflows, no Terraform),
via an isolated `rsync` copy in the session scratchpad rather than the
user's actual working tree, since that tree has unrelated in-progress
untracked work and no `.gitignore` entry for `.rvs`/`artifacts/visuals`
yet — a safety precaution, not a correction. Full pipeline run through the
packaged CLI (`node packages/cli/dist/bin.cjs`, rebuilt fresh via
`node packages/cli/scripts/build.mjs`, proving the esbuild bundle reflects
this milestone's changes, not just source): `init` → `inspect` (1092
files, 44 evidence claims) → `create workflow --all` (65 workflows, 0
errors) → `synthesize architecture` → `brief` → `create slides` (both
profiles) → `validate`.

Concrete, on real evidence: 11 workflow families roll up into 7 capability
domains (General Automation, Governance and Approval, Identity and Access
Governance, Migration and Enablement, Operational Diagnostics, Query and
Data Reliability, Release and Maintenance); 15 total logical components, 11
of them architectural (workflow-family-derived; no Terraform in this repo)
and correctly excluded-then-shown per the origin filter; 128 synthesized
statements (59 confirmed, 67 derived, 0 suggested, 2 unresolved); every
architecture-intelligence scene headline is under the 14-word budget and
states a real count (e.g. "11 components make up the architecture",
"Capabilities group into 7 domains", "14 deployment boundaries separate
environments"). `ARCH_INTEL_GENERIC_SYSTEM_NAME` fires honestly on this
repository — its README H1 ("Looker Admin Ops") is identical to its
normalized slug, so there genuinely is no more distinctive name to prefer.

Both `--profile repository-inventory` (74 scenes) and `--profile
architecture-review` (22 scenes) decks now pass `rvs validate --ci` with 0
failures and 0 warnings (the architecture-review deck previously failed on
the 13px `min-font-size` bug fixed in §5; an earlier pass of this
self-hosting proof, before all of this milestone's fixes had landed, had
also recorded a `missing-evidence` warning on the repository-inventory deck
that a later re-run no longer reproduces — this milestone does not touch
the `repository-inventory` profile's `buildVisualDoc` template path, so
that warning's disappearance was incidental, not a deliberate fix, and is
recorded here for accuracy rather than claimed as a fix). Extending the
boundary-map check coverage (§6) surfaced its first real finding on this
repository:
`ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED` on `boundary-map` (235 words
against a 150-word budget, driven by 14 evidenced deployment boundaries) —
a genuine, non-spurious finding, previously silently missed. Full details,
including the corrected root-cause analysis of the `min-font-size` bug (a
static CSS rule, not diagram density as Milestone 3 had assumed), are in
[`docs/architecture-intelligence.md`](architecture-intelligence.md#self-hosting-proof).

### 9. What was not attempted

This pass scoped to a generic, high-value slice of the 26-section
remediation spec rather than every literal section. Not attempted: any
spec item requiring a new evidence source or repository-specific tuning
beyond what the existing `RepositoryModel`/`WorkflowGraph[]`/
`TerraformTopology[]` inputs already support; any redesign of the
`renderBoxDiagram` shared SVG layout engine itself (still not density-aware
— a sufficiently dense repository could still trip `min-font-size` on the
three true diagram-kind scenes, just not via the two fixed causes above);
`focus_ids`-based scene splitting for oversized capability/boundary views
(mechanically supported by the schema, still never triggered by any
profile); and model-assisted synthesis, still explicitly deferred. Nothing
in this section is a claim that the full spec is satisfied — it is an
honest record of the boundary of this pass's scope.

### 10. Documentation

[`docs/architecture-intelligence.md`](architecture-intelligence.md):
updated in place rather than duplicated — added a Milestone 3.1 amendment
note at the top, three new validator codes to the Tier 1 table, corrected
the Self-hosting proof section's numbers and root-cause analysis (including
retracting the earlier, incorrect claim that `boundary-map` renders as an
SVG diagram), corrected the Tier 2 scope-limitation paragraph to reflect
`boundary-map`'s inclusion, and removed the two Known-limitations bullets
that described the now-fixed `min-font-size` issue. This entry.

### 11. Confirmation nothing was committed

Same branch as Milestone 3, still zero new commits:
`git branch --show-current` reports
`feature/architecture-intelligence-engine`; `git log --oneline` still shows
only `748b500`. `git status --short` shows the same modified/untracked
files Milestone 3's own closure entry listed (§8 above), since neither
milestone committed — this pass's changes are layered into that same
uncommitted working tree, not separable from it via `git diff` alone.
Nothing was committed during this closure pass, per the explicit
instruction.

### 12. Remaining limitations

All of Milestone 3's remaining limitations (§9 above) still apply
unchanged, except the `min-font-size` bullets, which are resolved (§5
above) and removed from
[`docs/architecture-intelligence.md#known-limitations`](architecture-intelligence.md#known-limitations).
Additionally: the capability-domain rollup map and the workflow-family
representative-selection ranking are both hand-authored heuristics tuned
against this milestone's fixtures and the one real self-hosting repository
available — a repository with a very different shape of automation could
expose rollup gaps (unmapped labels falling back to standalone domains
rather than being silently wrong) or representative-selection ties this
pass's fixtures didn't cover. The `ARCH_INTEL_CAPABILITY_DOMAIN_TOO_GRANULAR`
threshold (>8 domains) is a fixed constant, not derived from repository
size. And per §9 above, this remains a bounded slice of the full
remediation spec, not a complete implementation of it.
