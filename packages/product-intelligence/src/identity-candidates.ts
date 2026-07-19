import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductArchetype, ProductArchetypeScore, ProductIdentityCandidate, ProductIdentityEvidence } from "./contracts.js";
import { productCandidateId } from "./ids.js";
import { truncateToWords } from "./label.js";

/**
 * §5 generic archetype descriptor templates — a structural vocabulary
 * parameterized only by the evidence-classified archetype, never a
 * repository-specific product name or phrase. Each is 3-9 words.
 */
export const ARCHETYPE_DESCRIPTOR_TEMPLATES: Record<ProductArchetype, string> = {
  governance_platform: "Governance and compliance platform",
  operations_platform: "Operations management platform",
  reliability_platform: "Reliability and health platform",
  developer_tool: "Developer productivity tool",
  automation_platform: "Workflow automation platform",
  migration_platform: "Migration and modernization platform",
  observability_platform: "Observability and monitoring platform",
  control_plane: "Infrastructure control plane",
  integration_platform: "Systems integration platform",
  data_product: "Data analytics product",
  library: "Reusable software library",
  framework: "Extensible software framework",
  unknown: "Software platform",
};

export function descriptorForArchetype(archetype: ProductArchetype): string {
  return ARCHETYPE_DESCRIPTOR_TEMPLATES[archetype];
}

/** §5: short promise <=18 words, derived from (never replacing) the synthesized purpose sentence. */
export function shortPromiseFromPurpose(purpose: string): string {
  const firstClause = purpose.split(/[.;]/)[0] ?? purpose;
  return truncateToWords(firstClause, 18);
}

/**
 * §3/§4: one candidate per archetype that received any evidence signal,
 * ordered deterministically (score desc, archetype id asc). Candidates are
 * the pre-ranking hypothesis set — pillars/differentiators are only computed
 * for the archetype ranking.ts ultimately selects, since they depend on how
 * the winning archetype groups the capability model.
 */
export function buildIdentityCandidates(
  archetypeScores: ProductArchetypeScore[],
  model: CapabilityModel,
  arch: ArchitectureIntelligence,
  evidence: ProductIdentityEvidence[],
  primaryUsers: string[],
): ProductIdentityCandidate[] {
  const candidates = archetypeScores
    .filter((s) => s.score > 0)
    .map((s) => {
      const descriptor = descriptorForArchetype(s.archetype);
      const matchedEvidence = evidence.filter((e) => (e.sourceId ? s.matchedCapabilityIds.includes(e.sourceId) : false));
      const confidence = s.includedSignalCount >= 2 ? "confirmed" : s.includedSignalCount >= 1 || s.qualifiedSignalCount >= 2 ? "derived" : "suggested";
      const candidate: ProductIdentityCandidate = {
        id: productCandidateId(s.archetype),
        displayName: arch.identity.name.displayLabel,
        archetype: s.archetype,
        purpose: descriptor,
        primaryUsers,
        valuePillars: [],
        differentiators: [],
        evidence: matchedEvidence,
        confidence,
        score: s.score,
      };
      return candidate;
    });

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return candidates;
}
