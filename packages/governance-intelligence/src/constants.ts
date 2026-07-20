// Unlike the flat `.rvs/cache/<file>.json` layout used by inspect/
// synthesize-architecture/synthesize-capabilities/synthesize-product-identity/
// synthesize-portfolio (see packages/cli/src/commands/*), governance output
// is namespaced under its own subdirectory: it accumulates a history of
// snapshots over time rather than a single current artifact per file, so it
// needs room that the flat cache layout doesn't provide.

export const GOVERNANCE_CACHE_DIR = ".rvs/cache/governance";

/** Where each captured IntelligenceSnapshot (and, later, promoted baselines) is written, one file per snapshot id. */
export const GOVERNANCE_SNAPSHOTS_DIR = `${GOVERNANCE_CACHE_DIR}/snapshots`;

/** The 11 output filenames a full governance run produces, written under GOVERNANCE_CACHE_DIR. */
export const GOVERNANCE_OUTPUT_FILES = {
  currentSnapshot: "current-snapshot.json",
  architectureChanges: "architecture-changes.json",
  capabilityChanges: "capability-changes.json",
  productChanges: "product-changes.json",
  portfolioChanges: "portfolio-changes.json",
  evidenceChanges: "evidence-changes.json",
  blastRadius: "blast-radius.json",
  governanceFindings: "governance-findings.json",
  governanceReport: "governance-report.json",
  governanceNarrative: "governance-narrative.json",
  governancePlan: "governance-plan.json",
} as const;
