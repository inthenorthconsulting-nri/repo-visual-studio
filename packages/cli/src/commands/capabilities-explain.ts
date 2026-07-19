import type { Logger } from "@rvs/core";
import type { Capability, CapabilityModel, ExcludedCapabilityCandidate } from "@rvs/capability-intelligence";
import { readCachedJson } from "../cache.js";

function isExcluded(item: Capability | ExcludedCapabilityCandidate): item is ExcludedCapabilityCandidate {
  return "reasonCodes" in item;
}

function printCapability(item: Capability | ExcludedCapabilityCandidate, logger: Logger): void {
  logger.info(`${item.displayName} (${item.id})`);
  logger.info(`  Status: ${item.status}    Confidence: ${item.confidence}    Readiness: ${item.readiness.score}/100`);
  logger.info(
    `  Readiness breakdown: implementation=${item.readiness.implementationScore} execution=${item.readiness.executionScore} verification=${item.readiness.verificationScore} documentation=${item.readiness.documentationScore} adoption=${item.readiness.adoptionScore}`,
  );
  if (isExcluded(item)) {
    logger.info(`  Inclusion: exclude`);
    logger.info(`  Reason codes: ${item.reasonCodes.join(", ") || "(none)"}`);
    logger.info(`  Reason: ${item.reasonSummary}`);
  } else {
    logger.info(`  Inclusion: ${item.inclusion}`);
    logger.info(`  Purpose: ${item.purpose}`);
    if (item.outcome) logger.info(`  Outcome: ${item.outcome}`);
    if (item.exclusions && item.exclusions.length > 0) logger.info(`  Qualification reason codes: ${item.exclusions.join(", ")}`);
  }
  if (item.readiness.blockers.length > 0) logger.info(`  Blockers: ${item.readiness.blockers.join(" ")}`);
  if (item.readiness.qualifiers.length > 0) logger.info(`  Qualifiers: ${item.readiness.qualifiers.join(" ")}`);
  logger.info(`  Evidence (${item.evidence.length}):`);
  for (const e of item.evidence) logger.info(`    - [${e.type}/${e.confidence}, strength ${e.strength}] ${e.sourcePath}: ${e.description}`);
}

export async function runCapabilitiesExplain(repoRoot: string, capabilityId: string, logger: Logger): Promise<void> {
  const model = readCachedJson<CapabilityModel>(repoRoot, "capability-model.json");
  const all: (Capability | ExcludedCapabilityCandidate)[] = [
    ...model.includedCapabilities,
    ...model.qualifiedCapabilities,
    ...model.roadmapCapabilities,
    ...model.gapCapabilities,
    ...model.unresolvedCapabilities,
    ...model.excludedCandidates,
  ];

  const found = all.find((c) => c.id === capabilityId || c.displayName.toLowerCase() === capabilityId.toLowerCase());
  if (!found) {
    logger.error(`No capability or candidate found matching "${capabilityId}". Run \`rvs export capabilities --include-roadmap --include-excluded\` to see all known ids.`);
    process.exitCode = 1;
    return;
  }
  printCapability(found, logger);
}
