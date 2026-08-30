// Top-level ChangeAdvisory orchestration. Composes validation.ts,
// overlay.ts, impact-advisory.ts, governance-advisory.ts, and
// decision-advisory.ts into one deterministic, non-authoritative
// `ChangeAdvisory`. Identity depends on both the proposal's own id and the
// baseline snapshot digest it was evaluated against (see ids.ts's
// `buildChangeAdvisoryId`), so the same proposal evaluated against two
// different baselines never collides.

import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import type { DecisionStateLookup } from "@rvs/knowledge-graph";
import type { EvaluatePolicyInput } from "@rvs/governance-intelligence";
import type { ChangeAdvisory, DomainCoverageState, DomainCoverageStatus, EvidenceRef, OverlayBuildResult, ProposalOperation, ProposalValidationResult, ProposedChangeSet, TopologyDisclosure } from "./contracts.js";
import { CHANGE_WORKBENCH_SCHEMA_VERSION } from "./constants.js";
import { buildChangeAdvisoryId, buildProposedChangeSetId } from "./ids.js";
import { validateProposedChangeSet } from "./validation.js";
import { buildChangeOverlay } from "./overlay.js";
import { buildImpactAdvisory } from "./impact-advisory.js";
import { buildGovernanceAdvisory } from "./governance-advisory.js";
import { buildDecisionAdvisory } from "./decision-advisory.js";

export interface ComposeProposedChangeSetParams {
  repositoryId: string;
  operations: ProposalOperation[];
  title?: string;
  evidenceRefs?: EvidenceRef[];
}

/** The only way this package mints a ProposedChangeSet.id -- shuffle-invariant, no timestamp in identity material. */
export function composeProposedChangeSet(params: ComposeProposedChangeSetParams): ProposedChangeSet {
  return {
    schema_version: CHANGE_WORKBENCH_SCHEMA_VERSION,
    id: buildProposedChangeSetId(params.repositoryId, params.operations),
    repository_id: params.repositoryId,
    title: params.title,
    operations: params.operations,
    evidence_refs: params.evidenceRefs,
  };
}

export interface BuildChangeAdvisoryParams {
  changeSet: ProposedChangeSet;
  confirmedNodes: readonly KnowledgeNode[];
  confirmedEdges: readonly KnowledgeEdge[];
  baseSnapshotDigest: string;
  maxImpactDepth?: number;
  decisionStateLookup?: DecisionStateLookup;
  governanceEvaluationInput?: EvaluatePolicyInput;
}

export function buildChangeAdvisory(params: BuildChangeAdvisoryParams): ChangeAdvisory {
  const { changeSet, confirmedNodes, confirmedEdges, baseSnapshotDigest, maxImpactDepth, decisionStateLookup, governanceEvaluationInput } = params;

  const proposalValidation = validateProposedChangeSet(changeSet, { confirmedNodes, confirmedEdges });
  const overlayResult = proposalValidation.status === "invalid" ? undefined : buildChangeOverlay({ changeSet, confirmedNodes, confirmedEdges, baseSnapshotDigest });

  return buildChangeAdvisoryFromEvaluationInputs({
    changeSet,
    baseSnapshotDigest,
    proposalValidation,
    overlayResult,
    maxImpactDepth,
    decisionStateLookup,
    governanceEvaluationInput,
  });
}

export interface BuildChangeAdvisoryFromEvaluationInputsParams {
  changeSet: ProposedChangeSet;
  baseSnapshotDigest: string;
  /** Already computed by the caller -- never re-derived here. */
  proposalValidation: ProposalValidationResult;
  /**
   * Already computed by the caller -- never re-derived here. `undefined`
   * means overlay construction was never attempted (currently: an invalid
   * proposal); it is never a stand-in for "attempted and produced nothing".
   */
  overlayResult: OverlayBuildResult | undefined;
  maxImpactDepth?: number;
  decisionStateLookup?: DecisionStateLookup;
  governanceEvaluationInput?: EvaluatePolicyInput;
}

