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

## Milestone 4 — Evidence-Gated Capability Intelligence

**Status: core engine complete and self-hosting-proven; presentation
integration, full test coverage, and cross-repository generic fixtures were
delegated to parallel background agents whose results are appended to this
entry as they land, per the same no-commit constraint as every milestone
above.** Objective: a new synthesis stage — Capability Intelligence — on top
of Milestone 3's `ArchitectureIntelligence`, deciding which capabilities are
mature and evidence-backed enough to appear in a generated `CAPABILITIES.md`
or an executive slide, under an explicit conservative-bias rule: "when
evidence is incomplete, prefer exclude / include_with_qualification /
gap_only / roadmap_only over incorrectly promoting a capability into the
current platform narrative." No external model, no repository-specific
hard-coded capability list, no manually authored Looker/Tableau/Looker-
Doctor capabilities inside RVS, nothing committed.

### 1. Package and contracts

New package `packages/capability-intelligence`. `src/contracts.ts` defines
the full `CapabilityModel` contract: `CapabilityStatus` (9 values),
`CapabilityInclusion` (5-state conservative-bias policy: `include` /
`include_with_qualification` / `exclude` / `roadmap_only` / `gap_only`),
`CapabilityConfidence` (reuses Architecture Intelligence's own
`InferenceClass` rather than inventing a second scale), `CapabilityEvidenceType`
(13 values) with a base strength table (`CAPABILITY_EVIDENCE_STRENGTH`,
workflow/runtime_entrypoint/deployment/release=5 down to
deprecated_marker=-3), `CapabilityGranularity` (5 values), 18 incomplete-
signal keywords, `CapabilityExclusionReasonCode` (17 values), default
readiness weights (implementation 35/execution 25/verification
20/documentation 10/adoption 10) and thresholds (operational 85/implemented
70/partial 45/experimental 25/scaffolded 10), and the full `Capability`/
`CapabilityDomain`/`ExcludedCapabilityCandidate`/`CapabilityModel`/
`CapabilityCandidate` shapes, plus 21 `CapIntelWarningCode` structural
validator codes. See
[`docs/capability-intelligence.md`](capability-intelligence.md) for the
complete contract reference.

### 2. Pipeline

Nine pure, single-responsibility modules mirroring
`@rvs/architecture-intelligence`'s own synthesis-pipeline shape:
`candidates.ts` (discovery from workflow families, `cli`/`service`-kind
runtime components, Terraform modules, and README/markdown claims —
documentation deliberately the weakest source; `mergeDuplicateCandidates()`
folds a candidate found from two evidence angles into one), `evidence.ts`
(aggregation into reasoning flags), `maturity.ts` (five independent
scoring dimensions), `readiness.ts` (weighted 0-100 score plus hard gates
applied independent of that score), `inclusion-policy.ts` (the
conservative-bias decision — `include` reachable only through
`implemented`/`operational` status with zero blocking evidence problems),
`grouping.ts` (5-8 durable domains from included/qualified capabilities
only), `outcomes.ts` (evidence-supported outcome statements, no invented
savings, under a 24-word budget where possible), `label.ts` (display-name
humanization that preserves the raw source label for traceability), and
`validation.ts` (the 21-code structural validator, scoped inside this
package the same way Architecture Intelligence's own Tier 1 validator is
scoped inside its producing package rather than duplicated into
`@rvs/validator`). `index.ts` wires all nine into one
`synthesizeCapabilities()` pure function.

### 3. Exporter and CLI

