import type { AudienceType, ExecutiveNarrative, ProductClaim, ProductIdentity, ProductProofPoint, ShowcaseMetricStatus } from "./contracts.js";
import { proofPointId } from "./ids.js";
import { truncateToWords } from "./label.js";

const CENTRAL_MESSAGE_MAX_WORDS = 24;
const MAX_PROOF_POINTS = 6;

function claimStatusToMetricStatus(status: ProductClaim["status"]): ShowcaseMetricStatus {
  switch (status) {
    case "approved":
      return "confirmed";
    case "approved_with_qualification":
      return "derived";
    case "runtime_verification_required":
      return "runtime_unverified";
    case "rejected":
      return "rejected";
  }
}

/**
 * §11: Context -> Problem -> Product identity -> Value pillars -> How it
 * works -> Proof -> Distinctive strengths -> Closing. This function builds
 * the underlying content model that showcase-plan.ts later sequences into
 * scenes; it never invents a claim outside what claims.ts already approved,
 * qualified, or held for runtime verification.
 */
export function buildExecutiveNarrative(identity: ProductIdentity, claims: ProductClaim[], audience: AudienceType): ExecutiveNarrative {
  const approvedClaims = claims.filter((c) => c.status === "approved" || c.status === "approved_with_qualification");
  const rejectedClaims = claims.filter((c) => c.status === "rejected");
  const runtimeVerificationClaims = claims.filter((c) => c.status === "runtime_verification_required");

  const [problemStatement] = identity.purpose.split(" by providing ");

  const proofPoints: ProductProofPoint[] = approvedClaims
    .filter((c) => c.claimType === "maturity" || c.claimType === "outcome" || c.claimType === "differentiator")
    .slice(0, MAX_PROOF_POINTS)
    .map((c) => ({
      id: proofPointId(c.id),
      label: c.claimType,
      value: c.text,
      status: claimStatusToMetricStatus(c.status),
      evidenceIds: c.evidenceIds,
    }));

  const limitations = [...identity.limitations];
  for (const claim of approvedClaims) {
    limitations.push(...claim.qualifiers);
  }

  return {
    audience,
    objective: `Give ${audience.replace(/_/g, " ")} stakeholders a concise, evidence-backed view of ${identity.displayName}.`,
    centralMessage: truncateToWords(identity.shortPromise, CENTRAL_MESSAGE_MAX_WORDS),
    problemStatement: problemStatement.trim(),
    productPromise: identity.shortPromise,
    valuePillars: identity.valuePillars,
    proofPoints,
    differentiators: identity.differentiators,
    limitations: [...new Set(limitations)].sort((a, b) => a.localeCompare(b)),
    closingMessage: `${identity.displayName} is presented here strictly by what is currently proven; qualified and roadmap items remain visibly marked rather than folded into the current-state story.`,
    approvedClaims: [...approvedClaims].sort((a, b) => a.id.localeCompare(b.id)),
    rejectedClaims: [...rejectedClaims].sort((a, b) => a.id.localeCompare(b.id)),
    runtimeVerificationClaims: [...runtimeVerificationClaims].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