/**
 * The shared advisory-construction core behind both buildChangeAdvisory()
 * and evaluateProposedChange(). Takes proposal validation and overlay
 * construction as already-computed inputs so neither caller ever replays
 * validateProposedChangeSet() or buildChangeOverlay() -- this function has
 * no access to confirmedNodes/confirmedEdges and structurally cannot call
 * either itself.
 */
export function buildChangeAdvisoryFromEvaluationInputs(params: BuildChangeAdvisoryFromEvaluationInputsParams): ChangeAdvisory {
  const { changeSet, baseSnapshotDigest, proposalValidation, overlayResult, maxImpactDepth, decisionStateLookup, governanceEvaluationInput } = params;

  const topology = buildTopologyDisclosure(changeSet);
  const id = buildChangeAdvisoryId(changeSet.id, baseSnapshotDigest);
  const governance = buildGovernanceAdvisory({ evaluationInput: governanceEvaluationInput });

  if (proposalValidation.status === "invalid") {
    return {
      schema_version: CHANGE_WORKBENCH_SCHEMA_VERSION,
      id,
      proposal_id: changeSet.id,
      repository_id: changeSet.repository_id,
      base_snapshot_digest: baseSnapshotDigest,
      proposal_validation: proposalValidation,
      topology,
      impact: { status: "not_evaluated", detail: "Proposal validation failed with a blocking issue; impact analysis was not attempted against an overlay this package will not build from an invalid proposal.", directly_affected_refs: [], transitively_affected_refs: [], blast_radius_level: "unresolved", unresolved_downstream_impact: true, truncated: false },
      governance,
      decisions: { status: "not_evaluated", detail: "Proposal validation failed with a blocking issue; decision-impact analysis was not attempted.", findings: [], capability_registry: [] },
      domain_coverage: [
        { domain: "impact", status: "not_applicable", detail: "Blocked by invalid proposal validation." },
        { domain: "governance", status: coverageStatusFor(governance.status), detail: governance.detail },
        { domain: "decisions", status: "not_applicable", detail: "Blocked by invalid proposal validation." },
        { domain: "topology", status: topologyCoverageStatus(topology), detail: "See per-entity topology disclosures." },
      ],
      evidence_refs: dedupeEvidenceRefs(changeSet.evidence_refs ?? []),
    };
  }

  const overlay = overlayResult?.overlay;

  const impact = overlay
    ? buildImpactAdvisory({ overlay, operations: changeSet.operations, maxDepth: maxImpactDepth, decisionStateLookup })
    : { status: "unresolved" as const, detail: "Overlay could not be built.", directly_affected_refs: [], transitively_affected_refs: [], blast_radius_level: "unresolved" as const, unresolved_downstream_impact: true, truncated: false, evidence_refs: [], per_root_results: [] };

  const decisions = overlay
    ? buildDecisionAdvisory({ overlay, operations: changeSet.operations, decisionStateLookup })
    : { status: "unresolved" as const, detail: "Overlay could not be built.", findings: [], capability_registry: [] };

  const evidenceRefs = dedupeEvidenceRefs([...(changeSet.evidence_refs ?? []), ...impact.evidence_refs, ...operationsEvidenceRefs(changeSet.operations)]);

  return {
    schema_version: CHANGE_WORKBENCH_SCHEMA_VERSION,
    id,
    proposal_id: changeSet.id,
    repository_id: changeSet.repository_id,
    base_snapshot_digest: baseSnapshotDigest,
    proposal_validation: proposalValidation,
    topology,
    impact: { status: impact.status, detail: impact.detail, directly_affected_refs: impact.directly_affected_refs, transitively_affected_refs: impact.transitively_affected_refs, blast_radius_level: impact.blast_radius_level, unresolved_downstream_impact: impact.unresolved_downstream_impact, truncated: impact.truncated },
    governance,
    decisions,
    domain_coverage: [
      { domain: "impact", status: coverageStatusFor(impact.status), detail: impact.detail },
      { domain: "governance", status: coverageStatusFor(governance.status), detail: governance.detail },
      { domain: "decisions", status: coverageStatusFor(decisions.status), detail: decisions.detail },
      { domain: "topology", status: topologyCoverageStatus(topology), detail: "See per-entity topology disclosures." },
    ],
    evidence_refs: evidenceRefs,
  };
}

