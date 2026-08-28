# Packaging

How `@rvs/cli` is built, what ships in the npm tarball, and how it behaves
once installed outside this pnpm workspace. See
[`docs/milestones.md`](milestones.md) for the packaging work's completion
record and acceptance-criteria results; this document is the reference for
*how the mechanism works*, kept up to date as packaging evolves.

## Distribution model

**Bundling**, not multi-package publishing. Every internal `@rvs/*`
package is compiled straight into a single `dist/bin.cjs` — the original
set (`core`, `repository-model`, `narrative-planner`, `visualdoc-schema`,
`renderer-html`, `validator`, `exporter`, `workflow-graph`,
`workflow-mermaid`, `workflow-svg`), the intelligence packages added since,
and the Milestone 10 visual stack (`visual-intelligence`,
`visual-grammar`, `visual-composition`, `visual-explorer`,
`visual-change-review`, `visual-delivery`). A consumer of the published `@rvs/cli` package
never resolves a `workspace:*` or `@rvs/*` dependency, because after the
build there aren't any.

`playwright` and `@cdktf/hcl2json` are the exceptions: they stay external,
real npm dependencies rather than being bundled. Playwright manages its
own browser-binary download logic keyed to its own package location —
bundling it would fight that rather than help it, and Chromium binaries
must never ship inside the CLI tarball. `@cdktf/hcl2json` ships a WASM
payload that has to be resolved from its own package directory.

### The visual stack's packaging path

```
packages/visual-intelligence ─┐
packages/visual-grammar       ├─ workspace:* devDependencies of @rvs/cli
packages/visual-composition   │  (never runtime dependencies)
packages/visual-explorer      │
packages/visual-change-review │
packages/visual-delivery      ┘
                              │
                              ▼
                    esbuild (bundle: true)
                              │
                              ▼
              packages/cli/dist/bin.cjs   ← the only thing that ships
```

Nothing in that chain is published, which is exactly why none of it may
appear under `dependencies`. An earlier packaging defect left bundled
visual packages listed as runtime `workspace:*` dependencies; an installed
consumer was then told to fetch packages that exist on no registry. The
guard against recurrence is an assertion over the *packed* manifest rather
than the source one, because `pnpm pack` rewrites `workspace:*` to a
concrete version as it packs — so a runtime `@rvs/*` entry would no longer
be recognizable by the `workspace:` marker alone. The rule enforced is
therefore the stronger one: **no `@rvs/*` key may appear in the packed
manifest's `dependencies` at all**, whatever version range it carries.

The browser half of the visual stack (the explorer's and change review's
interaction algorithms and the semantic-motion player) is authored as text
in the visual packages, inlined into `dist/bin.cjs` as ordinary string
constants, and written into the generated HTML. The build applies no
minification, so those payloads reach an installed consumer character for
character as the source workspace emits them — which is what makes
byte-level source/package comparison of a rendered artifact possible at
all.

Internal package boundaries are preserved in source (each `@rvs/*` package
still has its own `package.json`, own tests, own `tsc --noEmit` target) —
bundling only changes how the *distributed artifact* is produced, not how
the workspace is organized or developed against. A future plugin system
could still publish additional `@rvs/*` packages independently without
changing this model; it would only need to decide whether a given plugin
bundles into the CLI or loads at runtime as its own installed package.

**Alternative considered and rejected**: publishing each `@rvs/*` package
independently to npm with real semver, and letting `@rvs/cli` depend on
published versions. Rejected because it requires a coordinated
multi-package release/versioning process (out of scope — this milestone
explicitly excludes npm publishing and release automation), and because
none of the internal packages have a use case as a standalone dependency
outside the CLI today.

## Build system

`esbuild`, driven by `packages/cli/scripts/build.mjs` (a plain Node script,
run directly — not itself bundled). Chosen over Rollup/tsc/webpack for
speed and because a single bundled entry point with one external
(`playwright`) is exactly esbuild's core use case; nothing about this
target needs a second build tool.

The script:

