import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Logger } from "@rvs/core";
import { buildIntelligenceSnapshot } from "@rvs/governance-intelligence";
import { governanceSnapshotsDir, readCurrentRawArtifacts, sanitizeGovernanceFilename, type RawArtifacts, type SnapshotEnvelope } from "../governance-cache.js";

export interface SnapshotCreateOptions {
  name?: string;
  output?: string;
  includePortfolio?: boolean;
  allowPartial?: boolean;
}

// See governance-cache.ts's top-of-file comment for why every saved
// snapshot file is a { snapshot, rawArtifacts } envelope rather than a bare
// IntelligenceSnapshot: `rvs governance compare` needs the raw artifact JSON
// back to actually diff two snapshots' content, not just compare their
// digests.
export async function runSnapshotCreate(repoRoot: string, opts: SnapshotCreateOptions, logger: Logger): Promise<void> {
  const rawArtifacts: RawArtifacts = readCurrentRawArtifacts(repoRoot, Boolean(opts.includePortfolio));

  if (rawArtifacts.architecture === undefined && rawArtifacts.capability === undefined && rawArtifacts.product === undefined && rawArtifacts.portfolio === undefined) {
    throw new Error(
      "No cached intelligence artifacts found (architecture-intelligence.json, capability-model.json, product-identity-model.json" +
        (opts.includePortfolio ? ", portfolio-model.json" : "") +
        "). Run `rvs synthesize architecture`, `rvs synthesize capabilities`, and/or `rvs synthesize product-identity` first.",
    );
  }

  const snapshot = buildIntelligenceSnapshot({
    generatedAt: new Date().toISOString(),
    architecture: rawArtifacts.architecture,
    capability: rawArtifacts.capability,
    product: rawArtifacts.product,
    portfolio: rawArtifacts.portfolio,
  });

  if (!opts.allowPartial) {
    // Portfolio is opt-in (--include-portfolio) so its absence never blocks
    // -- only the three domains every snapshot always attempts to fingerprint.
    const missingRequested = snapshot.artifacts.filter((artifact) => artifact.artifact !== "portfolio" && artifact.provenance === "unavailable");
    if (missingRequested.length > 0) {
      throw new Error(
        `Refusing to create a partial snapshot: missing domain(s) ${missingRequested.map((a) => a.artifact).join(", ")}. Run the relevant \`rvs synthesize ...\` command(s) first, or pass --allow-partial to proceed anyway.`,
      );
    }
  }

  const envelope: SnapshotEnvelope = { snapshot, rawArtifacts };

  const filename = `${sanitizeGovernanceFilename(opts.name ?? snapshot.id)}.json`;
  const snapshotsDir = governanceSnapshotsDir(repoRoot);
  mkdirSync(snapshotsDir, { recursive: true });
  const snapshotPath = resolve(snapshotsDir, filename);
  writeFileSync(snapshotPath, JSON.stringify(envelope, null, 2));

  const writtenPaths = [snapshotPath];
  if (opts.output) {
    const outputPath = resolve(repoRoot, opts.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(envelope, null, 2));
    writtenPaths.push(outputPath);
  }

  const provenanceSummary = snapshot.artifacts.map((a) => `${a.artifact}=${a.provenance}`).join(", ");
  logger.info(`Built snapshot "${snapshot.id}" (${provenanceSummary}).`);
  logger.info(`Wrote ${writtenPaths.join(", ")}.`);
}
