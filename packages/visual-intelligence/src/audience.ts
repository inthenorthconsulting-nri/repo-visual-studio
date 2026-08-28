import type { VisualAudience } from "./contracts.js";
import { isVisualAudience } from "./vocabulary.js";

// Audience policy.
//
// The single rule this file exists to enforce: **audience and detail are
// independent dimensions**. Nothing here returns a DetailMode, reads one to
// decide anything, or narrows which detail modes an audience may combine
// with. `executive + faithful` and `engineering + simplified` are both
// ordinary, supported combinations -- an executive reading an incident review
// wants every node, and an engineer orienting on an unfamiliar system wants
// the map, not the territory.
//
// Audience controls how the surviving content is *described*:
// terminology, annotation depth, evidence visibility, explanatory labelling,
// and technical-identifier exposure. Detail controls how much content
// survives at all: entity count, grouping, edge density, topology depth.

/** How much of an entity's technical identity is exposed to the reader. */
export type IdentifierExposure =
  /** Display labels only; stable ids stay in the DOM/data attributes for tooling but are never drawn. */
  | "label-only"
  /** Display label with the stable id available on demand (hover, inspector, footnote). */
  | "label-with-id-on-demand"
  /** Stable ids drawn alongside labels -- the reader is expected to grep for them. */
  | "label-and-id";

/** How much explanatory annotation accompanies the view. */
export type AnnotationDepth = "minimal" | "moderate" | "full";

/** How evidence citations are surfaced. */
export type EvidenceVisibility =
  /** No citations drawn; evidence refs are still carried in the spec and inspectable. */
  | "carried-not-drawn"
  /** A count/summary line ("14 evidence references"). */
  | "summarised"
  /** Full per-entity citations, as the existing deck footer already renders. */
  | "cited";

/** Which register labels are written in. Never rewrites a governance severity or a decision status -- see `TERMINOLOGY_INVARIANTS`. */
export type TerminologyRegister = "business" | "product" | "architectural" | "implementation" | "operational";

export interface AudiencePolicy {
  audience: VisualAudience;
  terminology: TerminologyRegister;
  annotation_depth: AnnotationDepth;
  evidence_visibility: EvidenceVisibility;
  identifier_exposure: IdentifierExposure;
  /** Whether explanatory labels ("what am I looking at") are drawn on the view itself. */
  explanatory_labels: boolean;
}

const POLICIES: Readonly<Record<VisualAudience, AudiencePolicy>> = {
  executive: {
    audience: "executive",
    terminology: "business",
    annotation_depth: "minimal",
    evidence_visibility: "summarised",
    identifier_exposure: "label-only",
    explanatory_labels: true,
  },
  product: {
    audience: "product",
    terminology: "product",
    annotation_depth: "moderate",
    evidence_visibility: "summarised",
    identifier_exposure: "label-only",
    explanatory_labels: true,
  },
  "architecture-review": {
    audience: "architecture-review",
    terminology: "architectural",
    annotation_depth: "full",
    evidence_visibility: "cited",
    identifier_exposure: "label-with-id-on-demand",
    explanatory_labels: true,
  },
  engineering: {
    audience: "engineering",
    terminology: "implementation",
    annotation_depth: "full",
    evidence_visibility: "cited",
    identifier_exposure: "label-and-id",
    explanatory_labels: false,
  },
  operations: {
    audience: "operations",
    terminology: "operational",
    annotation_depth: "moderate",
    evidence_visibility: "cited",
    identifier_exposure: "label-and-id",
    explanatory_labels: false,
  },
  mixed: {
    audience: "mixed",
    terminology: "architectural",
    annotation_depth: "moderate",
    evidence_visibility: "cited",
    identifier_exposure: "label-with-id-on-demand",
    explanatory_labels: true,
  },
};

/**
 * Facts an audience policy may never restate in its own register.
 *
 * A view written for executives may describe a component in business terms;
 * it may not describe a `blocking` governance finding as "a note", or a
 * `superseded` decision as "retired", because severity and status are owned
 * by Governance Intelligence and Decision Intelligence respectively. The
 * renderer may emphasise them differently; it may not restate them.
 */
export const TERMINOLOGY_INVARIANTS: readonly string[] = [
  "governance_severity",
  "decision_status",
  "resolution_status",
  "confidence",
] as const;

export function audiencePolicyFor(audience: VisualAudience): AudiencePolicy {
  return POLICIES[audience];
}

/**
 * Maps the audience/profile vocabulary the existing CLI already accepts onto
 * the generic reader classes above.
 *
 * Kept as a mapping rather than as an extension of `VisualAudience` so the
 * contract stays generic: the visual layer knows about five reader classes,
 * and this function is the one seam where RVS's own profile names touch it.
 * Anything unrecognised resolves to `mixed` -- never to a guess, and never
 * to an error, since an unknown audience is a presentation-configuration
 * matter, not a correctness one.
 */
export function resolveAudience(value: string | undefined): VisualAudience {
  if (value === undefined) return "mixed";
  const normalized = value.trim().toLowerCase();
  if (isVisualAudience(normalized)) return normalized;
  switch (normalized) {
    case "product_leader":
    case "product-leader":
    case "showcase":
    case "conference":
      return "product";
    case "platform_leader":
    case "platform-leader":
    case "engineering_leader":
    case "engineering-leader":
    case "portfolio":
      return "executive";
    case "architect":
    case "design-review":
    case "architecture_review":
      return "architecture-review";
    case "developer":
    case "engineering-onboarding":
    case "repository-inventory":
    case "repository-audit":
      return "engineering";
    case "operator":
    case "operating-review":
      return "operations";
    default:
      return "mixed";
  }
}
