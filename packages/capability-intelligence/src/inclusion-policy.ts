import type { CapabilityCandidate, CapabilityConfidence, CapabilityExclusionReasonCode, CapabilityInclusion, CapabilityReadiness, CapabilityStatus } from "./contracts.js";
import { PLACEHOLDER_STYLE_SIGNAL_KEYWORDS } from "./contracts.js";
import type { CapabilityEvidenceAggregate } from "./evidence.js";

export interface InclusionDecision {
  inclusion: CapabilityInclusion;
  reasonCodes: CapabilityExclusionReasonCode[];
  reasonSummary: string;
  confidence: CapabilityConfidence;
}

/** True when the candidate carries a "fake implementation" style keyword (mock, stub, prototype, draft, placeholder) as one of its matched incomplete signals. */
function hasPlaceholderSignal(candidate: CapabilityCandidate): boolean {
  return candidate.matchedIncompleteSignals.some((s) => PLACEHOLDER_STYLE_SIGNAL_KEYWORDS.includes(s));
}

/** True when the candidate's own text explicitly flags it as disabled, without also carrying a deprecated/archived signal — a real, distinguishable evidence pattern from a generic deprecation notice. */
function hasDisabledOnlySignal(candidate: CapabilityCandidate): boolean {
  return candidate.matchedIncompleteSignals.includes("disabled") && !candidate.matchedIncompleteSignals.includes("deprecated") && !candidate.matchedIncompleteSignals.includes("archived");
}

function deriveConfidence(candidate: CapabilityCandidate, aggregate: CapabilityEvidenceAggregate, status: CapabilityStatus): CapabilityConfidence {
  if (status === "unknown" || candidate.evidence.length === 0) return "unresolved";
  const confirmedCount = candidate.evidence.filter((e) => e.confidence === "confirmed").length;
  const hasStructural = aggregate.hasWorkflow || aggregate.hasRuntimeEntrypoint || aggregate.hasImplementation || aggregate.hasDeployment;
  if (confirmedCount >= 2 && hasStructural) return "confirmed";
  if (confirmedCount >= 1 && hasStructural) return "derived";
  if (candidate.evidence.some((e) => e.confidence === "suggested")) return "suggested";
  return "unresolved";
}

const RESULT = (inclusion: CapabilityInclusion, reasonCodes: CapabilityExclusionReasonCode[], reasonSummary: string, confidence: CapabilityConfidence): InclusionDecision => ({ inclusion, reasonCodes, reasonSummary, confidence });

/**
 * The final capability model is conservative by construction: every branch
 * below defaults toward exclude/qualify/roadmap/gap rather than toward
 * `include`. `include` is reachable only through the operational/implemented
 * branches with no blocking evidence problem.
 */
