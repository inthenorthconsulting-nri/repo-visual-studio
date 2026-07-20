import type { BlastRadiusLevel, GovernanceArtifactKind, GovernanceChangeClassification, GovernanceChangeType, GovernanceCompatibilityStatus, GovernanceLineageState, GovernanceSeverity } from "./contracts.js";

// ---------------------------------------------------------------------------
// classifyChange -- the single shared rule set every one of the four
// *ChangeSet diff engines (architecture-diff.ts, capability-diff.ts,
// product-diff.ts, portfolio-diff.ts) calls to populate
// GovernanceChangeEntry.classification, so governance_severity/materiality/
// compatibility_impact/etc. are derived by ONE deterministic rule set
// instead of four slightly-different copies.
//
// Deliberately takes a small, explicit, named-field input rather than a
// generic object bag: every field below is something a diff engine can state
// outright from what it already compared (the change type, which domain,
// whether the entity's evidence/lineage was lost, whether the entity is a
// runtime-facing one) -- never a derived judgment call smuggled in through an
// open-ended payload.
// ---------------------------------------------------------------------------

export interface ClassifyChangeInput {
  /** Which upstream domain (or the evidence rollup) this change belongs to. */
  domain: GovernanceArtifactKind | "evidence";
  /** How this entity compared between the source and target snapshot. */
  changeType: GovernanceChangeType;
  /**
   * Whether this entity is one whose loss/change reduces something a
   * consumer can actually run or rely on at runtime (e.g. a component, a
   * runtime entry point, a workflow, an operational capability) as opposed
   * to purely descriptive/narrative metadata (a label, a one-line
   * description, documentation-only evidence).
   */
  isRuntimeEntity: boolean;
  /** Whether the evidence/lineage backing this entity survived the transition from source to target. */
  lineage: GovernanceLineageState;
  /** Whether the entity's underlying evidence array itself changed (added/removed/reordered items), as opposed to only a descriptive/label field changing with evidence held constant. */
  evidenceChanged: boolean;
  /**
   * Optional signal from the diff engine that a weaker (not just different)
   * evidence-backed value replaced a stronger one -- used to distinguish
   * "qualified" from "material" materiality. Omitted when not applicable
   * (e.g. architecture/capability/portfolio diffs that don't reason about
   * relative evidence strength).
   */
  evidenceStrengthDelta?: "stronger" | "weaker" | "same" | "unknown";
  /** Overrides the derived confidence when the diff engine has a more specific signal (e.g. "derived" for a heuristically-detected rename). Defaults are derived from `changeType` below. */
  confidence?: "confirmed" | "derived" | "suggested" | "unresolved";
}

const SEVERITY_RANK: Record<GovernanceSeverity, number> = {
  informational: 0,
  advisory: 1,
  review_required: 2,
  blocking: 3,
};

/**
 * §-reservation: this function must NEVER independently return "blocking".
 * "blocking" is reserved for policy evaluation (a future governance stage
 * that knows about explicit GovernanceRule/GovernancePolicy objects and can
 * say a change violates a required policy) -- raw diffing has no concept of
 * "required" or "forbidden", only "changed" and "how much evidence backs
 * it". The severity floor this function computes is exactly that: a FLOOR a
 * later policy-evaluation stage may raise, never itself the final word.
 */
