// Baseline resolution for `rvs change evaluate`/`rvs change explain`: the
// confirmed-graph snapshot a proposal is evaluated against, drawn entirely
// from the existing Knowledge Graph cache -- never auto-built. A missing
// snapshot fails via readGraphCachedJson's own error ("Run `rvs graph build`
// first."), satisfying Milestone 11.2 §13 with no additional guidance code.
//
// Milestone 11.3.3A-K2/B: the persisted snapshot's `content_digest` is
// verified against the independently loaded nodes/edges via the canonical
// @rvs/knowledge-graph verifier -- never a locally reimplemented digest.
// The snapshot is read as `GraphContentAttestationInput` (content_digest
// optional), not `GraphSnapshot` (content_digest required), because a
// pre-K1 cache directory on disk genuinely may not carry the field at
// runtime even though the canonical type now requires it -- asserting it
// as `GraphSnapshot` would misrepresent that legacy state as attested.

import { buildDecisionStateLookup, verifyGraphContentDigest } from "@rvs/knowledge-graph";
import type {
  ContentDigestVerification,
  DecisionStateLookup,
  GraphContentAttestationInput,
  KnowledgeEdge,
  KnowledgeNode,
} from "@rvs/knowledge-graph";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { ArchitectureDecision, DecisionAssumption } from "@rvs/decision-intelligence";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphCachedJson } from "../graph-cache.js";

export interface ChangeWorkbenchBaseline {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  baseSnapshotDigest: string;
  decisionStateLookup: DecisionStateLookup;
  contentAttestation: ContentDigestVerification;
}

/** Mirrors graph-build.ts's/graph-plan-change.ts's own established construction of a decision-state lookup from best-effort optional decision cache artifacts. */
export function resolveChangeWorkbenchBaseline(repoRoot: string): ChangeWorkbenchBaseline {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");
  const snapshot = readGraphCachedJson<GraphContentAttestationInput>(repoRoot, "graph-snapshot.json");
  const contentAttestation = verifyGraphContentDigest(snapshot, nodes, edges);

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(repoRoot, DECISION_OUTPUT_FILES.decisions);
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(repoRoot, DECISION_OUTPUT_FILES.assumptions);
  const decisionStateLookup = buildDecisionStateLookup(decisionsFile, rawAssumptions ? { assumptions: rawAssumptions } : undefined);

  return { nodes, edges, baseSnapshotDigest: snapshot.digest, decisionStateLookup, contentAttestation };
}
