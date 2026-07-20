import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "@rvs/core";
import { DECISION_OUTPUT_FILES, diffDecisions } from "@rvs/decision-intelligence";
import type { DecisionSnapshot } from "@rvs/decision-intelligence";
import { writeDecisionOutputs } from "../decision-cache.js";
import { runDecisionAnalysis } from "./decisions-analyze.js";

export interface DecisionsCompareOptions {
  from?: string;
  to?: string;
}

function readSnapshotFile(repoRoot: string, path: string): DecisionSnapshot {
  const resolved = resolve(repoRoot, path);
  if (!existsSync(resolved)) {
    throw new Error(`No decision snapshot found at ${resolved}.`);
  }
  return JSON.parse(readFileSync(resolved, "utf8")) as DecisionSnapshot;
}

/**
 * Diffs a prior decision snapshot (`--from`, required -- decision-intelligence
 * keeps no snapshot history directory the way governance does, so this is
 * always an explicit file path) against either another snapshot file
 * (`--to`) or a freshly built one from `rvs decisions analyze`'s pipeline
 * (default).
 */
export async function runDecisionsCompare(repoRoot: string, opts: DecisionsCompareOptions, logger: Logger): Promise<void> {
  if (!opts.from) {
    throw new Error("`rvs decisions compare` requires --from <path to a decision-snapshot.json>.");
  }
  const source = readSnapshotFile(repoRoot, opts.from);

  let target: DecisionSnapshot;
  if (opts.to) {
    target = readSnapshotFile(repoRoot, opts.to);
  } else {
    const result = await runDecisionAnalysis(repoRoot, logger);
    target = result.snapshot;
  }

  const generatedAt = new Date().toISOString();
  const changeSet = diffDecisions({ source, target, generatedAt });

  writeDecisionOutputs(repoRoot, { decisionChanges: changeSet });

  const changed = changeSet.changes.filter((c) => c.change_type !== "unchanged").length;
  logger.info(`Compared "${source.id}" -> "${target.id}" (compatibility: "${changeSet.compatibility.status}"): ${changed} changed decision(s) of ${changeSet.changes.length}.`);
  logger.info(`Wrote .rvs/cache/decisions/${DECISION_OUTPUT_FILES.decisionChanges}.`);
}
