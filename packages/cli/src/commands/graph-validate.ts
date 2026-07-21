import type { Logger } from "@rvs/core";
import { runGraphBuild } from "./graph-build.js";

export interface GraphValidateOptions {
  ci?: boolean;
}

export async function runGraphValidateCommand(repoRoot: string, opts: GraphValidateOptions, logger: Logger): Promise<void> {
  const { validationFindings } = await runGraphBuild(repoRoot, logger);

  for (const finding of validationFindings) {
    const message = `[${finding.code}] ${finding.message} (subject: ${finding.subject_id})`;
    if (finding.blocking) {
      logger.error(message);
    } else {
      logger.warn(message);
    }
  }

  const blockingCount = validationFindings.filter((finding) => finding.blocking).length;
  logger.info(`Knowledge graph validation: ${validationFindings.length} finding(s), ${blockingCount} blocking.`);

  if (opts.ci && blockingCount > 0) {
    process.exitCode = 1;
  }
}
