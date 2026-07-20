import { mkdirSync, writeFileSync } from "node:fs";
import type { Logger } from "@rvs/core";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION, loadGovernanceConfig, setBaseline, showBaseline, validateBaseline } from "@rvs/governance-intelligence";
import { GOVERNANCE_CACHE_DIR } from "@rvs/governance-intelligence";
import {
  BASELINE_SNAPSHOT_FILE,
  governanceCacheDir,
  governanceOutputPath,
  readSnapshotEnvelope,
  readSnapshotFileForBaseline,
  type GovernanceBaselineFile,
} from "../governance-cache.js";

export async function runGovernanceBaselineShow(repoRoot: string, logger: Logger): Promise<void> {
  const config = loadGovernanceConfig(repoRoot);
  const baseline = showBaseline(config, readSnapshotFileForBaseline(repoRoot)) as GovernanceBaselineFile | undefined;
  if (!baseline) {
    logger.info(
      "No governance baseline is configured. Run `rvs governance baseline set <snapshot>` to establish one, then reference the written file from .rvs/governance.yml's `baseline.snapshot`.",
    );
    return;
  }

  logger.info(`Baseline "${baseline.id}" (snapshot "${baseline.snapshot.id}"), established at ${baseline.established_at}.`);
  for (const artifact of baseline.snapshot.artifacts) {
    logger.info(`  ${artifact.artifact}: ${artifact.provenance}${artifact.schema_version !== undefined ? ` (schema_version ${artifact.schema_version})` : ""}`);
  }
  logger.info(`  raw artifacts embedded: ${baseline.rawArtifacts ? "yes" : "no"}`);
}

export interface GovernanceBaselineSetOptions {
  force?: boolean;
}

export async function runGovernanceBaselineSet(repoRoot: string, snapshotRef: string, opts: GovernanceBaselineSetOptions, logger: Logger): Promise<void> {
  const config = loadGovernanceConfig(repoRoot);
  const priorBaseline = showBaseline(config, readSnapshotFileForBaseline(repoRoot));

  const envelope = readSnapshotEnvelope(repoRoot, snapshotRef);

  const { baseline, compatibility } = setBaseline({
    newSnapshot: envelope.snapshot,
    priorBaseline,
    establishedAt: new Date().toISOString(),
  });

  logger.info(`Compatibility with prior baseline: "${compatibility.status}".`);
  for (const reason of compatibility.reasons) logger.info(`  - ${reason}`);

  if (compatibility.status === "incompatible" && !opts.force) {
    logger.error("Refusing to set an incompatible baseline without --force. Re-run with --force to proceed anyway, or investigate the incompatibility reasons above first.");
    process.exitCode = 1;
    return;
  }
  if (compatibility.status === "incompatible") {
    logger.warn("Setting an incompatible baseline because --force was passed. Governance comparisons against this baseline may be unreliable.");
  }

  const baselineFile: GovernanceBaselineFile = { ...baseline, rawArtifacts: envelope.rawArtifacts };
  mkdirSync(governanceCacheDir(repoRoot), { recursive: true });
  const writtenPath = governanceOutputPath(repoRoot, BASELINE_SNAPSHOT_FILE);
  writeFileSync(writtenPath, JSON.stringify(baselineFile, null, 2));

  logger.info(`Wrote new baseline "${baseline.id}" (snapshot "${baseline.snapshot.id}") to ${writtenPath}.`);
  // `.rvs/governance.yml` is human-owned (mirrors `.rvs/config.yml` being
  // written only by `rvs init`) -- this command never writes it, only
  // points the user at the value they'd add.
  if (config?.baseline?.snapshot !== `${GOVERNANCE_CACHE_DIR}/${BASELINE_SNAPSHOT_FILE}`) {
    logger.info(`To use this baseline in \`rvs governance compare\`/\`rvs governance check\`, set baseline.snapshot: "${GOVERNANCE_CACHE_DIR}/${BASELINE_SNAPSHOT_FILE}" in .rvs/governance.yml.`);
  }
}

export async function runGovernanceBaselineValidate(repoRoot: string, logger: Logger): Promise<void> {
  const config = loadGovernanceConfig(repoRoot);
  const baseline = showBaseline(config, readSnapshotFileForBaseline(repoRoot));
  if (!baseline) {
    logger.info("No governance baseline is configured. Nothing to validate.");
    return;
  }

  const result = validateBaseline(baseline, GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION);
  logger.info(`Baseline "${baseline.id}": ${result.status}.`);
  for (const reason of result.reasons) logger.info(`  - ${reason}`);
  if (result.status !== "compatible") {
    process.exitCode = 1;
  }
}
