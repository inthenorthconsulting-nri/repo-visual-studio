// Namespaced under its own cache subdirectory, mirroring
// @rvs/governance-intelligence/src/constants.ts's GOVERNANCE_CACHE_DIR
// convention -- decision analysis accumulates many named artifacts per run
// rather than a single current artifact per file.

export const DECISION_CACHE_DIR = ".rvs/cache/decisions";

/** The 19 output filenames a full `rvs decisions analyze` run produces, written under DECISION_CACHE_DIR. */
export const DECISION_OUTPUT_FILES = {
  decisionSnapshot: "decision-snapshot.json",
  decisions: "decisions.json",
  decisionLinks: "decision-links.json",
  assumptions: "assumptions.json",
  consequences: "consequences.json",
  dependencies: "dependencies.json",
  supersession: "supersession.json",
  conflicts: "conflicts.json",
  implementationState: "implementation-state.json",
  coverage: "coverage.json",
  drift: "drift.json",
  decisionDebt: "decision-debt.json",
  decisionChanges: "decision-changes.json",
  decisionGovernanceContext: "decision-governance-context.json",
  decisionBlastRadius: "decision-blast-radius.json",
  decisionClaims: "decision-claims.json",
  decisionNarrative: "decision-narrative.json",
  decisionPlan: "decision-plan.json",
  decisionReport: "decision-report.json",
} as const;

/** Never scanned during decision discovery unless explicitly configured in `.rvs/decisions.yml`. */
export const DECISION_DISCOVERY_DENYLIST = ["node_modules", "dist", "build", ".git", ".rvs/cache", ".rvs/tmp"];