function coverageStatusFor(status: "evaluated" | "not_evaluated" | "unresolved"): DomainCoverageStatus {
  switch (status) {
    case "evaluated":
      return "evaluated";
    case "unresolved":
      return "unresolved";
    case "not_evaluated":
      return "not_applicable";
  }
}

function topologyCoverageStatus(topology: TopologyDisclosure[]): DomainCoverageStatus {
  if (topology.some((entry) => entry.status === "unresolved")) return "unresolved";
  if (topology.some((entry) => entry.status === "partial" || entry.status === "not_supplied")) return "partial";
  return "evaluated";
}

function operationsEvidenceRefs(operations: ProposalOperation[]): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const operation of operations) {
    if ((operation.kind === "add_entity" || operation.kind === "add_relation") && operation.evidence_refs) refs.push(...operation.evidence_refs);
  }
  return refs;
}

function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * Never implies zero impact from missing topology. Every relation
 * operation is "explicit" for both its endpoints; a newly proposed entity
 * with no declared relations is "not_supplied" (never read as "has no
 * relations"); one with some declared relations is "partial" (declared
 * relations are known, but a new entity's eventual real-world topology may
 * exceed what this proposal bothered to state); an existing entity's
 * topology that this proposal does not touch is "explicit" -- it is simply
 * inherited unchanged from the confirmed graph, which is not missing
 * information.
 */
function buildTopologyDisclosure(changeSet: ProposedChangeSet): TopologyDisclosure[] {
  const disclosures: TopologyDisclosure[] = [];
  const relationRefs = new Set<string>();

  for (const operation of changeSet.operations) {
    if (operation.kind === "add_relation" || operation.kind === "remove_relation" || operation.kind === "modify_relation") {
      relationRefs.add(operation.from_ref);
      relationRefs.add(operation.to_ref);
      disclosures.push({
        status: "explicit",
        detail: `${operation.kind} explicitly declares the "${operation.edge_type}" relation between "${operation.from_ref}" and "${operation.to_ref}".`,
        entity_refs: [operation.from_ref, operation.to_ref],
      });
    }
  }

  for (const operation of changeSet.operations) {
    if (operation.kind === "add_entity") {
      disclosures.push(
        relationRefs.has(operation.ref)
          ? { status: "partial", detail: `"${operation.ref}" is a newly proposed entity; only the relations explicitly declared elsewhere in this proposal are known -- its eventual real topology may include more.`, entity_refs: [operation.ref] }
          : { status: "not_supplied", detail: `"${operation.ref}" is a newly proposed entity with no add_relation operations declared for it -- absence of declared relations is never treated as evidence the entity truly has none.`, entity_refs: [operation.ref] },
      );
    } else if (operation.kind === "remove_entity") {
      disclosures.push({ status: "explicit", detail: `"${operation.ref}"'s removal deterministically removes every confirmed edge touching it -- a known consequence, not missing information.`, entity_refs: [operation.ref] });
    } else if (operation.kind === "modify_attributes" && !relationRefs.has(operation.ref)) {
      disclosures.push({ status: "explicit", detail: `"${operation.ref}"'s topology is unchanged from the confirmed graph; this proposal only modifies its attributes.`, entity_refs: [operation.ref] });
    }
  }

  if (disclosures.length === 0) {
    disclosures.push({ status: "not_supplied", detail: "This proposal contains no operations to disclose topology for.", entity_refs: [] });
  }

  return disclosures.sort((a, b) => a.entity_refs.join(",").localeCompare(b.entity_refs.join(",")) || a.status.localeCompare(b.status) || a.detail.localeCompare(b.detail));
}