export function decideCapabilityInclusion(candidate: CapabilityCandidate, aggregate: CapabilityEvidenceAggregate, status: CapabilityStatus, readiness: CapabilityReadiness): InclusionDecision {
  const confidence = deriveConfidence(candidate, aggregate, status);
  // Same hard-gate condition maturity.ts uses to push its "no execution path"
  // blocker (implementation >= 40, execution === 0) — recomputed here from
  // the numeric scores rather than string-matching readiness.blockers, so it
  // stays generic and works regardless of blocker wording.
  const noExecutionPath = readiness.implementationScore >= 40 && readiness.executionScore === 0;

  if (candidate.gapStatement) {
    return RESULT("gap_only", [], "Repository evidence identifies this as a known, operationally meaningful absence rather than an implemented capability.", confidence);
  }

  if (aggregate.isContradictory) {
    return RESULT("exclude", ["UNRESOLVED_CONTRADICTORY_EVIDENCE"], "Confirmed implementation/execution evidence coexists with a deprecated- or disabled-looking marker; evidence is contradictory.", "unresolved");
  }

  switch (status) {
    case "deprecated":
      return hasDisabledOnlySignal(candidate)
        ? RESULT("exclude", ["DISABLED_CAPABILITY"], "The repository's own text explicitly flags this capability as disabled, distinct from a general deprecation notice.", confidence)
        : RESULT("exclude", ["DEPRECATED_CAPABILITY"], "Evidence indicates this capability is deprecated.", confidence);
    case "abandoned":
      return RESULT("exclude", ["ABANDONED_CAPABILITY"], "Evidence indicates this capability was started and abandoned, with no execution path.", confidence);
    case "unknown":
      return aggregate.isExampleOnly
        ? RESULT("exclude", ["EXAMPLE_ONLY"], "Only example evidence was found, with no documentation, implementation, execution, or test evidence.", "unresolved")
        : RESULT("exclude", ["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"], "No usable evidence was found for this candidate.", "unresolved");
    case "planned": {
      const roadmapSignal = Boolean(candidate.roadmapStatement) || candidate.matchedIncompleteSignals.some((s) => ["planned", "future", "coming soon"].includes(s));
      if (roadmapSignal) {
        return RESULT("roadmap_only", ["PLANNED_NOT_IMPLEMENTED"], "The repository identifies this as planned/future work with no sufficient implementation today.", confidence);
      }
      return aggregate.isExampleOnly
        ? RESULT("exclude", ["EXAMPLE_ONLY"], "Only example evidence was found, with no implementation, execution, or test evidence, and no stated roadmap intent.", confidence)
        : RESULT("exclude", ["DOCUMENTATION_ONLY"], "Only documentation evidence was found, with no implementation, execution, or test evidence.", confidence);
    }
    case "scaffolded":
      return noExecutionPath
        ? RESULT("exclude", ["NO_EXECUTION_PATH"], "Real implementation evidence exists, but no execution path (runtime entrypoint, workflow, or deployment) was found; this is not a bare scaffold.", confidence)
        : RESULT("exclude", ["SCAFFOLD_ONLY"], "Evidence shows a package/interface scaffold with no meaningful implementation behind it.", confidence);
    case "experimental":
      return noExecutionPath
        ? RESULT("exclude", ["NO_EXECUTION_PATH"], "Real implementation evidence exists, but no execution path (runtime entrypoint, workflow, or deployment) was found.", confidence)
        : RESULT("exclude", ["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"], "Evidence is too thin across implementation, execution, and verification to include as a current capability.", confidence);
    case "partial": {
      if (aggregate.hasTest && !aggregate.hasImplementation && !aggregate.hasWorkflow && !aggregate.hasRuntimeEntrypoint) {
        return RESULT("exclude", ["TEST_ONLY"], "Test evidence exists with no corresponding implementation, workflow, or runtime entrypoint.", confidence);
      }
      if (readiness.implementationScore === 0) {
        const hasStructuralImplementationEvidence = aggregate.hasImplementation || aggregate.hasConfiguration || aggregate.hasWorkflow || aggregate.hasRuntimeEntrypoint;
        if (hasStructuralImplementationEvidence && hasPlaceholderSignal(candidate)) {
          return RESULT(
            "exclude",
            ["PLACEHOLDER_IMPLEMENTATION"],
            "Implementation-shaped evidence exists but is flagged by placeholder/stub-style signals (e.g. mock, prototype, draft, stub, placeholder); this does not meet the bar for a real implementation.",
            confidence,
          );
        }
        return RESULT("exclude", ["INSUFFICIENT_IMPLEMENTATION_EVIDENCE"], "No implementation evidence was found.", confidence);
      }
      if (noExecutionPath) {
        return RESULT(
          "include_with_qualification",
          ["NO_EXECUTION_PATH"],
          "Real implementation evidence exists, but no execution path (runtime entrypoint, workflow, or deployment) was found; at best this is available with limitations.",
          confidence,
        );
      }
      return RESULT("include_with_qualification", [], "Provides meaningful value today, but execution, verification, or operational maturity work remains.", confidence);
    }
    case "implemented":
    case "operational": {
      if (readiness.blockers.length > 0) {
        const reasonCodes: CapabilityExclusionReasonCode[] = readiness.executionScore === 0 ? ["NO_EXECUTION_PATH"] : [];
        return RESULT("include_with_qualification", reasonCodes, readiness.blockers.join(" "), confidence);
      }
      if (candidate.isExternalRuntimeDependent && readiness.adoptionScore === 0) {
        return RESULT("include_with_qualification", ["EXTERNAL_RUNTIME_REQUIRED"], "Implementation is complete, but this capability depends on an external runtime/platform this repository does not control and no adoption evidence is available.", confidence);
      }
      return RESULT("include", [], "Meets the evidence and maturity bar for inclusion as a current capability.", confidence);
    }
    default: {
      const exhaustive: never = status;
      throw new Error(`Unhandled capability status: ${JSON.stringify(exhaustive)}`);
    }
  }
}
