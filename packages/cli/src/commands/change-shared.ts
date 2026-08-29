// Shared execution functions for the `rvs change` command family, per
// Milestone 11.2 §12 (mirroring runGraphBuild/runDecisionAnalysis's
// established precedent): all decode/baseline/evaluate logic lives here,
// reusable independently of Commander/CLI I/O (§8, §29) -- the actual
// command action functions (change-validate.ts/change-evaluate.ts) are
// thin wrappers that call these and handle terminal/--output/exit-code
// presentation only.

import { validateProposedChangeSet } from "@rvs/change-workbench";
import type { ChangeAdvisory, ProposalValidationIssue, ProposalValidationResult, ProposedChangeSet } from "@rvs/change-workbench";
import { buildChangeAdvisory } from "@rvs/change-workbench";
import { decodeProposalFile } from "./change-decode.js";
import { resolveChangeWorkbenchBaseline } from "./change-baseline.js";
import { readGraphCachedJsonOptional } from "../graph-cache.js";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";

export type ChangeWorkbenchValidationOutcome =
  | { outcome: "rejected"; path: string; issues: ProposalValidationIssue[] }
  | { outcome: "validated"; path: string; changeSet: ProposedChangeSet; result: ProposalValidationResult };

/**
 * `rvs change validate`'s shared execution: decode + validate only. Uses
 * whatever confirmed-graph baseline is already cached (best-effort, via
 * readGraphCachedJsonOptional) so ref-existence checks can run when
 * available, but -- unlike `evaluate` -- never requires `rvs graph build`
 * to have been run first; a missing baseline simply degrades ref checks to
 * the validator's own non-blocking `unresolved_confirmation_context`.
 */
export function runChangeWorkbenchValidation(repoRoot: string, filePath: string): ChangeWorkbenchValidationOutcome {
  const decoded = decodeProposalFile(repoRoot, filePath);
  if (decoded.status === "rejected") {
    return { outcome: "rejected", path: decoded.path, issues: decoded.issues };
  }

  const confirmedNodes = readGraphCachedJsonOptional<KnowledgeNode[]>(repoRoot, "nodes.json");
  const confirmedEdges = readGraphCachedJsonOptional<KnowledgeEdge[]>(repoRoot, "edges.json");
  const result = validateProposedChangeSet(decoded.changeSet, { confirmedNodes, confirmedEdges });

  return { outcome: "validated", path: decoded.path, changeSet: decoded.changeSet, result };
}

export type ChangeWorkbenchEvaluationOutcome =
  | { outcome: "rejected"; path: string; issues: ProposalValidationIssue[] }
  | { outcome: "evaluated"; path: string; advisory: ChangeAdvisory };

/**
 * `rvs change evaluate`'s shared execution: decode, resolve the confirmed
 * baseline (§13 -- throws with `rvs graph build` guidance if missing, never
 * auto-built), and run the one canonical buildChangeAdvisory(). No
 * governance policy input is wired in Milestone 11.2 -- buildGovernanceAdvisory
 * honestly reports `not_evaluated` rather than fabricating a policy result.
 */
export function runChangeWorkbenchEvaluation(repoRoot: string, filePath: string): ChangeWorkbenchEvaluationOutcome {
  const decoded = decodeProposalFile(repoRoot, filePath);
  if (decoded.status === "rejected") {
    return { outcome: "rejected", path: decoded.path, issues: decoded.issues };
  }

  const baseline = resolveChangeWorkbenchBaseline(repoRoot);
  const advisory = buildChangeAdvisory({
    changeSet: decoded.changeSet,
    confirmedNodes: baseline.nodes,
    confirmedEdges: baseline.edges,
    baseSnapshotDigest: baseline.baseSnapshotDigest,
    decisionStateLookup: baseline.decisionStateLookup,
  });

  return { outcome: "evaluated", path: decoded.path, advisory };
}
