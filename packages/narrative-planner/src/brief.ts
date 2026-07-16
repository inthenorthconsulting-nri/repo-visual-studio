import type { EvidenceClaim, EvidenceManifest } from "@rvs/core";
import type { RepositoryModel } from "@rvs/repository-model";
import { getAudienceProfile, type AudienceProfile } from "./audience-profiles.js";

export interface NarrativeBriefSection {
  id: string;
  purpose: string;
  text: string;
  evidence_claim_ids: string[];
}

export interface NarrativeBrief {
  title: string;
  audience: AudienceProfile["id"];
  purpose: string;
  duration_minutes: number;
  decision_required: boolean;
  core_message: string;
  sections: NarrativeBriefSection[];
}

function claimsMatchingHeading(claims: EvidenceClaim[], headingPrefixes: string[]): EvidenceClaim[] {
  return claims.filter((c) =>
    headingPrefixes.some((prefix) => c.claim.toLowerCase().startsWith(prefix.toLowerCase())),
  );
}

function summarize(claims: EvidenceClaim[], fallback: string, max = 2): string {
  if (claims.length === 0) return fallback;
  return claims
    .slice(0, max)
    .map((c) => c.claim)
    .join(" ");
}

// Deterministic, template-based brief. This is NOT the creative narrative
// authoring step described in the blueprint's Skill layer (§9) — it is a
// reproducible default the CLI can always produce from evidence alone, that
// a human or an agent skill can subsequently refine.
export function buildNarrativeBrief(
  model: RepositoryModel,
  evidence: EvidenceManifest,
  audienceId: string,
): NarrativeBrief {
  const profile = getAudienceProfile(audienceId);
  const claims = evidence.claims;

  const architectureClaims = claimsMatchingHeading(claims, ["architecture", "target_state", "primary language"]);
  const statusClaims = claimsMatchingHeading(claims, [
    "deployment",
    "status",
    "continuous integration",
    "development activity",
  ]);
  const contextClaims = claims.filter((c) => !architectureClaims.includes(c) && !statusClaims.includes(c));

  const leadParagraph = model.markdown_documents[0]?.leadParagraph;
  const coreMessage =
    leadParagraph && leadParagraph.length > 0
      ? leadParagraph
      : `${model.project_name} is a ${model.tech_stack.primaryLanguage} project with ${model.files.total} tracked files.`;

  const sections: NarrativeBriefSection[] = profile.sections.map((sectionTemplate) => {
    switch (sectionTemplate.id) {
      case "context":
        return {
          ...sectionTemplate,
          text: summarize(contextClaims, coreMessage),
          evidence_claim_ids: contextClaims.slice(0, 2).map((c) => c.claim_id),
        };
      case "target_state":
      case "architecture":
        return {
          ...sectionTemplate,
          text: summarize(
            architectureClaims,
            `${model.project_name} uses ${model.tech_stack.primaryLanguage}.`,
          ),
          evidence_claim_ids: architectureClaims.map((c) => c.claim_id),
        };
      case "status": {
        const fallback = `${model.git.commitsLast90Days} commit(s) in the last 90 days across ${model.git.contributorCount} contributor(s).`;
        return {
          ...sectionTemplate,
          text: summarize(statusClaims, fallback, 3),
          evidence_claim_ids: statusClaims.map((c) => c.claim_id),
        };
      }
      case "decision":
        return {
          ...sectionTemplate,
          text: "Decision requested: [fill in the specific approval or go/no-go being asked of this audience]",
          evidence_claim_ids: [],
        };
      default:
        return { ...sectionTemplate, text: "", evidence_claim_ids: [] };
    }
  });

  return {
    title: model.project_name,
    audience: profile.id,
    purpose: profile.purpose,
    duration_minutes: profile.duration_minutes,
    decision_required: profile.decision_required,
    core_message: coreMessage,
    sections,
  };
}
