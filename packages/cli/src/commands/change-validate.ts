// `rvs change validate --file <proposal.json>`: decode + validate only, via
// the shared runChangeWorkbenchValidation() (§12). No baseline is required
// -- ref-existence checks best-effort use whatever Knowledge Graph cache is
// already present, but a missing one only degrades to the validator's own
// non-blocking `unresolved_confirmation_context`, never a hard failure.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { ProposalValidationIssue, ProposalValidationStatus } from "@rvs/change-workbench";
import { runChangeWorkbenchValidation } from "./change-shared.js";
import { sanitizeTerminalText } from "./change-presentation.js";

export interface ChangeValidateOptions {
  file?: string;
  output?: string;
}

interface ChangeValidateOutputShape {
  status: ProposalValidationStatus;
  proposal_id?: string;
  repository_id?: string;
  issues: ProposalValidationIssue[];
}

function writeChangeValidateOutput(repoRoot: string, outputPath: string, shape: ChangeValidateOutputShape): void {
  const path = resolve(repoRoot, outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(shape, null, 2));
}

export async function runChangeValidateCommand(repoRoot: string, opts: ChangeValidateOptions, logger: Logger): Promise<void> {
  if (!opts.file) {
    throw new Error("`rvs change validate` requires --file <proposal.json>.");
  }

  const outcome = runChangeWorkbenchValidation(repoRoot, opts.file);

  if (outcome.outcome === "rejected") {
    logger.error("INVALID PROPOSAL");
    for (const issue of outcome.issues) {
      logger.error(`  [${issue.code}] ${sanitizeTerminalText(issue.detail)}`);
    }
    if (opts.output) writeChangeValidateOutput(repoRoot, opts.output, { status: "invalid", issues: outcome.issues });
    process.exitCode = 1;
    return;
  }

  const { changeSet, result } = outcome;

  if (result.status === "invalid") {
    logger.error("INVALID PROPOSAL");
  } else {
    logger.info(`VALID PROPOSAL (${result.status})`);
  }

  for (const issue of result.issues) {
    const line = `  [${issue.code}] ${sanitizeTerminalText(issue.detail)}`;
    if (issue.blocking) logger.error(line);
    else logger.warn(line);
  }

  if (opts.output) {
    writeChangeValidateOutput(repoRoot, opts.output, { status: result.status, proposal_id: changeSet.id, repository_id: changeSet.repository_id, issues: result.issues });
  }

  if (result.status === "invalid") {
    process.exitCode = 1;
  }
}
