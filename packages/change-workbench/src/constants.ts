// Mirrors @rvs/knowledge-graph/src/constants.ts's cache-directory-naming
// convention. change-workbench never writes here on its own -- these are
// path *conventions* a caller (a future CLI layer, out of scope for this
// milestone) would use; this package only computes the relative path.

export const CHANGE_WORKBENCH_CACHE_DIR = ".rvs/cache/change-workbench";
export const CHANGE_WORKBENCH_ADVISORIES_DIR = ".rvs/cache/change-workbench/advisories";
export const CHANGE_WORKBENCH_SCHEMA_VERSION = 1;
