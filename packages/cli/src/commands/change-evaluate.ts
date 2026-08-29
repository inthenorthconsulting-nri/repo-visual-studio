// `rvs change evaluate --file <proposal.json>`: decode, resolve baseline,
// and run the one canonical buildChangeAdvisory() via the shared
// runChangeWorkbenchEvaluation() (§12). Terminal wording and exit codes
// follow §19/§21 exactly: a successfully computed advisory is never a
// process failure, even when its coverage is partial/unresolved -- only a
// decode rejection or an invalid proposal_validation sets exitCode 1.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ProposalValidationIssue } from "@rvs/change-workbench";
import { toStoredChangeAdvisory } from "@rvs/change-workbench";
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

  const { advisory } = outcome;

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

  // `advisory` -- not a CLI-invented wrapper -- is the entire --output
  // payload: ChangeAdvisory is the sole truth contract (§28); CLI
  // presentation is a view only.
  if (opts.output) {
    const path = resolve(repoRoot, opts.output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(advisory, null, 2));
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
