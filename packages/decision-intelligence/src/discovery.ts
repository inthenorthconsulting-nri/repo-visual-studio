// Mirrors @rvs/repository-model/src/scan.ts's fast-glob convention, scoped to
// the directories configured in .rvs/decisions.yml -- decision discovery
// never walks the whole repository, only the paths an author explicitly
// opted in as decision-document locations.

import { join, relative } from "node:path";
import fg from "fast-glob";
import { DECISION_DISCOVERY_DENYLIST } from "./constants.js";
import type { DecisionSourceConfig, DecisionsConfig } from "./decisions-config.js";

export interface DecisionCandidate {
  repo_relative_path: string;
  configured_type: DecisionSourceConfig["type"];
}

const DEFAULT_INCLUDE = ["**/*.md"];

export async function discoverDecisionCandidates(repoRoot: string, config: DecisionsConfig): Promise<DecisionCandidate[]> {
  const byPath = new Map<string, DecisionCandidate>();

  for (const source of config.sources) {
    const sourceRoot = join(repoRoot, source.path);
    const include = source.include && source.include.length > 0 ? source.include : DEFAULT_INCLUDE;

    const matches = await fg(include, {
      cwd: sourceRoot,
      ignore: DECISION_DISCOVERY_DENYLIST,
      onlyFiles: true,
      dot: false,
      unique: true,
    });

    for (const match of matches) {
      const absPath = join(sourceRoot, match);
      const repoRelativePath = relative(repoRoot, absPath).split("\\").join("/");
      // First source entry to claim a path wins, matching decisions.yml's
      // array order -- a deterministic, config-order tie-break rather than
      // glob-iteration order.
      if (!byPath.has(repoRelativePath)) {
        byPath.set(repoRelativePath, { repo_relative_path: repoRelativePath, configured_type: source.type });
      }
    }
  }

  return [...byPath.values()].sort((a, b) => a.repo_relative_path.localeCompare(b.repo_relative_path));
}
