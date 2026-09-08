// `rvs change evaluate --file <proposal.json>`: decode, resolve baseline,
// and run the one canonical evaluateProposedChange() via the shared
// runChangeWorkbenchEvaluation() (§12). Terminal wording and exit codes
// follow §19/§21 exactly: a successfully computed advisory is never a
// process failure, even when its coverage is partial/unresolved -- only a
// decode rejection or an invalid proposal_validation sets exitCode 1.
//
// Milestone 11.3.3A-K2/B: `--output` carries the RAW ChangeAdvisory plus one
// additive `baseline_content_attestation` sibling field (never nested inside
// a CLI-invented wrapper) -- the tri-state result of verifying the persisted
// snapshot's content_digest against the independently loaded nodes/edges.
// A `mismatch` baseline is a distinct, blocking outcome: evaluateProposedChange()
// is never reached for it (see change-shared.ts), so there is no advisory to
// write here at all.
//
// Milestone 11.3.3A-WB: on the successful path the canonical
// ChangeWorkbenchEvaluation envelope is the only source of both the advisory
// and the attestation this command presents -- `evaluation.advisory` and
// `evaluation.baseline_content_attestation`. The envelope itself is never
// exposed as CLI output or persisted; only the advisory is.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ProposalValidationIssue } from "@rvs/change-workbench";
import { toStoredChangeAdvisory } from "@rvs/change-workbench";
import type { ContentDigestVerification } from "@rvs/knowledge-graph";
import { runChangeWorkbenchEvaluation } from "./change-shared.js";
import { overallCoverageLabel, sanitizeTerminalText } from "./change-presentation.js";
import { writeStoredChangeAdvisory } from "../change-workbench-cache.js";

export interface ChangeEvaluateOptions {
  file?: string;
  output?: string;
  cache?: boolean;
}

function writeRejectedOutput(repoRoot: string, outputPath: string, issues: ProposalValidationIssue[]): void {
  const path = resolve(repoRoot, outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ status: "invalid", issues }, null, 2));
}

function writeBlockedOutput(repoRoot: string, outputPath: string, contentAttestation: ContentDigestVerification): void {
  const path = resolve(repoRoot, outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ status: "blocked", reason: "content_attestation_mismatch", baseline_content_attestation: contentAttestation }, null, 2));
}

function logBaselineContentAttestation(logger: Logger, contentAttestation: ContentDigestVerification): void {
  if (contentAttestation.status === "missing") {
    logger.info("BASELINE CONTENT ATTESTATION: missing");
    logger.info("  This evaluation used a legacy Knowledge Graph snapshot that does not contain a content attestation digest.");
    logger.info("  Rebuild the Knowledge Graph to create a content-attested snapshot: rerun `rvs graph build`.");
  }
}

export async function runChangeEvaluateCommand(repoRoot: string, opts: ChangeEvaluateOptions, logger: Logger): Promise<void> {
  if (!opts.file) {
    throw new Error("`rvs change evaluate` requires --file <proposal.json>.");
  }

  const outcome = runChangeWorkbenchEvaluation(repoRoot, opts.file);

  if (outcome.outcome === "rejected") {
    logger.error("INVALID PROPOSAL");
    for (const issue of outcome.issues) {
      logger.error(`  [${issue.code}] ${sanitizeTerminalText(issue.detail)}`);
    }
    if (opts.output) writeRejectedOutput(repoRoot, opts.output, outcome.issues);
    process.exitCode = 1;
    return;
  }

  if (outcome.outcome === "blocked") {
    logger.error("BASELINE CONTENT ATTESTATION: mismatch");
    logger.error("  Persisted graph content does not match the content digest declared by the graph snapshot.");
    logger.error(`  expected: ${outcome.contentAttestation.expected}`);
    logger.error(`  actual:   ${outcome.contentAttestation.actual}`);
    if (opts.output) writeBlockedOutput(repoRoot, opts.output, outcome.contentAttestation);
    process.exitCode = 1;
    return;
  }

  const { evaluation } = outcome;
  const advisory = evaluation.advisory;
  logBaselineContentAttestation(logger, evaluation.baseline_content_attestation);

  if (advisory.proposal_validation.status === "invalid") {
    logger.error("INVALID PROPOSAL");
    for (const issue of advisory.proposal_validation.issues) {
      logger.error(`  [${issue.code}] ${sanitizeTerminalText(issue.detail)}`);
    }
  } else {
    logger.info(overallCoverageLabel(advisory));
    for (const entry of advisory.domain_coverage) {
      logger.info(`  [${entry.domain}] ${entry.status}: ${sanitizeTerminalText(entry.detail)}`);
    }
  }

  if (advisory.governance.findings.length > 0) {
    logger.info("PROPOSED GOVERNANCE CONCERN");
    for (const finding of advisory.governance.findings) {
      logger.info(`  ${sanitizeTerminalText(finding.statement)}`);
    }
  }

  if (advisory.decisions.findings.length > 0) {
    logger.info("PROPOSED DECISION CONCERN");
    for (const finding of advisory.decisions.findings) {
      logger.info(`  ${sanitizeTerminalText(finding.statement)}`);
    }
  }

  // `advisory` -- not a CLI-invented wrapper -- remains the entire --output
  // payload's basis: ChangeAdvisory is the sole truth contract (§28); CLI
  // presentation is a view only. Milestone 11.3.3A-K2/B adds exactly one
  // additive sibling field, `baseline_content_attestation`, via a top-level
  // spread -- never nested, never replacing any existing advisory field.
  if (opts.output) {
    const path = resolve(repoRoot, opts.output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...advisory, baseline_content_attestation: evaluation.baseline_content_attestation }, null, 2));
  }

  // Opt-in only (§16) -- default `rvs change evaluate` never persists.
  if (opts.cache) {
    const cachedPath = writeStoredChangeAdvisory(repoRoot, toStoredChangeAdvisory(advisory));
    logger.info(`Cached advisory at ${cachedPath}`);
  }

  if (advisory.proposal_validation.status === "invalid") {
    process.exitCode = 1;
  }
}
