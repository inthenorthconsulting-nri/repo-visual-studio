import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The build produces a CJS bundle (dist/bin.cjs — see scripts/build.mjs),
// where `import.meta.url` is unavailable, but esbuild's CJS output shims
// in `__dirname` natively. The dev workspace runs src/bin.ts directly
// under tsx as ESM, where `__dirname` doesn't exist but `import.meta.url`
// does. `typeof __dirname` is a safe way to probe for it in either module
// system: referencing an undeclared identifier as a typeof operand never
// throws, in strict mode or otherwise.
export function moduleDir(importMetaUrl: string): string {
  // eslint-disable-next-line no-undef
  return typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(importMetaUrl));
}