`exporter.ts`: `exportCapabilitiesMarkdown()` (generation-provenance
header, disaggregated summary table, one section per domain, "Available
with limitations", "Known capability gaps", opt-in "Roadmap" and "Excluded
candidates" sections), `exportCapabilityModelJson()`,
`exportCapabilityCandidatesJson()`, `exportCapabilityExclusionsJson()`.
Three new CLI commands wired into `packages/cli/src/bin.ts`: `rvs
synthesize capabilities` (reads cached `architecture-intelligence.json` +
`repository-model.json` + optional workflow/Terraform caches, runs the full
pipeline, runs `validateCapabilityModelStructure()` inline, caches
`.rvs/cache/capability-model.json` and a `capability-candidates.json`
diagnostic dump), `rvs export capabilities [--output] [--include-partial]
[--include-gaps] [--include-roadmap] [--include-excluded]` (pure formatting
over the cache, makes no inclusion judgment of its own), and `rvs
capabilities explain <id>` (full evidence/readiness/inclusion trail for one
capability or excluded candidate, by id or display name).

### 4. Build and packaging

`packages/cli/scripts/build.mjs` re-run to bundle `@rvs/capability-
intelligence` into `dist/bin.cjs` alongside every other workspace package —
no new external dependency was introduced, so no change to the esbuild
`external` list was needed.

### 5. Self-hosting proof

All 6 required commands run against `repo-visual-studio` itself through the
rebuilt packaged CLI: `rvs inspect` (261 files, 44 evidence claims) → `rvs
create workflow --all` (1 workflow, 5 warnings, 0 errors) → `rvs synthesize
architecture` (6 components, 3 flows, 1 warning) → `rvs synthesize
capabilities` → `rvs export capabilities` (both the default and
`--include-roadmap --include-excluded` forms) → `rvs validate --ci` (48
checks passed, 0 failed).

**First-run result: 0 included, 0 qualified, 0 gaps, 10 roadmap-only, 4
excluded (of 14 candidates), 0 errors, 1 warning**
(`CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS`). This number was investigated
rather than accepted at face value, by reading
`.rvs/cache/capability-model.json` and
`.rvs/cache/capability-candidates.json` directly, and cross-checked against
the three independently generated cross-repository fixtures from §9, which
*also* produced 0 included / 0 qualified — including one built specifically
with a real CLI, tests, and a scheduled workflow. That cross-check
overturned the initial read: this was **a real, in-scope Capability
Intelligence defect, not a defensible conservative outcome**. Root cause:
`candidates.ts` never emitted `implementation`/`configuration`/`test`-type
evidence for any candidate from any repository, because its one nominal
source (`component.implementation.entryPoints`) is hardcoded to `[]`
throughout Architecture Intelligence — capping every candidate's readiness
score below the 45-point "partial" threshold regardless of the strength of
its underlying repository evidence. Fixed by emitting evidence grounded only
in data the pipeline already had confirmed access to: each real workflow
file as `implementation` evidence, workflow steps matching a test-invocation
pattern as `test` evidence, `component.sourcePaths` beyond the runtime
entrypoint as `implementation`/`test` evidence (split by filename
convention), and each Terraform root module path as `configuration`
evidence alongside its existing `deployment` evidence. Full root-cause and
fix detail, including the two smaller bugs (`maturity.ts`'s `scoreAdoption()`
double-counting `hasDeployment` against `scoreExecution()`, and the
`CAP_INTEL_UNSUPPORTED_OUTCOME` regex missing multi-digit dollar amounts)
that surfaced while reconciling with §8's test suite, is in
[`docs/capability-intelligence.md#self-hosting-proof`](capability-intelligence.md#self-hosting-proof).

**Corrected-run result (after the fix in "2. Defects found and fixed"): 0
included, 1 qualified, 0 gaps, 14 roadmap-only, 6 excluded (of 21
candidates), 0 errors, 1 warning.** RVS's own CI workflow family now
correctly reaches readiness 62 ("partial" → `include_with_qualification`),
backed by real `workflow` + `implementation` + `test` (from the CI
workflow's own `test` job) + `runtime_entrypoint` evidence. The
Terraform example-fixture module remains correctly excluded at readiness 15
(`SCAFFOLD_ONLY`) even after the fix — confirming the fix promotes genuinely
strong evidence without over-promoting weak evidence. Candidate count rose
from 14 to 21 because this milestone's own in-progress design docs, cached
in the repository while this section was being written, were themselves
picked up as weak documentation-only candidates — correctly excluded at
readiness 4, a harmless self-referential artifact of self-hosting against a
repository that contains its own design docs.

RVS's own real, working CLI capabilities (`rvs inspect`, `rvs create
workflow`, etc.) still do not appear as candidates, for a separate,
pre-existing, unfixed reason: Architecture Intelligence's own component
classifier, scanning this specific 15-plus-package pnpm monorepo, rolls the
entire `packages/` tree into one coarse `kind: "library"`, `origin:
"repository-directory"` component — rather than resolving the individual
`@rvs/cli` package (which has a real `bin` entrypoint) as its own `kind:
"cli"` component — so `candidatesFromRuntimeComponents()`'s `kind === "cli" |
"service"` filter matches nothing. This is a pre-existing Architecture
Intelligence (Milestone 3) characteristic for this repository's own shape,
not something this milestone introduced, and out of this milestone's scope
to fix (it would mean changing Architecture Intelligence's component
classifier). The three generic cross-repository fixtures, whose `cli/` and
`server-connectors/` directories do classify as `kind: "cli"`/`"service"`,
demonstrate the same candidate-discovery and evidence logic working
correctly once that granularity exists.

### 6. Source-vs-package equivalence

Blocked by a pre-existing, unrelated environment issue: `pnpm --filter
@rvs/cli pack --pack-destination <dir>` fails with `ERROR Unknown option:
'recursive'` under the pnpm 10.9.0 installed in this environment,
reproduced identically outside the test harness (a bug in pnpm's own `pack`
implementation here, not in any RVS source). Not fixed — out of scope for
this milestone. Mitigated: all 6 self-hosting proof commands above were run
directly against the actual esbuild-packaged artifact (`dist/bin.cjs`, the
same file that ships as `bin: {"rvs": "dist/bin.cjs"}`), not against `tsx`
source, giving reasonable confidence in the packaged CLI's correctness for
the new capability commands despite the blocked byte-for-byte tarball-diff
test.

### 7. Presentation integration (§17)

New VisualDoc scene type `capability-intelligence-overview`
(`packages/visualdoc-schema/src/schema.ts`), keyed by `model_id` and
resolved against a `CapabilityModel[]` array threaded through
`renderVisualDocToHtml()` — deliberately kept distinct from the pre-existing
`capability-map` kind (Milestone 3's coarser `capabilityDomains` rollup,
with no evidence-and-maturity gate); both schema and renderer carry comments
warning against conflating the two.
`packages/renderer-html/src/scenes/capability-intelligence/render.ts`:
summary line, domain-grouped capability cards (included + qualified only,
matching `exportCapabilitiesMarkdown()`'s conservative default), a "Known
gaps" section, and a static limitations note — every card/gap item stamps
`data-capability-status`, `data-capability-inclusion`, and
`data-capability-confidence`.
`packages/narrative-planner/src/capability-intelligence-visualdoc-builder.ts`:
`buildCapabilityIntelligenceScenes()`.
`packages/cli/src/commands/create-slides.ts`: optionally reads
`.rvs/cache/capability-model.json` via `readCachedJsonOptional` and appends
the scene only when present — a repository that hasn't run `rvs synthesize
capabilities` renders identically to before this milestone. `pnpm -r exec
tsc --noEmit`: clean, 0 errors, across all packages (re-verified directly,
not just taken from the agent's own report). Pre-existing test suites for
visualdoc-schema, renderer-html, narrative-planner, and validator all still
pass. A live smoke test (`inspect` → `create workflow --all` → `synthesize
architecture` → `synthesize capabilities` → `brief` → `create slides`, both
profiles) rendered without crashing; at the time this integration was
verified, this repository's own capability model was still the first-run
0-included/0-qualified result documented in §5 above (the candidates.ts
defect was found and fixed afterward), so the scene's empty-state path was
what actually exercised in that smoke test — a
separate hand-built fixture model was used to confirm the
`data-capability-*` attributes render real, non-empty enum values for
included, qualified, and gap capabilities alike.

### 8. Test coverage (§18)

Delegated to a background agent; results independently re-run and verified
(not taken on the agent's own report). 11 test files under
`packages/capability-intelligence/src/__tests__/`, 169 tests, all passing:
`candidates.test.ts` (17 — one per candidate-discovery source plus the
merge-duplicate-candidates scenarios), `evidence.test.ts` (13),
`maturity.test.ts` (22, including the hard-gate blocker/qualifier scenarios),
`readiness.test.ts` (26, including every status/threshold boundary and the
execution/verification hard gates independent of score), `inclusion-
policy.test.ts` (21, covering all 9 `CapabilityStatus` → inclusion-state
transitions), `grouping.test.ts` (11), `outcomes.test.ts` (13),
`label.test.ts` (6), `validation.test.ts` (20, one per most of the 21
`CAP_INTEL_*` codes), `exporter.test.ts` (13), `ids.test.ts` (7). Running
this suite against the corrected `candidates.ts`/`maturity.ts`/`validation.ts`
(§ above) surfaced 2 test failures caused by the candidate-discovery fix
itself (an evidence-count assertion in the Terraform test and the
merge-duplicate-candidates test, both updated to the new, correct evidence
counts) and, independently, 2 pre-existing bugs the new tests exposed in
code untouched by that fix: `maturity.ts`'s `scoreAdoption()` double-counting
`hasDeployment`, and the `CAP_INTEL_UNSUPPORTED_OUTCOME` validator's regex
silently missing multi-digit dollar amounts (see "5. Self-hosting proof"
above for both). All 3 fixes applied; full workspace suite re-run clean
afterward: 546 passed, 6 skipped (the 2 pre-existing, documented
`pnpm pack`-blocked skips from §6), 0 failed, across 52 test files.

### 9. Cross-repository generic fixtures (§22)

Delegated to a background agent; results independently re-run and verified.
Three fixture repositories built from scratch (generic BI/analytics-admin
product shapes, no product names or capability titles hard-coded into the
engine — see the constraint in §22 of the governing spec), each with real
git history, a CLI entrypoint, tests, and at least one scheduled GitHub
Actions workflow, left on disk at
`cap-intel-fixtures/{fixture-1-dashboard-governance,fixture-2-workbook-admin,fixture-3-bi-diagnostics}`
in this session's scratchpad for review (not committed anywhere, not part of
this repository):

- **fixture-1-dashboard-governance** ("Beacon Board") — dashboard-sprawl
  governance CLI.
- **fixture-2-workbook-admin** ("Grid Forge") — workbook/data-source
  administration CLI.
- **fixture-3-bi-diagnostics** ("Pulse Check") — BI environment diagnostics
  CLI.

The agent's own run (before the candidates.ts fix) reported all three
producing 0 included / 0 qualified despite fixture 1 being built
specifically with a real CLI, tests, and a scheduled workflow — this was the
finding that triggered the root-cause investigation in "5. Self-hosting
proof" above, escalated as "senior-agent triage" rather than patched
locally. Re-run against the fixed pipeline: all three now produce **2
qualified capabilities each** (`partial` status, readiness 51 and 62 for
fixture 1's Identity/Access and Observability domains; comparable results
for fixtures 2 and 3), backed by real `workflow` + `implementation` +
`runtime_entrypoint` evidence, plus `test` evidence where a workflow's `test`
job label matched — while each fixture's scaffold-only and under-evidenced
candidates (an `Api`/`Cli` stub, a `legacy-*-stub` directory) remained
correctly excluded (`SCAFFOLD_ONLY` / `INSUFFICIENT_IMPLEMENTATION_EVIDENCE`,
readiness 4-40). `CAPABILITIES.md` re-exported for all three with the
corrected pipeline; sample output (fixture 1) is in
[`docs/capability-intelligence.md#self-hosting-proof`](capability-intelligence.md#self-hosting-proof).
No fixture ever moved a candidate all the way to `include` (unqualified) —
consistent with the conservative-bias mandate, since none of the three
fixtures' CLIs had verification evidence strong enough to clear the
`operational`/`implemented` execution+verification hard gates, only the
`partial` threshold.

### 10. Documentation

New [`docs/capability-intelligence.md`](capability-intelligence.md), full
design document mirroring `docs/architecture-intelligence.md`'s structure.
`README.md` updated in place: a new Milestone 4 paragraph, a new
"Capability Intelligence" subsection (mirroring the existing "Architecture
Intelligence" one), two new pipeline commands in the quickstart block, a
new `capability-intelligence/` row in the repository-layout table, and a
new "Current limitations" bullet documenting the self-hosting ceiling.
[`docs/architecture-intelligence.md`](architecture-intelligence.md): a
Milestone 4 amendment note added at the top (same pattern as the existing
Milestone 3.1 amendment note), pointing at the component-classifier
characteristic behind Capability Intelligence's self-hosting result,
without changing anything else in that document. This entry.

### 11. Confirmation nothing was committed

Same branch as every prior milestone in this file, still zero new commits:
`git branch --show-current` reports
`feature/architecture-intelligence-engine`. This milestone's changes are
layered into the same uncommitted working tree as Milestones 3 and 3.1's
changes — new files (`packages/capability-intelligence/**`,
`docs/capability-intelligence.md`) plus in-place edits to `README.md`,
`docs/architecture-intelligence.md`, `docs/milestones.md`, and
`packages/cli/src/**`. Nothing was committed during this pass, per the
explicit instruction.

### 12. Remaining limitations (as of the initial build; see §13 for what changed since)

`candidatesFromRuntimeComponents()` only considers `kind: "cli"` and `kind:
"service"` components — `library`/`data-store`/`integration`/`unknown`-kind
components never produce a candidate directly, even with real
implementation evidence behind them, unless that evidence is also reachable
through a workflow-family or Terraform-module candidate. This was
deliberately not widened during this milestone: a `library`-kind,
`repository-directory`-origin component (the shape this repository's own
self-scan currently produces) carries no entry-point-level evidence to
distinguish "a well-tested working library" from "a pile of files," and
widening the filter without that distinction would risk exactly the kind of
evidence-inflation the conservative-bias mandate forbids. No model-assisted
synthesis. At the time this section was written, `rvs validate --ci` did not
yet run a capability-specific check — see §13, which closes this gap. See
[`docs/capability-intelligence.md#known-limitations`](capability-intelligence.md#known-limitations)
for the complete, current list.

### 13. Closure-condition remediation

The conditional acceptance of this milestone listed seven outstanding
closure conditions. All seven were addressed in a follow-up pass, without
committing anything (same uncommitted working tree as every prior
milestone in this file) and without violating any standing hard constraint
(no external model, no repository-specific hard-coded capability list, no
manually-authored Looker/Tableau/Looker-Doctor capabilities, no cross-repo
fixture product names hard-coded into the engine).

**Approach**: two conditions (#1 component granularity, #2 self-hosting
yield) required direct changes to already-shipped Architecture Intelligence
logic and were handled directly, in sequence, since #2 is a direct
consequence of #1. The other five conditions (#3–#7) were file-disjoint and
were delegated to four parallel background agents, then independently
re-verified — diffs read firsthand, not taken on the agents' own reports —
before being accepted as closed.

1. **Component granularity for monorepos.** Root-caused via this
   repository's own self-hosting re-run to two compounding defects:
   - `DEFAULT_INCLUDE`/`DEFAULT_EXCLUDE` in `packages/core/src/config.ts`
     used bare manifest filenames, which fast-glob matches only at the
     repository root — every nested workspace/module manifest was silently
     unscanned for any repository/ecosystem not covered by the JS/TS-only
     `workspaceSourcePatterns()` layer. Fixed by broadening every
     non-root-only default pattern to a `**/`-prefixed glob (`**/`
     also matches a zero-segment prefix, so root-level files stay covered);
     `pnpm-workspace.yaml` deliberately kept root-only, matching pnpm's own
     convention. `packages/core/src/__tests__/workspace.test.ts`'s two
     exact-array assertions were updated to match; full workspace suite
     re-run clean afterward.
   - `classifyWorkspacePackage()`
     (`packages/architecture-intelligence/src/synthesize/components.ts`)
     checked its directory-name regex fallback before the
     manifest-declared `hasLibraryExport` signal, so `packages/terraform-graph`
     — a real library package with `"main": "src/index.ts"` — was
     misclassified as `infrastructure-module` because its directory name
     matched `/infra|terraform|deploy/i`. Fixed by reordering the checks so
     manifest evidence (direct, stronger) takes priority over the
     name-substring heuristic (indirect, weaker); a new
     `packages/architecture-intelligence/src/__tests__/components.test.ts`
     (10 tests, previously nonexistent) covers this exact case plus 9 other
     classification/grouping/determinism scenarios. `pnpm --filter
     @rvs/architecture-intelligence exec vitest run`: 79/79 passing.

   Net effect: this repository's own self-scan went from one coarse
   `library`-kind component covering the entire `packages/` tree to 22 real
   per-package components.

2. **Self-hosting yield.** Direct consequence of #1: this repository's own
   capability model went from 1 generic qualified capability (of 21
   candidates) to 2 evidence-backed qualified capabilities — `@rvs/cli`
   (readiness 64, now resolved as its own `kind: "cli"` component) and the
   CI workflow's automation family (readiness 62) — of 15 candidates (0
   included, 0 gaps, 11 roadmap-only, 2 excluded). Re-verified against all
   three cross-repository fixtures (`cap-intel-fixtures/
   {fixture-1-dashboard-governance,fixture-2-workbook-admin,fixture-3-bi-diagnostics}`
   in this session's scratchpad): each still produces 2 qualified
   capabilities, consistent with the baseline in §9 above, confirming the
   fix generalizes rather than only helping this repository's own scan.

3. **Packaged-tarball smoke coverage.**
   `packages/cli/src/__tests__/package-smoke.test.ts` gained a test running
   `synthesize architecture` → `synthesize capabilities` → `export
   capabilities` → `capabilities explain` against an installed npm tarball,
   gated behind `RVS_TEST_PACKAGE=1` alongside the suite's existing
   packaging tests. Re-run and confirmed passing (7/7 across both packaged
   test files, including the pre-existing PDF-export and no-workflows
   tests).

4. **Source-vs-package equivalence coverage.**
   `packages/cli/src/__tests__/source-vs-package-equivalence.test.ts`
   extended to diff the capability-model cache and `CAPABILITIES.md` output
   between a source run and a packed-tarball run. Re-run and confirmed
   passing.

5. **CI validation wiring.** `.github/workflows/ci.yml`'s `build-deck` job
   now runs `rvs synthesize architecture` and `rvs synthesize capabilities`
   before `rvs validate --ci`. `packages/cli/src/commands/validate.ts`
   gained `validateCachedCapabilityModel()`, which runs
   `validateCapabilityModelStructure()` against
   `.rvs/cache/capability-model.json` when present, writes
   `artifacts/visuals/capability-validation-report.json`, and fails `--ci`
   unconditionally on any structural error — matching the existing
   unconditional-on-`--ci` precedent set by the deck's own
   contrast/overflow checks. Backward compatible: a repository that never
   runs `rvs synthesize capabilities` sees no behavior change.

   Verifying this end-to-end (not just trusting the responsible agent's own
   test, which only exercised `validateCachedCapabilityModel()` directly
   against synthetic fixtures — never the full `runValidate()` → Playwright
   → `deck.html` path) surfaced one real, previously undetected defect: the
   `capability-intelligence-overview` scene's CSS
   (`packages/renderer-html/src/styles.ts`) failed both `min-font-size`
   (`.cap-badge`/`.cap-card-meta` below the 14px minimum) and `contrast`
   (`.cap-badge-status`'s text color set to `var(--rvs-color-background)` —
   the validator compares against the outer `.scene` element's background,
   also `var(--rvs-color-background)`, guaranteeing an exact 1.00:1 ratio
   regardless of the badge's own different background). Reproduced
   identically against this repository and all three cross-repo fixtures.
   Both rules fixed (font sizes raised to 14px;
   `.cap-badge-status` color changed to `var(--rvs-color-text-primary)`); no
   test asserted the old values, so none needed updating. Re-verified via
   `create slides` + `validate --ci` against this repository and all three
   fixtures: all pass, 0 failed, exit 0.

6. **Reason and warning codes.** Four `CapabilityExclusionReasonCode` values
   that could not be formalized without an external model or
   repository-specific hardcoding (`TOO_GRANULAR`, `DUPLICATE_CAPABILITY`,
   `NOT_USER_MEANINGFUL`, `NO_SUPPORTED_OUTCOME`) were removed from the
   contract rather than left dead, each already superseded by an equivalent
   check at a later pipeline stage (documented in the type's own doc
   comment in `contracts.ts`). The two previously-unreachable
   `CapIntelWarningCode` values, `CAP_INTEL_PLACEHOLDER_PROMOTED` and
   `CAP_INTEL_NONDETERMINISTIC_ORDER`, were wired up in `validation.ts`
   instead, backed by a new `Capability.matchedIncompleteSignals: string[]`
   field threaded from `CapabilityCandidate` through `buildCapability()`.

7. **Self-referential documentation filtering.**
   `packages/capability-intelligence/src/candidates.ts` gained
   `REPORT_NARRATIVE_HEADING_PATTERN` and `NUMBERED_OUTLINE_HEADING_PATTERN`
   (plus `nearestAncestorHeadings()`, reconstructed from the existing
   `depth` + document-order fields with no schema change) to suppress
   markdown sections whose own heading, or nearest enclosing heading, reads
   as changelog/milestone/status-report/postmortem narrative — generic
   documentation-convention vocabulary, never this repository's own
   filenames or wording. A plain product-documentation heading matches none
   of it.

**Verification**: every fix above was confirmed against a fresh pipeline
re-run, not assumed from any agent's self-report. Full workspace suite
(`pnpm -r exec tsc --noEmit` + `pnpm exec vitest run`) re-run clean after
each change: 597 passed, 7 skipped, 0 failed, across 56 test files at the
final checkpoint. Packaged/equivalence suite (`RVS_TEST_PACKAGE=1`)
re-verified separately: 7/7 passing. Nothing was committed — `git
branch --show-current` still reports `feature/architecture-intelligence-engine`;
all changes remain layered into the same uncommitted working tree as every
prior milestone.

See
[`docs/capability-intelligence.md#closure-condition-remediation`](capability-intelligence.md#closure-condition-remediation)
for the design-document-side write-up of the same work.

## Milestone 5 — Product Identity and Executive Showcase Intelligence

**Status: core engine, presentation integration, full test coverage, and
all five conditional-acceptance closure conditions complete (§8).**
Objective: a
deterministic synthesis stage on top of Milestone 4's accepted
`CapabilityModel` — Product Identity Intelligence (archetype, purpose,
users, value pillars, differentiators) feeding Executive Narrative
Intelligence (a claim-controlled, audience-aware narrative) feeding a
premium "showcase" `VisualDoc` profile — governed by the same rule as every
milestone above: "product storytelling may compress evidence, but it must
never inflate maturity, invent adoption, or promote unfinished
capabilities." No external model, no repository-specific hard-coded product
identity (Looker Admin/Tableau Admin/Looker Doctor/RVS or otherwise), no
repository-specific presentation logic, no hand-written showcase claim that
bypasses the `CapabilityModel`, nothing committed. See
[`docs/product-identity-intelligence.md`](product-identity-intelligence.md)
and
[`docs/executive-showcase-intelligence.md`](executive-showcase-intelligence.md)
for the complete design, contracts, pipelines, and self-hosting proofs — this
entry records closure/coverage work and defers to those two documents for
everything else, the same division of labor Milestone 4's entry uses with
`docs/capability-intelligence.md`.

### 1. Package, contracts, and pipeline

New package `packages/product-intelligence` (`@rvs/product-intelligence`),
18 non-test source modules: `contracts.ts` (13-value `ProductArchetype`,
9-value `AudienceType`, 4-value `ClaimStatus`, 9-value `ClaimType`, 11-value
`ShowcaseClaimRejectionReasonCode`, 30-value `ProductIntelWarningCode`, and
the full `ProductIdentityModel`/`ProductClaim`/`ExecutiveNarrative`/
`ShowcasePlan` shapes), `identity-evidence.ts`, `archetypes.ts`, `users.ts`,
`purpose.ts`, `identity-candidates.ts`, `value-pillars.ts`,
`differentiators.ts`, `ranking.ts`, `override.ts`, `label.ts`, `claims.ts`,
`narrative.ts`, `showcase-plan.ts`, `validation.ts`, `exporter.ts`, `ids.ts`,
`index.ts` — mirroring, deliberately, the small-pure-single-responsibility-
module shape `@rvs/architecture-intelligence` and
`@rvs/capability-intelligence` both already use. Full contract and pipeline
detail: [docs/product-identity-intelligence.md](product-identity-intelligence.md#the-productidentitymodel-contract).

### 2. Claim control and showcase plan

`claims.ts`'s `buildProductClaims()`/`classifyDraft()` runs unconditionally
before narrative synthesis (`index.ts`) — there is no code path that writes
showcase text directly from `ProductIdentityModel` fields, bypassing claim
control. `showcase-plan.ts` builds an evidence-gated 7-10 scene sequence
(`selectSceneTypes()` never pads a scene in just to hit the band) plus
metrics and an evidence summary. Full design:
[docs/executive-showcase-intelligence.md](executive-showcase-intelligence.md#claim-control).

### 3. Presentation integration and CLI

New `showcase-*` `ShowcaseSceneType` values in
`packages/visualdoc-schema/src/schema.ts`; a new "showcase" `VisualDoc`
profile in `packages/narrative-planner/src/showcase-visualdoc-builder.ts`;
new scene templates under
`packages/renderer-html/src/scenes/showcase/`. Five new CLI commands wired
into `packages/cli/src/bin.ts`: `rvs synthesize product-identity`, `rvs
create slides --profile showcase [--audience ...] [--theme ...]`, `rvs
export product-identity`, `rvs export showcase-plan`, `rvs showcase explain
<claim-id>`. `rvs validate --ci` gained `validateCachedProductIdentity()`
and `validateCachedShowcasePlan()`
(`packages/cli/src/commands/validate.ts`), both fully backward-compatible —
a repository that has never run `rvs synthesize product-identity` sees no
behavior change.

### 4. Self-hosting proof

Run against `repo-visual-studio` itself, continuing the pipeline Milestone
4's proof left off. **Product identity result: archetype `unknown`,
confidence `unresolved`, 3 candidates, 2 value pillars, 0 differentiators, 0
structural errors, 2 warnings** (`PRODUCT_IDENTITY_WEAK_EVIDENCE` and
`PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES` — the latter only became reachable
after §6's closure pass wired it up; re-run confirms `automation_platform`
and `developer_tool` now tie at score 2 with no overlapping evidence) — the
conservative-bias rule working as designed against this repository's own
thin (0-included/2-qualified) capability model, not a defect. **Showcase
result: 7 scenes generated, 5 claims approved (4 fully, 1 with
qualification), 2 claims rejected** (both `SHOWCASE_CLAIM_TOO_TECHNICAL`, on
drafted claims that leaked the literal package path `@rvs/cli` into
would-be executive prose — claim control correctly refusing it), **28/28
Playwright checks passed, exit code 0.** One real CSS defect
(`min-font-size` violations on two showcase selectors) was found and fixed
during this proof; a `SHOWCASE_UNSUPPORTED_METRIC` warning (also only
reachable after §6's closure pass) additionally fires on the showcase plan
in the current re-run, correctly flagging a metric that doesn't resolve to
identity-model evidence. Full narrative, including the exact claim texts and
rejection reasoning: [docs/product-identity-intelligence.md#self-hosting-proof](product-identity-intelligence.md#self-hosting-proof)
and [docs/executive-showcase-intelligence.md#self-hosting-proof](executive-showcase-intelligence.md#self-hosting-proof).

### 5. Test coverage

`packages/product-intelligence/src/__tests__/`: 17 test files, **237
tests**, all passing, one file per source module
(`archetypes`/`claims`/`differentiators`/`exporter`/`identity-candidates`/
`identity-evidence`/`ids`/`index`/`label`/`narrative`/`override`/`purpose`/
`ranking`/`showcase-plan`/`users`/`validation`/`value-pillars`), plus new
tests in `packages/visualdoc-schema/src/__tests__/schema.test.ts` (the new
showcase scene types),
`packages/narrative-planner/src/__tests__/showcase-visualdoc-builder.test.ts`,
and `packages/renderer-html/src/__tests__/showcase-scene.test.ts`. Full
workspace suite: `pnpm -r exec tsc --noEmit` clean, 0 errors; `pnpm test`
**870 passed, 7 skipped, 0 failed** across 75 test files.

### 6. Validator-code-coverage closure pass

Auditing every other synthesis package in this workspace
(`@rvs/architecture-intelligence`, `@rvs/capability-intelligence`)
confirmed a zero-exception house convention: every code declared in a
package's own warning-code union is actually emitted by real logic
somewhere in that package. `@rvs/product-intelligence`'s 30-value
`ProductIntelWarningCode` and 11-value `ShowcaseClaimRejectionReasonCode`
unions had 16 declared-but-unreachable codes at the start of this pass — a
genuine regression from that convention, not a design gap requiring new
scope.

Each of the 16 was individually reasoned through (redundancy against
existing checks, data-shape feasibility, architectural fit) rather than
mechanically stubbed in. **13 of 16 were wired to real, non-redundant
checks**:

- `PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES`, `PRODUCT_IDENTITY_MISSING`,
  `PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM` (new
  `ENTERPRISE_SCALE_TERMS` table in `contracts.ts`, mirroring the existing
  `QUALIFIED_MATURITY_TERMS` pattern), `SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED`
  (redesigned from an originally-assumed scene-level check, which would have
  fully overlapped the pre-existing `SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM`
  check, into an identity-model cross-consistency check instead),
  `SHOWCASE_UNSUPPORTED_DIFFERENTIATOR`, and `PRODUCT_IDENTITY_OVERRIDE_CONFLICT`
  (newly wiring the previously-unconsumed `.rvs/product.yml`
  `disallowed_terms` override field) in `validateProductIdentityModel()`.
- `SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED`, `SHOWCASE_SCENE_TOO_DENSE`,
  `SHOWCASE_RUNTIME_CLAIM_UNVERIFIED`, `SHOWCASE_UNSUPPORTED_METRIC`, and
  `SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY` in `validateShowcasePlan()`.
- Plus 4 codes that were already correctly implemented but had never been
  reachable because `rvs validate` never passed a `.rvs/product.yml`
  override through to `validateProductIdentityModel()` — fixed by extending
  that function's signature with an optional `override` parameter and
  threading `loadProductIdentityOverride(repoRoot)` through from
  `packages/cli/src/commands/validate.ts`.

**3 codes were deliberately left unimplemented**, each documented in place
rather than silently dropped:
`PRODUCT_IDENTITY_UNSUPPORTED_DESCRIPTOR` (no reachable failure case under
the current synthesis design — descriptors are always drawn from a fixed
generic phrase table with no divergence path) and
`SHOWCASE_FONT_BELOW_MINIMUM`/`SHOWCASE_LOW_CONTRAST` (fully redundant with
`@rvs/validator`'s existing generic, higher-fidelity `min-font-size`/
`contrast` Playwright checks, which already fail `rvs validate --ci`
unconditionally for every scene type including showcase scenes — duplicating
that DOM-inspection logic inside this package's pure validator would add
real complexity with no coverage gain). Full rationale for each in
[docs/product-identity-intelligence.md#known-limitations](product-identity-intelligence.md#known-limitations)
and
[docs/executive-showcase-intelligence.md#known-limitations](executive-showcase-intelligence.md#known-limitations).
**2 further codes** in the separate `ShowcaseClaimRejectionReasonCode`
union (`SHOWCASE_CLAIM_UNQUALIFIED_PARTIAL`,
`SHOWCASE_CLAIM_RUNTIME_UNVERIFIED`) were found to be structurally
incompatible with `claims.ts`'s current design (`rejectionReasons` is only
populated on `status === "rejected"`, but the states these two codes
describe resolve to different, non-rejected statuses) and were likewise left
documented rather than forced in by widening that field's semantics beyond
its current, narrower meaning.

A genuine `tsc --noEmit` regression was introduced and caught mid-pass: a
new test's inline `ProductDifferentiator` object literal omitted the
interface's required `confidence` field. Vitest's esbuild-based transform
does not enforce full type-checking, so `pnpm test` passed at 870/7 despite
the error — it was only caught by the dedicated `tsc --noEmit` step,
consistent with why this project always runs that step separately rather
than treating a green `pnpm test` alone as sufficient. Fixed; both checks
confirmed clean afterward (§5 above).

### 7. Cross-repository generic fixtures (§32)

Two new fixture repositories, deliberately unrelated in shape to Milestone
4's three BI/analytics-admin fixtures (to prove the engine isn't overfit to
that one shape): **`fixture-a-task-queue`** ("Railyard," a file-backed
background job/task-queue CLI) and **`fixture-b-schema-migrator`**
("Stratum," a reversible database-schema-migration CLI). Built by a
background agent, then independently re-verified firsthand — `git log`,
cache JSON, and a from-scratch re-run of `rvs validate --ci` against both
fixtures were read/executed directly, not taken on the agent's report
alone. Each fixture has real git history (10-11 commits, 2 distinct
`--author` identities, spread across 1-2 months), a real multi-subcommand
CLI backed by real logic and a real passing test suite (15 tests each,
vitest), a scheduled `.github/workflows/ci.yml`, a substantive README, one
deliberately weak/scaffold-only module (throws "not implemented," no
tests), and one deliberately roadmap-only feature (described only in
`TODO.md`/README, no code) — left on disk at
`prodintel-fixtures/{fixture-a-task-queue,fixture-b-schema-migrator}` in
this session's scratchpad for review, not committed anywhere, not part of
this repository. Full pipeline run against both: `init` → `inspect` →
`synthesize architecture` → `synthesize capabilities` → `synthesize
product-identity` → `create slides --profile showcase --audience
executive` → `export {capabilities,product-identity,showcase-plan}` →
`validate --ci`.

**Result, both fixtures, independently confirmed**: `rvs validate --ci`
exits 0 (28/28 Playwright checks passed on the showcase deck; capability
model, product identity, and showcase plan each report 0 structural errors,
1 warning). Product identity: `archetype: unknown`, `confidence:
unresolved`, 1 value pillar, 0 differentiators — conservative-bias working
as designed, not a defect (see the gap below for why). Showcase: 7 scenes
both times; fixture A rejected one drafted claim
(`SHOWCASE_CLAIM_TOO_TECHNICAL`, correctly refusing prose that leaked a
literal identifier), fixture B rejected none. Grepped generated output
(`product-identity.json`, `showcase-plan.json`, `CAPABILITIES.md`,
`deck.html`) for every prior fixture/BI-specific term and for
`repo-visual-studio`/`anthropic`: zero hits outside RVS's own CSS
class-name prefix — confirms no product-identity or capability content is
hard-coded or leaking across repositories.

**Genuine generalization gap surfaced and diagnosed (not fixed this
pass — same conservative posture as the closure-condition process in
Milestone 4 §13 item 1, where a large-blast-radius `repository-model`
change was root-caused and escalated rather than patched reflexively)**:
`detectWorkspacePackages()`
(`packages/repository-model/src/workspace-packages.ts`) explicitly skips
the repository root (`if (dir === "") continue`), so a repository whose
`package.json` — with a `bin` field — lives directly at the repo root
(arguably the single most common real-world Node CLI package shape; both
fixtures use it) never becomes a `WorkspacePackage`, so
`classifyWorkspacePackage()`'s `hasBinEntry → kind: "cli"` path
(`packages/architecture-intelligence/src/synthesize/components.ts`) never
fires. This cascades through three independent downstream consumers,
verified by reading the source: `candidatesFromRuntimeComponents()`
(`packages/capability-intelligence/src/candidates.ts`) never sees the CLI
component so none of its real, tested subcommands become capability
candidates; `classifyArchetypes()`
(`packages/product-intelligence/src/archetypes.ts`) only text-matches
archetype keywords against included/qualified capability text, never raw
README prose, so fixture B's `migration_platform` archetype scored 0
despite its README being explicitly about migrations; and the same
function's `developer_tool` CLI boost never applies either. The engine
behaved correctly and conservatively given what it could see — archetype
stayed `unknown` rather than guessing, no capability was inflated — so this
is not a hard-coding defect, but it is a real, now-documented coverage gap:
Milestone 4's own fixtures apparently avoided it by nesting CLI code under
a `cli/`-named subdirectory (matched by a separate directory-name
heuristic) rather than a root-level `bin` field. Left open for a future
pass, consistent with how Milestone 4 itself sequenced large-blast-radius
`repository-model` fixes as a separate, deliberate step.

**One real, small defect found and fixed during this proof**:
`buildMetrics()` (`packages/product-intelligence/src/showcase-plan.ts`)
built each showcase metric's id via `showcaseMetricId(p.label + p.id)`,
concatenating a raw human-readable label directly onto an
already-namespaced proof-point id (itself derived from an already-namespaced
claim id), producing mangled, redundant ids such as
`showcase:metric:maturityprodintel-proof-prodintel-claim-maturity-maturity`.
Purely cosmetic (ids stayed unique and deterministic; no incorrect
behavior), but real. Fixed to `showcaseMetricId(p.id)` — `p.id` is already
unique per proof point, so no information is lost. `@rvs/product-intelligence`
suite re-run clean (237/237); full workspace `tsc --noEmit` + `pnpm test`
re-run clean (870 passed, 7 skipped, 0 failed, 75 test files) after the fix.

### 8. Closure-condition remediation

Milestone 5's conditional acceptance listed five explicit closure
conditions. All five were addressed in a follow-up pass, without committing
anything (same uncommitted working tree as every prior milestone in this
file) and without violating any standing hard constraint (no external
model, no repository-specific hard-coded product identity, no
repository-specific presentation logic, no hand-written showcase claim
bypassing the `CapabilityModel`). This mirrors the structure Milestone 4
§13 used for its own seven closure conditions.

1. **Root-level package manifests recognized as CLI product surfaces.**
   `detectWorkspacePackages()`
   (`packages/repository-model/src/workspace-packages.ts`) previously
   skipped the repository root outright (§7's diagnosed gap). Fixed by
   deferring the root manifest instead of discarding it: every nested
   package is still collected first (per-package granularity is never
   diluted), and only when zero nested packages exist is the root's own
   manifest promoted to a `WorkspacePackage` — so a repository whose CLI
   `package.json`/`bin` field lives directly at the repo root (the single
   most common real-world Node CLI shape, and the shape both §7 fixtures
   use) now flows through `classifyWorkspacePackage()`'s `hasBinEntry →
   kind: "cli"` path exactly like a nested package would, which in turn
   feeds `candidatesFromRuntimeComponents()` (capability candidates) and
   `classifyArchetypes()`'s `developer_tool`/CLI-boost signal (archetype
   detection). `packages/repository-model/src/__tests__/workspace-packages.test.ts`
   gained coverage for: promotion when no nested package exists, identical
   bin/dependency/export classification for a root-level vs. nested
   `package.json`, non-promotion when a real nested package is present
   (monorepo shape unaffected), and the non-`package.json` manifest case
   (`go.mod`/`Cargo.toml`/`pyproject.toml` at the root). Re-verified against
   both §7 fixtures (task-queue and schema-migrator): condition 2 below
   covers the re-run results.

2. **Cross-repository fixtures re-verified after the detection fix.**
   Re-ran the full pipeline (`init` → `inspect` → `synthesize architecture`
   → `synthesize capabilities` → `synthesize product-identity` → `create
   slides --profile showcase --audience executive` → `export
   {capabilities,product-identity,showcase-plan}` → `validate --ci`) against
   both `fixture-a-task-queue` and `fixture-b-schema-migrator`. Both CLI
   root manifests are now correctly classified as `kind: "cli"` components;
   `rvs validate --ci` still exits 0 on both (28/28 Playwright checks). The
   generalization gap documented in §7 is closed, not merely worked around
   — the fixtures' own archetype/capability yield was not hand-tuned to
   pass, the upstream evidence pipeline now sees what it should have seen
   from the start.

3. **`approved_terms` override implemented with claim-control safeguards.**
   `validateProductIdentityOverride()`
   (`packages/product-intelligence/src/override.ts`) now consumes
   `approved_terms`: a marketing-language or absolute-superiority match in
   `display_name`/`descriptor_override`/`purpose_override` is only lifted
   when the exact matched term (case-insensitive) appears in
   `approved_terms` — an unrelated approved term does not suppress an
   unapproved one in the same field, and the override's authority is scoped
   narrowly to those three fields only. It has no reach into evidence-derived
   value pillars, differentiators, capabilities, or limitations, which
   remain subject to `validateProductIdentityModel()`'s own
   `disallowed_terms` check regardless of `approved_terms` — a human clearing
   one marketing phrase for the product's own name/descriptor cannot use the
   same override to launder language into content the engine derives from
   evidence. `packages/product-intelligence/src/__tests__/override.test.ts`
   covers: lifting a marketing-language error, lifting an absolute-
   superiority error, an unapproved term in the same field still erroring,
   and all three text fields checked independently.

4. **Packaged-tarball smoke coverage for all five new CLI commands.**
   `packages/cli/src/__tests__/package-smoke.test.ts` gained a test running
   `synthesize product-identity` → `export product-identity` → `create
   slides --profile showcase --audience executive` → `export showcase-plan`
   → `showcase explain <claim-id>` (both a real claim id and a bogus one,
   confirming the not-found error path) against an installed npm tarball,
   gated behind `RVS_TEST_PACKAGE=1` alongside the suite's existing
   packaging tests. Re-run and confirmed passing: 7/7 across the file
   (6 pre-existing + 1 new).

5. **Source-vs-package structural equivalence for identity, narrative, and
   showcase artifacts.**
   `packages/cli/src/__tests__/source-vs-package-equivalence.test.ts`
   extended to run the same four new commands through both the source
   (`tsx`) and packed-tarball paths, then deep-compare: the cached
   `product-identity-model.json` and its `export product-identity` output,
   the cached `product-identity-candidates.json` (byte-identical, no
   timestamps), and the cached `showcase-plan.json` and its `export
   showcase-plan` output — with only the genuinely wall-clock
   `generationMetadata.generated_at` fields stripped before comparison (the
   underlying `VisualDoc`/`content_spec_hash` stays fully deterministic;
   only `ShowcasePlan`'s own metadata timestamp is wall-clock, since
   `runCreateShowcaseSlides()` in `create-slides.ts` calls `new
   Date().toISOString()` directly rather than threading a deterministic
   source timestamp). The showcase deck's `deck.html`/`visualdoc.json` get
   transparently covered too, since the showcase profile overwrites the
   earlier repository-inventory deck within the same test run, so the
   pre-existing deck comparisons further up the file re-verify showcase-deck
   equivalence as well. Re-run and confirmed passing.

   One test-infrastructure defect was found and fixed along the way: `npm
   install <tarball>` without `--no-save` silently adds the installed
   package as a dependency of the installing directory's own
   `package.json` — harmless before condition 1's fix, but once root-level
   manifests started being read as comparable `WorkspacePackage` evidence,
   this produced a spurious `workspace_packages[0].dependencyNames`
   divergence between the source and packaged runs (`["@rvs/cli"]` vs.
   `[]`). Fixed narrowly in the equivalence test's `packagedDir` install
   step by adding `--no-save` (left as plain `npm install` in the smoke
   test, where default npm behavior is arguably more representative of a
   real end-user install).

6. **Remaining unreachable warning and claim-rejection codes.** Already
   fully addressed in §6 above ("Validator-code-coverage closure pass") —
   13 of 16 originally-unreachable codes wired to real logic, the remaining
   3 left deliberately unimplemented with the reasoning recorded in
   `contracts.ts` and in §6, matching the same "implemented and tested, or
   explicitly documented as structurally infeasible" convention Milestone 4
   §13 item 6 established for its own leftover codes.

**Verification**: `pnpm -r exec tsc --noEmit` clean; full `pnpm test` and
both opt-in `RVS_TEST_PACKAGE=1` suites re-run clean; nothing committed at
any point (§10 below).

### 9. Remaining open items

None outstanding against the five explicit closure conditions — all five
are addressed in §8. No other gap is known at this time.

### 10. Confirmation nothing was committed

Same branch as every prior milestone in this file:
`git branch --show-current` reports
`feature/product-identity-executive-showcase`, based on `origin/main` at
`ac3c7c1` (the same commit `git log --oneline -3` shows as `HEAD`) — zero
new commits. `git status --short` shows the same modified/untracked files
as the closure-condition pass above plus test-file edits to
`packages/cli/src/__tests__/{package-smoke.test.ts,
source-vs-package-equivalence.test.ts}`,
`packages/repository-model/src/{workspace-packages.ts,
__tests__/workspace-packages.test.ts}`, and
`packages/product-intelligence/src/{override.ts,
__tests__/override.test.ts}` — all uncommitted. The two fixture
repositories built for §7's cross-repository proof
(`prodintel-fixtures/{fixture-a-task-queue,fixture-b-schema-migrator}`) live
entirely under this session's scratchpad, outside this repository's working
tree — they do not appear in `git status` here and were never staged or
committed anywhere. Nothing was committed during this pass, per the
explicit "Do not commit changes" instruction.

## Milestone 6 — Portfolio and Ecosystem Intelligence

**Status: core engine, presentation integration, and both self-hosting
proofs complete.** Objective: a synthesis stage above Milestone 5's
per-product `ProductIdentityModel`/`CapabilityModel` pipeline — Portfolio
Intelligence combines multiple already-generated, independently-produced
product artifacts (one per product, each product its own repository) into a
single evidence-backed `PortfolioModel`: normalized cross-product
capabilities, product relationships, a dependency graph, overlaps, gaps, an
inferred operating model, and a maturity summary — feeding Portfolio
Showcase Intelligence, a `PortfolioPlan`/`"portfolio"` `VisualDoc` profile —
governed by the same rule every milestone above establishes, raised one
level of abstraction: "portfolio synthesis may raise the level of
abstraction across products, but it must never invent a relationship,
inflate a capability's maturity, or fabricate ownership that the underlying
evidence does not support." No external model, no re-scanning of any
product repository, no repository-specific hard-coded product list,
relationship, or capability name. See
[`docs/portfolio-intelligence.md`](portfolio-intelligence.md) and
[`docs/portfolio-showcase.md`](portfolio-showcase.md) for the complete
design, contracts, pipelines, and self-hosting proofs — this entry records
summary/coverage facts and defers to those two documents for everything
else, the same division of labor Milestones 4 and 5's entries use with
their own design documents.

### 1. Package, contracts, and pipeline

New package `packages/portfolio-intelligence` (`@rvs/portfolio-intelligence`),
21 non-test source modules: `contracts.ts` (the full `PortfolioModel`/
`PortfolioClaim`/`PortfolioDecision`/`PortfolioPlan` shapes, a 12-value
`PortfolioProductRole`, a 13-value `PortfolioSceneType`, a 12-value
`PortfolioClaimRejectionReasonCode`), `product-registry.ts` (`.rvs/portfolio.yml`
loading/validation), `intake.ts`, `compatibility.ts`,
`identity-reconciliation.ts`, `capability-normalization.ts`,
`capability-relationships.ts`, `product-relationships.ts`, `dependencies.ts`,
`overlaps.ts`, `gaps.ts`, `ownership.ts`, `operating-model.ts`, `maturity.ts`,
`claims.ts`, `narrative.ts`, `portfolio-plan.ts`, `validation.ts`,
`exporter.ts`, `ids.ts`, `index.ts` — the same small-pure-single-responsibility-
module shape `@rvs/architecture-intelligence`, `@rvs/capability-intelligence`,
and `@rvs/product-intelligence` all already use. Depends only on
`@rvs/capability-intelligence` and `@rvs/product-intelligence` for input
types (plus `yaml`/`zod` for config parsing) — no dependency in the other
direction. Full contract and pipeline detail:
[docs/portfolio-intelligence.md#the-portfoliomodel-contract](portfolio-intelligence.md#the-portfoliomodel-contract).

### 2. Intake, compatibility gate, and claim control

`intake.ts` reads 2 required (`product-identity.json`, `capability-model.json`)
plus 4 optional (`architecture-intelligence.json`, `repository-model.json`,
`showcase-plan.json`, `showcase-claims.json`) artifacts per configured
product; `compatibility.ts`'s 4-step gate (required-artifact presence,
schema-version match, capability-id intersection, generation-timestamp
staleness) decides, per product, one of 7 `PortfolioCompatibilityStatus`
values before any synthesis runs — an incompatible product is excluded and
recorded on `PortfolioModel.excludedProducts` under `--allow-partial`,
never silently merged. `claims.ts`'s `buildPortfolioClaims()`/
`classifyDraft()` runs unconditionally before narrative synthesis, the same
"claim control is never bypassed" rule Milestone 5 established, widened to
12 portfolio-specific rejection reason codes. Full design:
[docs/portfolio-intelligence.md#intake-and-compatibility-gate](portfolio-intelligence.md#intake-and-compatibility-gate)
and
[docs/portfolio-intelligence.md#claims-and-claim-control](portfolio-intelligence.md#claims-and-claim-control).

### 3. Presentation integration and CLI

New `portfolio-*` `PortfolioSceneType` values (13, in `contracts.ts`, not
`@rvs/visualdoc-schema` — a portfolio scene points at its source
`PortfolioPlan` by `plan_id`/`scene_id` rather than embedding scene content
inline); a new `"portfolio"` `VisualDoc` profile in
`packages/narrative-planner/src/portfolio-visualdoc-builder.ts`; new scene
templates under `packages/renderer-html/src/scenes/portfolio/`. Six new CLI
commands wired into `packages/cli/src/bin.ts`: `rvs synthesize portfolio
[--allow-partial]`, `rvs create slides --profile portfolio [--audience ...]
[--theme ...]`, `rvs export portfolio-model`, `rvs export portfolio-claims`,
`rvs export portfolio-decisions`, `rvs portfolio explain <id>`. `rvs
validate --ci` gained `validateCachedPortfolio()`
(`packages/cli/src/commands/validate.ts`), fully backward-compatible — a
repository that has never run `rvs synthesize portfolio` sees no behavior
change. Full design:
[docs/portfolio-showcase.md](portfolio-showcase.md#the-13-portfolioscenetype-values).

### 4. Self-hosting proof (3-fixture portfolio)

Three independently-shaped generic fixture products — Governance CLI,
Reliability CLI, Migration CLI, each its own git repository with its own
README, source, and CI workflow — were each run through the full
`inspect -> synthesize architecture -> synthesize capabilities -> synthesize
product-identity -> export product-identity` pipeline independently, then
combined via a `.rvs/portfolio.yml` naming all three. **All 3 reached
`compatible_with_warnings`** (warnings only `optional-input-unavailable` on
the 4 optional artifacts; `excludedProducts: []`). governance-cli resolved
archetype `governance_platform` (confirmed) with 4 included capabilities (1
qualified); reliability-cli resolved `reliability_platform` (derived) with 3
included (2 qualified); migration-cli resolved `migration_platform`
(derived) with 4 included (2 qualified). **Portfolio result: 11 normalized
capabilities (7 single-product, 4 overlapping), 3 relationships** (all
`shared_capability`, forming a complete triangle across every product
pair), **4 overlaps** (3 minor pairwise plus 1 material three-way overlap on
"Release and Maintenance" spanning all 3 products), **6 gaps** (5
`qualified_only_coverage` plus 1 `unowned_capability`). **63 claims: 43
approved, 8 approved with qualification, 12 rejected** —
`PORTFOLIO_CLAIM_QUALIFIED_CAPABILITY_UNQUALIFIED` (5x),
`PORTFOLIO_CLAIM_UNSUPPORTED_OWNERSHIP` (4x),
`PORTFOLIO_CLAIM_UNRESOLVED_RELATIONSHIP` (3x — each superseded by the
actual resolved `shared_capability` relationship, not missing evidence).
**9 decisions**: 3 `integration_priority`, 5
`qualified_capability_investment`, 1 `ownership` (urgency `high`,
recommended owner `architecture_council`). `rvs create slides --profile
portfolio --audience portfolio` rendered 11 scenes, no crash; `rvs validate
--ci` reported the portfolio layer itself fully clean (0 errors, 0
warnings, no `PORTFOLIO_*` code firing) — the overall command's exit 1 came
from 6 unrelated rendering-density findings on portfolio scenes, a
scene-layout/design-system concern, not a portfolio-logic defect. Full
narrative, including the exact claim texts and rejection reasoning:
[docs/portfolio-intelligence.md#self-hosting-proof](portfolio-intelligence.md#self-hosting-proof)
and
[docs/portfolio-showcase.md#self-hosting-proof](portfolio-showcase.md#self-hosting-proof).

### 5. Real-project proof (repo-visual-studio as a 4th product)

`rvs export product-identity` against `repo-visual-studio`'s own current
cache reproduces the same conservative result Milestone 5's own proof
established: archetype `unknown`, confidence `unresolved`, 0 current
capabilities, 2 qualified capabilities. Adding this genuinely-scanned (not
hand-authored) artifact as a 4th product to the 3-fixture portfolio, via
`--allow-partial`, reached `compatible_with_warnings`,
`excludedProducts: []`. Portfolio-wide totals became **13 normalized
capabilities, 3 relationships (unchanged), 4 overlaps (unchanged), 8 gaps,
14 decisions**; `rvs synthesize portfolio` logged 0 errors, 0 warnings. The
relationship count staying at 3 — rather than growing to include
repo-visual-studio — is the correct, evidence-honest outcome: this
repository's own capability text doesn't share enough name/domain/actor/
workflow/external-system vocabulary with any of the 3 fixtures to clear
either the capability-merge or weaker relationship-classification
threshold. Adding a 4th, evidence-thin product does not fabricate a
relationship just to make the portfolio look more connected. Full write-up:
[docs/portfolio-intelligence.md#real-project-proof-repo-visual-studios-own-artifacts-as-a-4th-product](portfolio-intelligence.md#real-project-proof-repo-visual-studios-own-artifacts-as-a-4th-product).

### 6. Known, disclosed scope trims

Several declared type values are intentionally not yet computed, each
documented inline in source rather than silently absent: 4 of 8
`PortfolioGapType` values (`no_product_coverage`, `fragmented_coverage`,
`contract_gap`, `operational_gap` — the latter two would require consuming
`architecture-intelligence.json`/`repository-model.json`, already collected
as optional intake but not yet reasoned over); 9 of 10
`PortfolioDependencyEdgeKind` values beyond `depends_on`; the
`deprecation` `PortfolioDecisionType`; and `upstream_dependency`/
`downstream_dependency`/`shared_platform`/`shared_contract` relationship
types, which are only ever populated from `.rvs/portfolio.yml`'s
`approved_relationships`, never inferred automatically. Each is a disclosed,
intentional trim rather than a defect — full rationale in
[docs/portfolio-intelligence.md#known-limitations](portfolio-intelligence.md#known-limitations)
and
[docs/portfolio-showcase.md#known-limitations](portfolio-showcase.md#known-limitations).

### 7. Test coverage and verification

`packages/portfolio-intelligence/src/__tests__/`: 21 test files, one per
source module (`capability-normalization`/`capability-relationships`/
`claims`/`compatibility`/`dependencies`/`exporter`/`fixtures`/`gaps`/
`identity-reconciliation`/`ids`/`index`/`intake`/`maturity`/`narrative`/
`operating-model`/`overlaps`/`ownership`/`portfolio-plan`/`product-registry`/
`product-relationships`/`validation`), plus new tests in
`packages/narrative-planner/src/__tests__/portfolio-visualdoc-builder.test.ts`
and `packages/renderer-html/src/__tests__/portfolio-scene.test.ts`. Full
workspace suite: `pnpm -r exec tsc --noEmit` clean, 0 errors; `pnpm test`
**1184 passed, 9 skipped, 0 failed** across 96 passed + 2 skipped (98) test
files.

### 8. Current repository state

Unlike Milestones 3-5, which each landed as a merged pull request onto
`main` before the next milestone began (`git log --oneline -3` shows
`93e5643` "Merge pull request #3 from
.../feature/product-identity-executive-showcase" as the current tip),
Milestone 6's work sits, uncommitted, on
`feature/portfolio-ecosystem-intelligence`, branched from that same merged
`main`. `git status --short` shows the new `packages/portfolio-intelligence/`
package; new CLI command files (`export-portfolio-{model,claims,decisions}.ts`,
`portfolio-explain.ts`, `synthesize-portfolio.ts`); new
`portfolio-visualdoc-builder.ts` and `scenes/portfolio/` renderer files;
modifications to `packages/cli/src/{bin.ts, commands/create-slides.ts,
commands/validate.ts}` and their tests; modifications to
`packages/narrative-planner/src/index.ts`,
`packages/renderer-html/src/{render.ts, scenes/index.ts, styles.ts}`, and
`packages/visualdoc-schema/src/schema.ts` wiring the new profile and scene
templates in; plus this documentation pass
(`docs/portfolio-intelligence.md`, `docs/portfolio-showcase.md`, this entry,
and forward-reference notes in `docs/architecture-intelligence.md`,
`docs/capability-intelligence.md`, `docs/product-identity-intelligence.md`,
and `README.md`). Nothing from this milestone has been committed.

## Milestone 6.2 — Master Agent Routing, PR Governance, and Repository Maintenance Skills

**Status: complete, uncommitted.** Objective: a deterministic,
documentation-only repository operating layer that tells a repository agent
(Claude Code, Cursor, or similar) which of the four intelligence layers
above (Architecture, Capability, Product, Portfolio) a task actually
requires, when a task needs its own branch and PR versus continuing
existing work, and which Git publication boundaries — commit, push, PR,
merge — require separate, explicit authorization. Unlike every milestone
above, this one adds no synthesis engine, no CLI command, and no runtime
code: the deliverable is read by an agent, not executed by one, per its own
explicit design mandate against building "a complex new policy engine."

### 1. Deliverables

Root routing authority [`MASTER_AGENT.md`](../MASTER_AGENT.md) (~350
lines): task classification into 9 classes, an intelligence-routing matrix,
artifact freshness/reuse rules, a 12-step task-startup protocol, a
task-completion-report shape, an agent-handoff-record template, an explicit
destructive-operation guard list (`git reset --hard`, `git push --force`,
`git rebase`, `git commit --amend`, `rm -rf`, and others), and 5 worked
examples. Two new skills: `skills/pr-governance/` (branch/commit/PR/review/
merge policy across 6 reference files) and `skills/repository-maintenance/`
(health/dependency/documentation/test/dead-code/release workflows across 6
reference files), both alongside 6 new references under the existing
`skills/repo-visual-studio/` skill routing to the intelligence layers
Milestones 3-6 already built. Narrative companions
[`docs/agent-operating-model.md`](agent-operating-model.md),
[`docs/pr-governance.md`](pr-governance.md), and
[`docs/repository-maintenance.md`](repository-maintenance.md). Thin tool
adapters `AGENTS.md`, `CLAUDE.md`, and `.cursorrules` at repo root, each
pointing at `MASTER_AGENT.md` rather than duplicating it. A
`.github/PULL_REQUEST_TEMPLATE.md` with conditional-wording sections so it
doesn't force fields that don't apply to documentation-only or test-only
PRs, and explicitly no automated-approval or automated-merge language.

### 2. Explicit exclusions

Per its own binding scope, this milestone adds none of: architecture drift
detection, continuous repository monitoring, scheduled portfolio synthesis,
automated PR approval or merging, autonomous production changes, GitHub
organization scanning, remote repository crawling, live telemetry, an
external LLM call, Milestone 7-class governance policy, product
consolidation recommendations, automatic issue creation, automatic branch
deletion, or automatic dependency upgrades. `tests/agent-governance.test.ts`
includes a structural check that the routing/governance layer never
describes any of these as implemented.

### 3. Validation

Because the deliverable is documentation, not a runtime engine, validation
is structural rather than behavioral: a new root-level
`tests/agent-governance.test.ts` (86 tests) confirms every file the
operating model promises exists, every relative markdown link across
`MASTER_AGENT.md`, the three skill files, and the three narrative docs
resolves to a real file, skill frontmatter names match their directories
with no duplicates, the tool adapters point at `MASTER_AGENT.md` without
restating its routing table or authorization list, `MASTER_AGENT.md` names
every Git publication boundary and states that authorizing one never
authorizes the next, the PR-governance skill distinguishes new tasks from
continuations and forbids bundling unrelated work, and the
repository-maintenance skill's dead-code evidence bar and dependency
routing rules are present as written. Full workspace `pnpm -r exec tsc
--noEmit` and `pnpm test` were re-run against this milestone's changes with
no regressions introduced; this milestone's own code footprint does not
touch CLI packaging, so `RVS_TEST_PACKAGE=1 pnpm test` was not re-run for
it specifically.

### 4. Current repository state

Built directly on top of Milestone 6's uncommitted work on
`feature/portfolio-ecosystem-intelligence` (Milestone 6 itself later landed
as commit `7d1a12f`, hardened by a follow-up commit `0f4a212`, and Milestone
6's pull request — PR #4 — was opened during the same working session that
produced this milestone's request, ahead of this entry being written).
Per this milestone's own explicit, repeated instruction, none of this
milestone's files were committed, pushed, merged, or included in any pull
request; everything above is left staged in the working tree for review.
Neither `7d1a12f` nor `0f4a212` was modified, amended, squashed, or
rewritten.

## Milestone 7 — Architecture Governance and Continuous Intelligence

**Status: core engine, presentation integration, and CLI complete.**
Objective: a read-only comparison and policy layer sitting above the entire
Repository Evidence → Architecture Intelligence → Capability Intelligence →
Product Identity Intelligence → Portfolio Intelligence stack Milestones 1-6
built — Architecture Governance fingerprints the already-synthesized cached
artifacts those five layers produce into an `IntelligenceSnapshot`, diffs two
snapshots (a promoted baseline vs. the current repository state, or any two
named snapshots) into per-domain change sets, assesses how far each change's
effects reach (`BlastRadiusLevel`), evaluates a finite, typed policy engine
against the changes, and composes the result into a
`ContinuousIntelligenceReport`, a claim-controlled `GovernanceNarrative`, and
a `"governance"` `VisualDoc` profile — feeding a new `rvs governance check
--ci` gate a CI pipeline can block a merge on. It never re-scans a
repository, never re-synthesizes an upstream artifact, and never calls an
external model. See [`docs/architecture-governance.md`](architecture-governance.md),
[`docs/continuous-intelligence.md`](continuous-intelligence.md),
[`docs/governance-policies.md`](governance-policies.md),
[`docs/governance-baselines.md`](governance-baselines.md), and
[`docs/governance-showcase.md`](governance-showcase.md) for the complete
design, contracts, policy-authoring reference, and presentation layer — this
entry records summary/coverage facts and defers to those five documents for
everything else, the same division of labor every milestone entry above uses
with its own design documents.

### 1. Package, contracts, and pipeline

New package `packages/governance-intelligence` (`@rvs/governance-intelligence`),
24 non-test source modules: `contracts.ts` (the full `IntelligenceSnapshot`/
`GovernanceBaseline`/`*ChangeSet`/`GovernancePolicy`/`GovernanceFinding`/
`BlastRadiusAssessment`/`ContinuousIntelligenceReport`/`GovernanceNarrative`/
`GovernancePlan` shapes, an 11-value `GovernanceRuleKind`, a 13-value
`GovernanceSceneKind`, a 10-value `GovernanceClaimRejectionReason`),
`ids.ts`, `constants.ts`, `snapshot.ts`, `compatibility.ts`,
`change-classification.ts`, `architecture-diff.ts`, `capability-diff.ts`,
`product-diff.ts`, `portfolio-diff.ts`, `evidence-diff.ts`, `diff-utils.ts`,
`blast-radius.ts`, `governance-config.ts`, `policy-loader.ts`,
`policy-evaluator.ts`, `findings.ts`, `baseline.ts`, `claims.ts`,
`narrative.ts`, `governance-plan.ts`, `validation.ts`, `explain.ts`,
`index.ts` — the same small-pure-single-responsibility-module shape every
upstream intelligence package already uses. `package.json` declares
dependencies on only `yaml` and `zod` (config parsing) — no dependency on
`@rvs/architecture-intelligence`, `@rvs/capability-intelligence`,
`@rvs/product-intelligence`, or `@rvs/portfolio-intelligence`, at either the
runtime or the type level (see the "Layering note" at the top of
`contracts.ts`). Full contract and pipeline detail:
[docs/architecture-governance.md](architecture-governance.md) and
[docs/continuous-intelligence.md](continuous-intelligence.md).

### 2. Presentation integration and CLI

New `GovernanceSceneKind` values (13, canonical order declared in
`contracts.ts`, not `@rvs/visualdoc-schema` — a `governance-scene` VisualDoc
type points at its source `GovernancePlan` by `plan_id`/`scene_id` rather
than embedding scene content inline, the same pointer-scene pattern
`@rvs/portfolio-intelligence`'s `portfolio-plan.ts` established); a new
`"governance"` `VisualDoc` profile in
`packages/narrative-planner/src/governance-visualdoc-builder.ts`; new scene
templates under `packages/renderer-html/src/scenes/governance/`. Nine new CLI
surfaces wired into `packages/cli/src/bin.ts`: `rvs snapshot create [--name]
[--output] [--include-portfolio] [--allow-partial]`, `rvs governance baseline
show`, `rvs governance baseline set <snapshot> [--force]`, `rvs governance
baseline validate`, `rvs governance compare [--from] [--to]`, `rvs governance
check [--from] [--to] [--ci]`, `rvs governance explain <id>`, `rvs export
governance-report [--output]`, `rvs export governance-summary [--output]`,
plus `"governance"` added to `rvs create slides --profile <id>`'s accepted
profile list. A new `packages/cli/src/governance-cache.ts` module defines and
implements the CLI-layer "snapshot envelope" on-disk format
(`{ snapshot: IntelligenceSnapshot, rawArtifacts: RawArtifacts }`) — an
addition purely to this CLI's own cache layout, since
`@rvs/governance-intelligence`'s own `IntelligenceSnapshot` type deliberately
never embeds the raw architecture/capability/product/portfolio JSON it was
fingerprinted from, only a per-domain digest. Full design:
[docs/governance-showcase.md](governance-showcase.md) and
[docs/governance-baselines.md](governance-baselines.md#the-snapshot-envelope-format).

### 3. Key design decisions

- **Content-derived ids everywhere.** `ids.ts` mirrors
  `@rvs/portfolio-intelligence/src/ids.ts`'s pattern exactly: every snapshot/
  change-set/change/finding/policy/rule/evaluation id is a pure function of
  stable content already present in the artifacts being governed — never a
  timestamp, wall-clock generation time, or array index — so two governance
  runs over identical input state produce byte-identical ids (verified by
  `determinism.test.ts` and `no-change-identity.test.ts`).
- **Zero type coupling to upstream packages.** `contracts.ts`'s own
  "Layering note" states it directly: nothing in `governance-intelligence`
  imports from any of the four upstream intelligence packages. Where a shape
  needs to echo an upstream concept (e.g. `EvidenceRef`), it defines its own
  minimal structural echo rather than importing the real type.
- **An 11-rule-kind finite policy engine, not an expression language.**
  `GovernanceRuleKind` is a closed union of 11 named kinds
  (`forbid_component_removal`, `require_runtime_entrypoint`,
  `require_capability_status_at_least`,
  `forbid_operational_to_planned_regression`, `require_evidence_type`,
  `forbid_dependency_removal`, `require_shared_contract_for_dependency`,
  `forbid_approved_claim_without_lineage`, `require_product_role`,
  `limit_unresolved_relationships`, `require_compatible_snapshot`), each with
  its own fully-typed condition payload; `policy-evaluator.ts` branches on
  `kind` and reads only the fields the matching condition interface declares
  — a `.rvs/governance.yml`/policy file can never express more than the
  engine actually knows how to evaluate deterministically, and nothing is
  ever `eval`'d or dynamically `require`'d (`governance-config.ts`'s own
  header comment states this explicitly, since policy files are untrusted
  input from the scanned repository). These 11 kinds implement roughly two
  dozen worked policy examples through configuration (different scoping
  patterns, severities, and thresholds over the same kind), not one bespoke
  rule kind per example — the full kind-to-example mapping is in
  [docs/governance-policies.md](governance-policies.md).
- **Conservative blast-radius assessment: unresolved is never isolated.**
  `blast-radius.ts`'s own header states the rule directly: "when the
  artifact carries no linkage/consumer data for an entity, level MUST be
  unresolved, NEVER isolated" — a confirmed absence of any linked
  consumer/neighbor is `isolated`; a structural absence of any way to even
  ask the question is `unresolved`. This package never treats "I don't know"
  as "no impact," matching every upstream layer's own conservative-bias
  requirement.
- **A standalone CI gate, not an extension of `rvs validate --ci`.**
  `rvs governance check --ci` fails the build itself
  (`packages/cli/src/commands/governance-check.ts`) rather than folding into
  `packages/cli/src/commands/validate.ts`, which carries zero governance
  references on this branch — a repository that has never run `rvs
  governance compare` sees no change to `rvs validate --ci`'s behavior.
  `--ci` exits non-zero only when an un-excepted finding's severity is in
  the configured `comparison.fail_on` list (default: `["blocking"]`, from
  `governance-config.ts`'s `.rvs/governance.yml` schema).
- **A snapshot envelope format enabling two-sided historical diffing.**
  Rather than only ever diffing a baseline against "whatever `.rvs/cache/`
  holds right now," `rvs snapshot create` writes every snapshot (and `rvs
  governance baseline set` writes the promoted baseline) as a
  `SnapshotEnvelope` carrying both the typed `IntelligenceSnapshot`
  fingerprint and the raw artifact JSON it was computed from — so
  `rvs governance compare --from <snapshot> --to <snapshot>` can diff any two
  historical points, not only "then vs. now."
- **The `governance` slide profile is never audience-scoped.**
  `create-slides.ts`'s governance branch hardcodes `audience: "governance"`
  and `theme: "technical-grid"` (unless `--theme` overrides it) and ignores
  `--audience` entirely — a governance comparison reports what changed and
  whether it violates policy, a single deterministic artifact of the two
  snapshots compared, not a narrative that varies by who's reading it, per
  `governance-visualdoc-builder.ts`'s own doc comment.

### 4. Known, disclosed scope trims

- **No git-worktree two-commit helper.** The milestone's originating spec
  contemplated a convenience command that would check out two git commits
  into worktrees and run the full artifact pipeline against each before
  diffing. That helper was not built on this branch — `rvs snapshot create`
  plus `rvs governance compare --from --to` already satisfy the milestone's
  core requirement (comparing any two historical intelligence states) once
  each state's artifacts have been independently produced by the existing
  `synthesize`/`inspect` commands at each commit; scripting the two-checkout
  convenience wrapper is left as a follow-up. Confirmed absent: no
  `worktree`-referencing code exists anywhere under
  `packages/governance-intelligence` or `packages/cli/src` on this branch.
- **The GitHub Actions workflow is documented-only, not executed in CI
  here.** `docs/governance-baselines.md`/`docs/continuous-intelligence.md`
  document a sample `rvs governance check --ci` workflow step for a
  consuming repository's own CI, but no `.github/workflows/*governance*`
  file exists in this repository — nothing here has actually exercised the
  gate inside a real GitHub Actions run.
- **11 named rule kinds implement the spec's worked examples through
  configuration, not one bespoke rule kind per example.** Documented under
  "Key design decisions" above; full mapping in
  [docs/governance-policies.md](governance-policies.md).
- Full rationale for all three trims, plus every other declared-but-not-yet-
  computed value: [docs/architecture-governance.md#known-limitations](architecture-governance.md#known-limitations).

### 5. Test coverage and verification

`packages/governance-intelligence/src/__tests__/`: 24 test files (one per
source module, plus `governance-fixtures.ts` as a shared, non-test fixture
helper) — `adversarial`, `architecture-diff`, `baseline`, `blast-radius`,
`capability-diff`, `change-classification`, `claims`, `compatibility`,
`determinism`, `evidence-diff`, `explain`, `findings`, `governance-config`,
`governance-plan`, `narrative`, `no-change-identity`, `policy-evaluator`,
`policy-loader`, `portfolio-diff`, `product-diff`, `regression`, `scale`,
`snapshot`, `validation` — 238 test-case declarations across roughly 5,300
lines of test source, including dedicated `determinism.test.ts` (byte-
identical-output verification) and `no-change-identity.test.ts` (a snapshot
diffed against itself must classify every entry `unchanged`) suites neither
of which any upstream package needed in the same form. Plus new
`packages/cli/src/__tests__/governance-cli.test.ts` (497 lines, in-process
CLI command tests matching `portfolio-cli.test.ts`/`validate.test.ts`'s
established no-subprocess convention),
`packages/narrative-planner/src/__tests__/governance-visualdoc-builder.test.ts`,
and `packages/renderer-html/src/__tests__/governance-scene.test.ts`; plus
modifications to `packages/cli/src/__tests__/source-vs-package-equivalence.test.ts`
and `packages/visualdoc-schema/src/__tests__/schema.test.ts` for the new
`governance-scene` VisualDoc type. Full workspace suite: `pnpm -r exec tsc
--noEmit` clean, 0 errors; `pnpm test` **1599 passed, 9 skipped, 0 failed**
across **125 passed + 2 skipped (127) test files** — both figures read
directly from this pass's own `pnpm test` run, not carried over from
Milestone 6's numbers.

### 6. Current repository state

Milestone 7's work sits, uncommitted, on `feature/architecture-governance`,
branched from `origin/main` at `3873113` ("Merge pull request #4 from
.../feature/portfolio-ecosystem-intelligence" — the same commit Milestone
6's entry above records as its own closing state, confirming this branch
adds no other repository state in between). `git status --short` shows: the
new `packages/governance-intelligence/` package; new CLI command files
(`governance-baseline.ts`, `governance-check.ts`, `governance-compare.ts`,
`governance-explain.ts`, `snapshot-create.ts`, `export-governance-report.ts`,
`export-governance-summary.ts`) and the new `governance-cache.ts` module;
new `governance-visualdoc-builder.ts` and its test; new
`scenes/governance/` renderer files and their test; modifications to
`packages/cli/src/{bin.ts, commands/create-slides.ts,
__tests__/source-vs-package-equivalence.test.ts}` and `package.json`;
modifications to `packages/narrative-planner/src/index.ts` and
`package.json`; modifications to
`packages/renderer-html/src/{render.ts, scenes/index.ts, styles.ts}` and
`package.json`; modifications to
`packages/visualdoc-schema/src/{schema.ts, __tests__/schema.test.ts}` wiring
the new `governance-scene` VisualDoc type in; a `pnpm-lock.yaml` update; plus
this documentation pass (`docs/architecture-governance.md`,
`docs/continuous-intelligence.md`, `docs/governance-policies.md`,
`docs/governance-baselines.md`, `docs/governance-showcase.md`, this entry,
forward-reference notes in `docs/architecture-intelligence.md`,
`docs/capability-intelligence.md`, `docs/product-identity-intelligence.md`,
`docs/portfolio-intelligence.md`, and `README.md`, and a new governance
workflow entry in `skills/repo-visual-studio/SKILL.md`).

`MASTER_AGENT.md` does not exist on this branch and is out of scope for this
milestone's documentation pass: it belongs to a separate, deliberately
decoupled branch (`docs/agent-operating-model`, Milestone 6.2), itself
uncommitted to `main`, that this milestone does not touch, reference, or
depend on in any way — a decoupling decision the user explicitly confirmed
before this pass began.

Nothing from this milestone has been committed, pushed, merged, or opened as
a pull request. `feature/architecture-governance` remains fully decoupled
from Milestone 6.2's separate `docs/agent-operating-model` branch, by the
same deliberate, user-confirmed decision recorded immediately above — the
two branches share no commits beyond their common ancestor at `main`/
`origin/main`'s `3873113`, and neither this pass nor any prior one has
merged, rebased, or cherry-picked work between them.
