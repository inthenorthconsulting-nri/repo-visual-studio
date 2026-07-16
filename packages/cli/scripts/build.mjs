import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, "..");
const repoRoot = resolve(cliRoot, "../..");
const distDir = resolve(cliRoot, "dist");
const assetsDir = resolve(cliRoot, "assets");

rmSync(distDir, { recursive: true, force: true });
rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

// Bundle every @rvs/* workspace package straight into one file. This is
// the "bundle the internal runtime" distribution model: consumers of the
// published @rvs/cli package never resolve workspace:* dependencies,
// because after this build there aren't any — everything internal is
// inlined. playwright and @cdktf/hcl2json both stay external and real npm
// dependencies: playwright ships its own browser-download tooling keyed
// off its own package location, and @cdktf/hcl2json loads a `main.wasm.gz`
// binary via a `path.join(__dirname, ...)`-relative lookup plus a dynamic
// `require()` of its wasm bridge script — bundling either would break the
// runtime asset resolution rather than help it.
// CJS output, not ESM: several bundled CJS dependencies (e.g. yaml's CJS
// build) contain interop-only `require("process")`-style calls that
// esbuild can't statically resolve when targeting ESM output, and throw
// at runtime ("Dynamic require ... is not supported"). Bundling as CJS
// lets esbuild pass those requires through natively instead of shimming
// them. The .cjs extension sidesteps this package's own "type": "module"
// so Node always parses the output as CommonJS regardless.
const result = await esbuild.build({
  entryPoints: [resolve(cliRoot, "src/bin.ts")],
  outfile: resolve(distDir, "bin.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["playwright", "@cdktf/hcl2json"],
  metafile: true,
  logLevel: "info",
  // moduleDir() (src/module-dir.ts) intentionally references import.meta.url
  // as a dead branch in CJS output — see its comment. Silence the resulting
  // "will be empty" warning; it's expected, not a bug.
  logOverride: { "empty-import-meta": "silent" },
});

// Design systems are read at runtime by `rvs create slides` — they have
// to travel inside the published tarball. See paths.ts for the
// packaged-vs-monorepo resolution fallback that reads from here.
cpSync(resolve(repoRoot, "design-systems"), resolve(assetsDir, "design-systems"), { recursive: true });

// Not read by the CLI at runtime, but shipped alongside for agent/tooling
// consumers of the published package who want the skill definition and
// the generated VisualDoc JSON Schema without checking out the monorepo.
cpSync(resolve(repoRoot, "skills/repo-visual-studio"), resolve(assetsDir, "skills/repo-visual-studio"), {
  recursive: true,
});

const pkg = JSON.parse(readFileSync(resolve(cliRoot, "package.json"), "utf8"));
console.log(`Built @rvs/cli ${pkg.version} -> dist/bin.js`);

const outputs = Object.entries(result.metafile.outputs).map(([file, info]) => [file, info.bytes]);
for (const [file, bytes] of outputs) {
  console.log(`  ${file} (${(bytes / 1024).toFixed(1)} KiB)`);
}
