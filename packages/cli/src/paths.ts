import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { moduleDir } from "./module-dir.js";

const here = moduleDir(import.meta.url);

// Packaged installs (npm tarball) ship a copy of design-systems/ next to
// the compiled bin at ../assets/design-systems (see scripts/build.mjs).
// The dev workspace (tsx running src/bin.ts directly, no build step) has
// no such copy, so it falls back to the monorepo root's design-systems/ —
// both "here"s (packages/cli/src and packages/cli/dist) are two levels
// under packages/cli, so the same relative fallback works from either.
const packagedAssetsRoot = resolve(here, "../assets");
const monorepoDesignSystems = resolve(here, "../../../design-systems");

// The @rvs/cli package's own root — packages/cli in the monorepo, or
// node_modules/@rvs/cli once installed elsewhere. Not "../../.." (that
// was a monorepo-only depth assumption that no longer holds once this
// package is nested under a consumer's node_modules).
export const RVS_INSTALL_ROOT = resolve(here, "..");
export const DESIGN_SYSTEMS_ROOT = existsSync(resolve(packagedAssetsRoot, "design-systems"))
  ? resolve(packagedAssetsRoot, "design-systems")
  : monorepoDesignSystems;
export const RVS_ASSETS_ROOT = existsSync(packagedAssetsRoot) ? packagedAssetsRoot : RVS_INSTALL_ROOT;

// Same packaged-vs-monorepo fallback as DESIGN_SYSTEMS_ROOT — build.mjs
// copies skills/repo-visual-studio (which already contains schemas/) to
// ../assets/skills/repo-visual-studio, so both roots derive from one path.
const packagedSkillRoot = resolve(packagedAssetsRoot, "skills/repo-visual-studio");
const monorepoSkillRoot = resolve(here, "../../../skills/repo-visual-studio");
export const SKILLS_ROOT = existsSync(packagedSkillRoot) ? packagedSkillRoot : monorepoSkillRoot;
export const SCHEMAS_ROOT = resolve(SKILLS_ROOT, "schemas");
