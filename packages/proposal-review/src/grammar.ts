// The proposal visual grammar mapper (Milestone 11.3.2).
//
// Authority boundary -- mandatory reading before calling or modifying this
// function: `buildProposalVisualGrammar()` is a *mapper*, not an evaluator.
// Like adapter.ts, it calls zero @rvs/change-workbench evaluators and every
// `@rvs/change-workbench` import here is `import type` -- there is
// structurally nothing here for a value import to call. It calls zero
// @rvs/visual-intelligence content-producing functions either: it only maps
// an already-built `ProposalReviewVisualInput` (adapter.ts's own output)
// onto RVS's reusable visual-grammar vocabulary.
//
// North star: a deterministic, accessibility-aware semantic mapping from
// already-qualified proposal-review input into RVS's reusable visual
// grammar, without allowing caller-proposed or deterministically-projected
// architecture to masquerade as observed architecture. This module
// communicates upstream truth. It does not create truth:
//
//  - `truth_disclosure` is passed through byte-identical. There is no
//    second `reduceTopologyDisclosureStatus()` and no local freshness
//    reduction anywhere in this file.
//  - `governance`/`decisions`/`impact` are the advisory's own findings,
//    passed through unmodified and wrapped with an explicit
//    `basis: "proposal"` marker -- never recomputed, never given a
//    `VisualDecisionStatus`/`VisualConfidence` value (see the regression
//    tests in __tests__/grammar.test.ts for why those two types are
//    forbidden here).
//  - Per-entity/relation provenance is mapped, by matching literal only,
//    from `OverlayEntityProvenance` onto `@rvs/visual-intelligence`'s
//    generic `ProposalEntityProvenance` vocabulary via
//    `resolveProposalEntityProvenance()` -- reused, not reimplemented. The
//    mapping is exhaustive and fails closed: an `OverlayEntityProvenance`
//    value this function does not recognize throws rather than silently
//    defaulting to the least-alarming presentation.
//  - "No projected architecture to draw" is checked as
//    `projection.status !== "built" || projection.result.overlay ===
//    undefined` -- `status === "built"` alone does not guarantee
//    `result.overlay` exists (`OverlayBuildResult.overlay` stays `undefined`
//    when `result.status` is `"unresolved"`/`"invalid"`), so both cases
//    collapse into the same "not_built"-shaped grammar output for a
//    consumer, each carrying its own distinct `reason`.
//  - Entity-group topology (`advisory.topology[].entity_refs`) is
//    deliberately not implemented in this slice.
//
// Removed-entity model: `node_provenance`/`edge_provenance` already carry
// `"removed"` entries for ids that are structurally absent from
// `overlay.nodes`/`overlay.edges` -- this function reads provenance from
// those maps' own keys, never from `overlay.nodes`/`overlay.edges`, so a
// removed entity's provenance is represented here as "observed review
// subject + proposal removal marker" without ever being inserted into (or
// fabricated as part of) projected topology: this module produces no
// node/edge connectivity information at all, only an id-keyed provenance
// presentation manifest a future composition stage joins against the
// overlay's own nodes/edges.

import type {
  AdvisoryDecisionResult,
  AdvisoryGovernanceResult,
  ChangeAdvisory,
  ChangeWorkbenchProjectionOutcome,
  OverlayEntityProvenance,
} from "@rvs/change-workbench";
import type { ProposalEntityProvenance, ProposalEntityProvenancePresentation, ProposalTruthDisclosure } from "@rvs/visual-intelligence";
import { resolveProposalEntityProvenance } from "@rvs/visual-intelligence";
import type { ProposalReviewVisualInput } from "./contracts.js";

export const PROPOSAL_REVIEW_GRAMMAR_SCHEMA_VERSION = 1;

/** One projected entity's or relation's id, paired with its resolved provenance presentation. Deliberately carries no label, kind, or structural (from/to, position) data -- a future composition stage joins this against `overlay.nodes`/`overlay.edges` for that. */
export interface ProposalGrammarProvenanceEntry {
  id: string;
  presentation: ProposalEntityProvenancePresentation;
}

