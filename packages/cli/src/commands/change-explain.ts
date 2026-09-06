// `rvs change explain <advisory-id>`: retrieves a previously cached
// ChangeAdvisory (written via `rvs change evaluate --cache`) and narrates
// only the evidence it already carries -- never manufactures a causal claim
// beyond what the advisory itself recorded (§22). Follows the same
// try/catch/logger.error/exitCode=1 convention as graph-explain.ts.
//
// Freshness disclosure (Milestone 11.2 closure): when the Knowledge Graph
// cache is present, the stored advisory's baseline is compared against it
// via the package's own assessChangeAdvisoryFreshness() -- reusing
// resolveChangeWorkbenchBaseline() exactly as `evaluate` does, never
// auto-building it. This never invalidates, regenerates, or re-evaluates
// the stored advisory; it only discloses whether its recorded baseline
// still matches. When the KG cache is absent, this command has no evidence
// to disclose freshness with and stays silent on it -- explain itself must
// not start requiring `rvs graph build` to run at all.
//
// Milestone 11.3.3A-K2/B: `explain` never calls the Workbench evaluator --
// it only narrates a previously-computed advisory -- so "block before
// Workbench evaluation" (§6/§12) is enforced here as "block before any
// narration is printed": a current baseline whose content_digest is a
// `mismatch` throws immediately, before the advisory-identification lines,
// and is caught by the existing outer try/catch (deterministic
// logger.error + exitCode 1, zero narration). A `missing` baseline is not
// blocking -- it is disclosed alongside the existing freshness output.

import type { Logger } from "@rvs/core";
import { assessChangeAdvisoryFreshness } from "@rvs/change-workbench";
import { findStoredChangeAdvisoryById } from "../change-workbench-cache.js";
import { overallCoverageLabel, sanitizeTerminalText } from "./change-presentation.js";
import { resolveChangeWorkbenchBaseline, type ChangeWorkbenchBaseline } from "./change-baseline.js";

export async function runChangeExplainCommand(repoRoot: string, advisoryId: string, _opts: Record<string, never>, logger: Logger): Promise<void> {
  try {
    const stored = findStoredChangeAdvisoryById(repoRoot, advisoryId);
    if (!stored) {
      throw new Error(`No cached advisory found for id "${advisoryId}". Advisories are only available after \`rvs change evaluate --cache\`.`);
    }
    const { advisory } = stored;

    let baseline: ChangeWorkbenchBaseline | undefined;
    try {
      baseline = resolveChangeWorkbenchBaseline(repoRoot);
    } catch {
      baseline = undefined;
    }

    if (baseline?.contentAttestation.status === "mismatch") {
      throw new Error(
        "Persisted graph content does not match the content digest declared by the graph snapshot. Refusing to explain against an unattested baseline.",
      );
    }

    logger.info(`Advisory ${advisory.id} for proposal ${advisory.proposal_id} (repository ${advisory.repository_id}).`);
    logger.info(`  Evaluated against base_snapshot_digest ${advisory.base_snapshot_digest}.`);

    if (baseline?.contentAttestation.status === "missing") {
      logger.info("  Baseline content attestation: missing (legacy Knowledge Graph snapshot; predates content attestation).");
      logger.info("    This evaluation used a legacy Knowledge Graph snapshot that does not contain a content attestation digest.");
      logger.info("    Rebuild the Knowledge Graph to create a content-attested snapshot: rerun `rvs graph build`.");
    }

    if (baseline !== undefined) {
      const freshness = assessChangeAdvisoryFreshness(stored, baseline.baseSnapshotDigest);
      logger.info(`  Advisory freshness: ${freshness}`);
      if (freshness === "stale_equivalent") {
        logger.info(`    Evaluated baseline: ${stored.base_snapshot_digest_at_store_time}`);
        logger.info(`    Current baseline: ${baseline.baseSnapshotDigest}`);
      }
    }

    if (advisory.proposal_validation.status === "invalid") {
      logger.info("  INVALID PROPOSAL");
      for (const issue of advisory.proposal_validation.issues) {
        logger.info(`    [${issue.code}] ${sanitizeTerminalText(issue.detail)}`);
      }
    } else {
      logger.info(`  ${overallCoverageLabel(advisory)}`);
      for (const entry of advisory.domain_coverage) {
        logger.info(`    [${entry.domain}] ${entry.status}: ${sanitizeTerminalText(entry.detail)}`);
      }
      if (advisory.impact.status !== "not_evaluated") {
        logger.info(
          `  Impact: ${advisory.impact.blast_radius_level} blast radius -- ${advisory.impact.directly_affected_refs.length} direct, ${advisory.impact.transitively_affected_refs.length} transitive ref(s) affected.`,
        );
      }
    }

    if (advisory.governance.findings.length > 0) {
      logger.info("  PROPOSED GOVERNANCE CONCERN");
      for (const finding of advisory.governance.findings) {
        logger.info(`    ${sanitizeTerminalText(finding.statement)}`);
      }
    }

    if (advisory.decisions.findings.length > 0) {
      logger.info("  PROPOSED DECISION CONCERN");
      for (const finding of advisory.decisions.findings) {
        logger.info(`    ${sanitizeTerminalText(finding.statement)}`);
      }
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
