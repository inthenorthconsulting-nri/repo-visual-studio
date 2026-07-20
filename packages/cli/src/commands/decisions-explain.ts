import type { Logger } from "@rvs/core";
import { DECISION_OUTPUT_FILES, explainDecisionId } from "@rvs/decision-intelligence";
import type {
  DecisionAssumption,
  DecisionBlastRadiusAssessment,
  DecisionChangeSet,
  DecisionConflict,
  DecisionConsequence,
  DecisionCoverageMetric,
  DecisionDebtFinding,
  DecisionDrift,
  DecisionImplementationState,
  DecisionLink,
  DecisionSnapshot,
  DecisionSupersessionChain,
  MissingDecisionFinding,
  MissingImplementationFinding,
} from "@rvs/decision-intelligence";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";

// decision-debt.json/implementation-state.json/supersession.json each fold
// in a second, related collection (see decisions-analyze.ts's comment on
// why) -- read back only the slice DecisionExplainContext actually wants.

interface DecisionDebtFile {
  findings: DecisionDebtFinding[];
  missing_decision_findings: MissingDecisionFinding[];
}

interface ImplementationStateFile {
  states: DecisionImplementationState[];
  missing_implementation_findings: MissingImplementationFinding[];
}

interface SupersessionFile {
  issues: unknown[];
  chains: DecisionSupersessionChain[];
}

export async function runDecisionsExplain(repoRoot: string, id: string, logger: Logger): Promise<void> {
  const snapshot = readDecisionCachedJsonOptional<DecisionSnapshot>(repoRoot, DECISION_OUTPUT_FILES.decisionSnapshot);
  const assumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const consequences = readDecisionCachedJsonOptional<DecisionConsequence[]>(repoRoot, DECISION_OUTPUT_FILES.consequences);
  const links = readDecisionCachedJsonOptional<DecisionLink[]>(repoRoot, DECISION_OUTPUT_FILES.decisionLinks);
  const conflicts = readDecisionCachedJsonOptional<DecisionConflict[]>(repoRoot, DECISION_OUTPUT_FILES.conflicts);
  const drift = readDecisionCachedJsonOptional<DecisionDrift[]>(repoRoot, DECISION_OUTPUT_FILES.drift);
  const debtFile = readDecisionCachedJsonOptional<DecisionDebtFile>(repoRoot, DECISION_OUTPUT_FILES.decisionDebt);
  const coverage = readDecisionCachedJsonOptional<DecisionCoverageMetric[]>(repoRoot, DECISION_OUTPUT_FILES.coverage);
  const implementationStateFile = readDecisionCachedJsonOptional<ImplementationStateFile>(repoRoot, DECISION_OUTPUT_FILES.implementationState);
  const changeSet = readDecisionCachedJsonOptional<DecisionChangeSet>(repoRoot, DECISION_OUTPUT_FILES.decisionChanges);
  const supersessionFile = readDecisionCachedJsonOptional<SupersessionFile>(repoRoot, DECISION_OUTPUT_FILES.supersession);
  const blastRadius = readDecisionCachedJsonOptional<DecisionBlastRadiusAssessment[]>(repoRoot, DECISION_OUTPUT_FILES.decisionBlastRadius);

  try {
    const result = explainDecisionId(id, {
      snapshot,
      assumptions,
      consequences,
      links,
      conflicts,
      drift,
      debtFindings: debtFile?.findings,
      coverage,
      implementationStates: implementationStateFile?.states,
      changeSet,
      supersessionChains: supersessionFile?.chains,
      blastRadius,
    });
    logger.info(result.explanation);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