function deriveSeverity(input: ClassifyChangeInput): GovernanceSeverity {
  let floor: GovernanceSeverity = "informational";
  const raise = (level: GovernanceSeverity) => {
    if (SEVERITY_RANK[level] > SEVERITY_RANK[floor]) floor = level;
  };

  if (input.changeType === "unresolved") raise("review_required");
  if (input.changeType === "modified" || input.changeType === "renamed") raise(input.evidenceChanged ? "advisory" : "informational");
  if (input.changeType === "reclassified") raise("advisory");
  if (input.changeType === "removed") raise("advisory");
  // Explicit per spec: a removed/reclassified entity affecting a
  // runtime/evidence-bearing entity is *at least* advisory (redundant with
  // the blanket "removed" rule above in most cases, but keeps the
  // runtime-specific floor visible and independently testable).
  if ((input.changeType === "removed" || input.changeType === "reclassified") && input.isRuntimeEntity) raise("advisory");
  if (input.lineage === "weakened") raise("advisory");
  // Broken evidence lineage on ANYTHING is at least review_required,
  // regardless of change type or runtime-ness.
  if (input.lineage === "broken") raise("review_required");

  // NEVER raise to "blocking" here -- see function doc comment above.
  return floor;
}

function deriveMateriality(input: ClassifyChangeInput): GovernanceChangeClassification["materiality"] {
  if (input.changeType === "unresolved") return "unresolved";
  if (input.changeType === "unchanged") return "editorial";
  if (!input.evidenceChanged) return "editorial";
  if (input.evidenceStrengthDelta === "weaker") return "qualified";
  if (input.lineage === "weakened" || input.lineage === "unverifiable") return "qualified";
  return "material";
}

function deriveConfidence(input: ClassifyChangeInput): GovernanceChangeClassification["confidence"] {
  if (input.confidence) return input.confidence;
  switch (input.changeType) {
    case "unresolved":
      return "unresolved";
    case "renamed":
    case "reclassified":
      return "derived";
    default:
      return "confirmed";
  }
}

function deriveCompatibilityImpact(input: ClassifyChangeInput): GovernanceCompatibilityStatus {
  if (input.lineage === "broken") return "incompatible";
  if (input.lineage === "weakened") return "compatible_with_warnings";
  if ((input.changeType === "removed" || input.changeType === "reclassified") && input.isRuntimeEntity) return "compatible_with_warnings";
  if (input.changeType === "unresolved") return "partial";
  return "compatible";
}

function deriveRuntimeImpact(input: ClassifyChangeInput): GovernanceChangeClassification["runtime_impact"] {
  if (!input.isRuntimeEntity) return "none";
  if (input.changeType === "unresolved") return "unresolved";
  if (input.changeType === "removed") return "lost";
  if ((input.changeType === "modified" || input.changeType === "reclassified") && (input.lineage === "broken" || input.lineage === "weakened")) return "reduced";
  return "none";
}

/**
 * Neither raw diffing nor this classifier has consumer/dependency-graph
 * access (that is blast-radius.ts's job, run as a separate later stage with
 * its own raw-artifact input). An "unchanged" entity is trivially isolated
 * (nothing to widen from); everything else's true reach is unknown until
 * blast-radius.ts's BFS runs, so it is conservatively "unresolved" here --
 * never guessed as "isolated", matching this package's unknown-is-not-
 * no-impact rule.
 */
function deriveConsumerImpact(input: ClassifyChangeInput): BlastRadiusLevel {
  return input.changeType === "unchanged" ? "isolated" : "unresolved";
}

function derivePortfolioImpact(input: ClassifyChangeInput): GovernanceChangeClassification["portfolio_impact"] {
  if (input.changeType === "unchanged") return "none";
  if (input.domain === "portfolio") return "affected";
  // A non-portfolio-domain change MAY ripple into portfolio-level
  // relationships, but this classifier has no cross-reference into the
  // portfolio artifact to confirm or deny that -- conservatively unresolved.
  return "unresolved";
}

export function classifyChange(input: ClassifyChangeInput): GovernanceChangeClassification {
  return {
    domain: input.domain,
    materiality: deriveMateriality(input),
    confidence: deriveConfidence(input),
    governance_severity: deriveSeverity(input),
    compatibility_impact: deriveCompatibilityImpact(input),
    evidence_impact: input.lineage,
    runtime_impact: deriveRuntimeImpact(input),
    consumer_impact: deriveConsumerImpact(input),
    portfolio_impact: derivePortfolioImpact(input),
  };
}