1. Wipes and recreates `dist/` and `assets/`.
2. Bundles `src/bin.ts` → `dist/bin.cjs` — `bundle: true`, `platform:
   "node"`, `format: "cjs"`, `target: "node20"`, `sourcemap: true`,
   `external: ["playwright", "@cdktf/hcl2json"]`. No `minify` — see
   [The visual stack's packaging path](#the-visual-stacks-packaging-path)
   for why the absence of minification is load-bearing.
3. Copies `design-systems/` → `assets/design-systems/` and
   `skills/repo-visual-studio/` (which already contains
   `schemas/visualdoc.schema.json`) → `assets/skills/repo-visual-studio/`.

CJS output, not ESM: bundled CJS dependencies (e.g. `yaml`'s CJS build)
contain interop-only `require(...)`-style calls esbuild cannot statically
resolve when targeting ESM, and throw at runtime
(`Dynamic require of "..." is not supported`). CJS output lets esbuild pass
those requires through natively. The `.cjs` extension forces Node to parse
the file as CommonJS regardless of `@rvs/cli`'s own `"type": "module"`.

`pnpm --filter @rvs/cli build` is deterministic: re-running it against
unchanged source reproduces the same bundle apart from the sourcemap's
embedded absolute build-machine paths.

## Runtime dependency strategy

- **Real npm dependencies**: `playwright` and `@cdktf/hcl2json` only.
- **Bundled into `dist/bin.cjs`**: every `@rvs/*` internal package, plus
  their third-party transitive dependencies (`commander`, `yaml`, `zod`,
  `fast-glob`, `mdast-util-to-string`, `remark-parse`, `unified`,
  `unist-util-visit`, `simple-git`) — all pure JS, all bundle-safe.
- **`devDependencies` only**: all `@rvs/*` packages (so pnpm still
  workspace-links them for `tsx` dev mode and `tsc --noEmit`), `commander`,
  `esbuild`, `typescript`, `@types/node`. None of these reach a consumer's
  install — `npm install <tarball>` never installs another package's
  `devDependencies`.
- **Never required at runtime**: `tsx`, `ts-node`, or any TypeScript
  compiler. The published bin (`dist/bin.cjs`) is plain compiled
  JavaScript.
- **Test frameworks** (`vitest`): dev-only, never enter the runtime
  tarball — enforced by the `files` allowlist below, not just by
  dependency classification.

Playwright's Chromium browser binary is a separately-installed capability
(`npx playwright install chromium`), not a package dependency — see
[Playwright and Chromium](#playwright-and-chromium) below.

## Asset resolution

Runtime assets (design systems, the agent skill, the generated VisualDoc
JSON Schema) are resolved relative to the *running module's own file
location*, via `fileURLToPath(import.meta.url)` / `__dirname` — never
`process.cwd()`, a fixed `../../..` monorepo-depth assumption, a sibling
workspace path, or a global-npm-layout assumption.

`packages/cli/src/module-dir.ts` provides `moduleDir(importMetaUrl)`,
which works under both module systems the CLI actually runs in: dev-mode
`tsx` (real ESM, `import.meta.url` available, no `__dirname`) and the
compiled CJS bundle (`__dirname` available natively via esbuild's CJS
shim, `import.meta.url` is a dead reference). It probes with `typeof
__dirname !== "undefined"`, which never throws in either module system.

`packages/cli/src/paths.ts` builds every asset root on top of `moduleDir`,
with a packaged-first / monorepo-fallback resolution order:

| Export | Packaged install resolves to | Monorepo dev checkout falls back to |
| --- | --- | --- |
| `RVS_INSTALL_ROOT` | `node_modules/@rvs/cli` | `packages/cli` |
| `RVS_ASSETS_ROOT` | `node_modules/@rvs/cli/assets` | `RVS_INSTALL_ROOT` (no `assets/` dir exists) |
| `DESIGN_SYSTEMS_ROOT` | `.../assets/design-systems` | `<repo root>/design-systems` |
| `SKILLS_ROOT` | `.../assets/skills/repo-visual-studio` | `<repo root>/skills/repo-visual-studio` |
| `SCHEMAS_ROOT` | `SKILLS_ROOT/schemas` | `SKILLS_ROOT/schemas` |

Each fallback is decided by `existsSync` on the packaged path, not by
detecting "am I running from `dist/`" — so the same compiled `dist/bin.cjs`
resolves correctly whether it sits under a consumer's `node_modules`, is
installed globally, or is invoked via `npx` from a cache directory,
including install paths containing spaces.

`rvs doctor` verifies each of these roots exists and reports the resolved
path (see [`rvs doctor` output](#rvs-doctor-output)); a missing design
system or skill directory is reported as an explicit `NOT found` line
rather than failing silently later at render time.

## Tarball structure

`packages/cli/package.json` declares an explicit `files` allowlist:

```json
"files": ["dist/**", "assets/**", "README.md"]
```

`npm pack --dry-run` (run from `packages/cli/`) is the authoritative way
to confirm actual contents before every release; see
[`docs/milestones.md`](milestones.md) for the exact file list and size
from the most recent verification run. The allowlist model means new
source directories, caches, or fixtures added anywhere in the workspace
never leak into the tarball by accident — only paths explicitly listed
are ever packed, regardless of `.gitignore` state.

Excluded by construction (not on the allowlist, so `npm pack` never
considers them): source `.ts` files, `.rvs/cache/`, generated
decks/PDFs/artifacts, test fixtures and `__tests__/` directories,
Playwright browser binaries (never downloaded into the package tree in the
first place — see below), nested `node_modules`, `.env`/credential files,
and monorepo-only config (`pnpm-workspace.yaml`, root `tsconfig.base.json`,
CI workflow files).

## Monorepo / workspace detection (`rvs init`)

`rvs init` no longer writes a fixed single-package source list
unconditionally. `packages/core/src/workspace.ts`'s `detectWorkspace(repoRoot)`
checks, in order:

1. `pnpm-workspace.yaml` → `kind: "pnpm"`, package globs read from its
   `packages:` field (falling back to `["packages/*"]` if absent or
   unparseable).
2. `package.json`'s `workspaces` field (array or `{ packages: [...] }`
   shape) → `kind: "npm"`, or `kind: "yarn"` if a `yarn.lock` is also
   present.
3. Neither present → `kind: "single-package"`.

Negated globs (`!packages/legacy-*`) are filtered out rather than
expanded. A malformed `package.json` falls back to `single-package` rather
than throwing — `rvs init` must never crash on an unusual manifest.

For a detected workspace, `defaultConfig(projectName, workspace)` layers
`packages/*/package.json` and `packages/*/src/**` include patterns (one
pair per detected package glob) on top of the concise single-package
defaults, and broadens the exclude list with `**/node_modules/**` and
`**/dist/**` so nested per-package build output and dependencies are never
scanned — without needing to walk `node_modules` to figure that out.
`rvs init`'s console output explains which globs were detected and why
the extra patterns were added. Calling `defaultConfig(projectName)` with
no second argument (every pre-existing call site in the codebase) is
unaffected — the workspace parameter is optional and only activates this
layering when explicitly passed.

## Version compatibility

- **CLI version** (`rvs --version`, from the installed package's own
  `package.json`, not a hardcoded constant) describes the distributed
  product as a whole.
- **VisualDoc schema version** and **WorkflowGraph schema version** are
  independent counters, each read from its schema module's own literal
  version field (`VisualDocSchema.shape.version`,
  `WORKFLOW_GRAPH_SCHEMA_VERSION`) — not derived from the CLI version.
- **Policy**: additive schema changes (new optional field, new enum
  member) do not require a CLI major version bump. A breaking schema
  change (removing/renaming a field, changing required-ness) requires a
  documented migration note and a CLI major version bump, since older
  readers of a generated artifact could otherwise silently misinterpret
  it.
- **Design systems** and the **agent skill** version independently of the
  CLI: `design-systems/index.json` carries a per-pack version, and
  `skills/repo-visual-studio/SKILL.md` carries its own frontmatter
  version. Neither is expected to change on every CLI release.

`rvs doctor` reports all of the above together (see next section) so a
mismatch is visible in one place without cross-referencing multiple files.

## `rvs doctor` output

Run `rvs doctor` from any directory. It reports, without ever printing a
secret or a full environment-variable dump:

- CLI version, Node version, OS/architecture
- Installation type (`packaged` vs `workspace-source`, detected by
  whether a packaged `assets/` directory exists next to the running
  module)
- CLI executable path (`process.argv[1]`)
- Package root, asset path, design-systems path, schemas path, skill path
  — each with a found/not-found status
- VisualDoc schema version, WorkflowGraph schema version
- Current working directory
- Repository root (nearest ancestor directory containing `.git`), or an
  explicit "not inside a git repository" line
- `.rvs/config.yml` presence
- Playwright package availability and version
- Whether Chromium actually launches, with an actionable
  `npx playwright install chromium` message when it doesn't

## Agent skill packaging

`skills/repo-visual-studio/` (SKILL.md, reference docs, the generated
`visualdoc.schema.json`) is copied into the tarball at
`assets/skills/repo-visual-studio/` by the build script, so it travels
with the installed CLI rather than only existing in the source checkout.

`rvs doctor` reports the resolved skill path, and `rvs skill path` prints
just that path (non-zero exit with an actionable message if it's missing)
— useful for a script or agent harness that wants to locate the packaged
skill definition programmatically. Neither command modifies any global
Claude/Cursor/Codex/Gemini configuration directory; automatically
installing the skill into an agent's global tool directory
(`rvs agent install`) is explicitly out of scope for this milestone.

## Playwright and Chromium

`playwright` (the npm package, providing the driver/API) is a normal
runtime dependency of `@rvs/cli` and is installed automatically by
`npm install`. The Chromium **browser binary** is not — Playwright manages
browser binaries as a separate download step
(`npx playwright install chromium`), and bundling or vendoring that binary
inside the CLI tarball is explicitly out of scope (it would make the
package enormous and platform-specific).

`rvs export pdf` (and the Chromium-launch check inside `rvs doctor`) fails
with an actionable message — not a stack trace, not a silent partial
output — when Chromium isn't installed, both from the workspace source and
from the packaged distribution.

## Offline guarantees

The compiled distribution makes no runtime network requests during the
default pipeline (`init → inspect → brief → create slides → validate →
export pdf`, and `create workflow`): no CDN-hosted Mermaid/fonts/scripts,
no remote stylesheets or images in generated HTML/SVG, no automatic update
check, no telemetry. The one network-touching operation in the entire
system is `npx playwright install chromium` itself, which is an explicit,
user-initiated one-time setup step, not something the CLI triggers on its
own.

## Installed-tarball equivalence

Packaging is not proven by "the CLI starts". It is proven by generating
the same artifacts twice — once from workspace source through `tsx`, once
from a real tarball installed into a fresh external project — and
requiring them to be the same artifact.

`packages/cli/src/__tests__/source-vs-package-equivalence.test.ts` builds
the CLI, packs it, `npm install --no-save`s the tarball into a temporary
directory outside this repository whose path contains spaces, and drives
both engines through identical scenarios: the interactive architecture
explorer, the before/delta/after change review, the dependency-graph
grammar, and root-cause grouping. The packaged side is invoked only as
`npx rvs` or as the installed `dist/bin.cjs`; the source checkout is
removed from `PATH` and every `npm_*`/`PNPM_*`/`NODE_PATH` variable is
stripped, so a packaged run that silently reached back into the monorepo
would fail rather than pass.

What is compared, per artifact:

| Layer | Compared as |
| --- | --- |
| VisualCommunicationSpec | the `data-rvs-*` spec attributes: id, schema version, intent, grammar, detail mode, motion intent, audience, format, focal ids |
| Semantic design tokens | every `--rvs-*` custom property and its value |
| Primitive / state model | the serialized `#rvs-model` / `#rvs-review` JSON island — nodes, edges, entities, changes, paths, unresolved relations, lenses, glyphs |
| FidelityReceipt | the rendered receipt section in full: counts, preserved ids, collapsed groups, hidden ids, stand-ins, split views, reason codes, digests |
| Accessibility metadata | every `aria-*`, `role`, `tabindex`, `<title>`/`<desc>` |
| MotionPlan | the inlined `MOTION_ALGORITHMS` text, executed in an isolated `node:vm` context on both sides over every motion mode including the budget-compression path and reduced motion |
| Motion runtime | the `MOTION_PLAYER` payload, character for character |
| SVG geometry | the `<svg>` subtree, unnormalized — a geometry difference is a defect, not a tolerance |
| Rendered HTML | byte-for-byte, after every layer above has been diffed individually so a failure names the layer that broke |

Byte identity is asserted rather than approximated: the interactive
artifacts embed no timestamp, no absolute path and no run-specific value,
so there is nothing legitimate to normalize away. Five values are
normalized anywhere in that test file, none of them belonging to a visual
artifact, and each is declared at the point it is applied: the validator
report's `generated_at` and `source_file`, the run root quoted inside an
expected-error message, `rvs doctor`'s own path lines and Playwright
version (the isolated install resolves the `^1.48.0` range for itself),
and `npm warn`/`npm notice` lines that `npx` prints about the ambient npm
configuration before `rvs` starts.

Beyond equivalence, the same test asserts the packaging properties that
equivalence alone would not catch: the packed file list contains no source,
fixtures, caches, coverage or artifacts; all three design profiles resolve
from `assets/design-systems` with no silent theme fallback; the generated
pages declare their offline CSP and reference no remote asset; the motion
runtime contains no `eval`, `new Function`, `innerHTML`, `setInterval`,
`requestAnimationFrame`, `fetch(`, `XMLHttpRequest` or `WebSocket`; five
consecutive packaged runs from five differently-named directories produce
identical output; and shuffling every input array produces identical
output.

Finally, Playwright drives the *real generated files* — not hand-authored
fixtures — from both sides, comparing focused ids, selected ids, route
ids, motion emphasis, announcement text and reduced-motion behaviour.

### Verified delivery, packaged

The same test file runs the whole delivery gate through the installed CLI:
six `--verified` invocations against two targets — explorer V1 promotes,
V2 is refused with the browser made unreachable, V3 promotes; then the
same three stages for the change review. Compared between source and
package: the candidate identity, the verification profile and its config
digest, the verification digest, every finding, the repair receipt (JSON
and Markdown), the promotion state, the verified/last-known-good metadata,
the console output line for line, and the promoted target's bytes. Two
further normalizations are declared there, both belonging to what a CLI
*said* rather than to what it drew: the three clock fields
(`created_at`, `verified_at`, `generated_at`) and Playwright's own browser
build string inside the "browser verification is unavailable" message,
which names a build path that necessarily differs between an isolated
install and the workspace.

A second packaged test repeats a full verified promotion with the network
hard-blocked by a `--require` preload, and asserts the candidate id,
verification digest and promoted bytes match the online packaged run.
Chromium launches over a pipe rather than a socket, so the complete
interactive profile — rendered layout, accessibility and keyboard
interaction — really runs under that block rather than degrading to a
browser-free subset.

The packaged middle stage is an *infrastructure* refusal rather than a
content one, and that is a property of the system rather than a gap: `rvs`
verifies only what its own renderers just produced, and those renderers
never emit a content-invalid candidate. The content rejections are proved
at source level against real validator output. The reasoning is written
out in [`verified-preview.md`](verified-preview.md#why-the-packaged-proof-rejects-on-infrastructure).

One scenario is compared indirectly, and the reason is worth stating
rather than hiding: the `root_cause` intent and `fishbone` grammar exist
and are selected by `@rvs/visual-intelligence`, but no CLI command renders
through them — `rvs graph roots`, the root-cause surface, emits grouped
causes as text and JSON, not a drawing. The suite therefore compares the
layer that genuinely exists on both sides (the grouped-cause analysis and
its evidence) and separately asserts that the grammar itself survived
bundling, rather than adding a production command purely so a test could
say "fishbone".

These tests build and install a real tarball, so they are gated behind
`RVS_TEST_PACKAGE=1` and skipped in a normal `pnpm test` run:

```bash
pnpm test                      # workspace behaviour
RVS_TEST_PACKAGE=1 pnpm test   # + pack, install and compare
```

## Installation scenarios covered

- **Project-local install** (`npm install /path/to/rvs-cli.tgz` inside a
  clean git repo, then `npx rvs ...`) — the primary supported path.
- **Install path containing spaces** — asset resolution and every command
  work identically, since resolution is always relative to the running
  module's own path, never a string-parsed CWD.
- **Outside the source monorepo** — every verification in
  [`docs/milestones.md`](milestones.md) runs from a temp directory that is
  not nested under this repository.
- **Global install** (`npm install -g`) — tested where practical against
  an isolated `npm --prefix`, to avoid mutating shared system npm state;
  see `docs/milestones.md` for exactly what was and wasn't exercised this
  way.
- **Package manager**: npm is the required/primary target; pnpm is
  recommended for workspace development; Yarn workspace *detection* (for
  `rvs init`) is supported, but installing the packed tarball itself via
  Yarn is not separately exercised.

## Current limitations before npm publication

- No `publishConfig`, no CI publish step, no signed provenance — this
  milestone proves the tarball installs and runs correctly, not that a
  `npm publish` release flow exists.
- The literal machine-wide `npm install -g` path (as opposed to an
  isolated `--prefix` sandbox) is not exercised by automated tests.