export type ProposalGrammarProjection =
  | { status: "built"; entities: ProposalGrammarProvenanceEntry[]; relations: ProposalGrammarProvenanceEntry[] }
  | { status: "not_built"; reason: string };

/** Wraps an advisory finding-set with an explicit, literal proposal-basis marker -- never a computed judgment, never a `VisualDecisionStatus`/`VisualConfidence` value. */
export interface ProposalGrammarAdvisoryBasis<T> {
  basis: "proposal";
  result: T;
}

export interface ProposalVisualGrammarModel {
  schema_version: number;
  /** Points back at the `ProposalReviewVisualInput` this was mapped from -- not a new identity scheme. */
  proposal_review_visual_input_id: string;
  /** Passed through byte-identical -- the sole truth authority. Never reconstructed. */
  truth_disclosure: ProposalTruthDisclosure;
  projection: ProposalGrammarProjection;
  governance: ProposalGrammarAdvisoryBasis<AdvisoryGovernanceResult>;
  decisions: ProposalGrammarAdvisoryBasis<AdvisoryDecisionResult>;
  impact: ProposalGrammarAdvisoryBasis<ChangeAdvisory["impact"]>;
}

/**
 * Exhaustive, fail-closed mapping by matching literal only.
 * `OverlayEntityProvenance` and `ProposalEntityProvenance` are separately
 * declared, identically spelled four-value unions -- this function is the
 * one place in the repository permitted to know both.
 */
function mapOverlayProvenance(provenance: OverlayEntityProvenance): ProposalEntityProvenance {
  switch (provenance) {
    case "confirmed":
      return "confirmed";
    case "proposed":
      return "proposed";
    case "modified":
      return "modified";
    case "removed":
      return "removed";
    default: {
      const exhaustive: never = provenance;
      throw new Error(`buildProposalVisualGrammar: unrecognized OverlayEntityProvenance value ${JSON.stringify(exhaustive)}`);
    }
  }
}

function byId(a: ProposalGrammarProvenanceEntry, b: ProposalGrammarProvenanceEntry): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mapProvenanceRecord(record: Record<string, OverlayEntityProvenance>): ProposalGrammarProvenanceEntry[] {
  return Object.entries(record)
    .map(([id, provenance]) => ({ id, presentation: resolveProposalEntityProvenance(mapOverlayProvenance(provenance)) }))
    .sort(byId);
}

function mapProjection(projection: ChangeWorkbenchProjectionOutcome): ProposalGrammarProjection {
  if (projection.status === "not_built") {
    return { status: "not_built", reason: projection.reason };
  }
  const overlay = projection.result.overlay;
  if (overlay === undefined) {
    return {
      status: "not_built",
      reason: `Overlay build was attempted (status: "built") but produced no overlay because the build's own result.status was "${projection.result.status}" -- there is no projected architecture to draw.`,
    };
  }
  return {
    status: "built",
    entities: mapProvenanceRecord(overlay.node_provenance),
    relations: mapProvenanceRecord(overlay.edge_provenance),
  };
}

/**
 * Maps one `ProposalReviewVisualInput` onto RVS's reusable visual-grammar
 * vocabulary. Deterministic and side-effect free: the same input always
 * produces byte-identical output, independent of object-key insertion
 * order (provenance entries are sorted by id) and of wall-clock time,
 * randomness, or process state.
 */
export function buildProposalVisualGrammar(input: ProposalReviewVisualInput): ProposalVisualGrammarModel {
  return {
    schema_version: PROPOSAL_REVIEW_GRAMMAR_SCHEMA_VERSION,
    proposal_review_visual_input_id: input.id,
    truth_disclosure: input.truth_disclosure,
    projection: mapProjection(input.projection),
    governance: { basis: "proposal", result: input.advisory.governance },
    decisions: { basis: "proposal", result: input.advisory.decisions },
    impact: { basis: "proposal", result: input.advisory.impact },
  };
}
