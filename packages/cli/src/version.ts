import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moduleDir } from "./module-dir.js";

const here = moduleDir(import.meta.url);

// Works from both packages/cli/src (dev, tsx) and packages/cli/dist
// (built, dist/bin.cjs) — package.json is always one level up from either.
// npm always includes package.json in an installed package regardless of
// the "files" allowlist, so this resolves after a tarball install too.
export const CLI_VERSION: string = JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")).version;
