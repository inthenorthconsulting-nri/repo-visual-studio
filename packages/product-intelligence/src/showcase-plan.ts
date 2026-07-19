import type { CapabilityModel } from "@rvs/capability-intelligence";
import type {
  AudienceType,
  ExecutiveNarrative,
  ProductClaim,
  ProductIdentity,
  ShowcaseDensity,
  ShowcaseEvidenceMode,
  ShowcaseEvidenceSummary,
  ShowcaseGenerationMetadata,
  ShowcaseMetric,
  ShowcasePlan,
  ShowcaseScenePlan,
  ShowcaseSceneType,
  ShowcaseVisualMetaphor,
} from "./contracts.js";
import { showcaseMetricId, showcaseSceneId } from "./ids.js";
import { truncateToWords, wordCount } from "./label.js";

export const SHOWCASE_MIN_SCENES = 7;
export const SHOWCASE_MAX_SCENES = 10;
export const SHOWCASE_HEADLINE_PREFERRED_MAX_WORDS = 12;
export const SHOWCASE_HEADLINE_HARD_MAX_WORDS = 14;

/** §12: the required default sequence. Optional scenes are inserted only when the evidence justifies them (never to hit a scene-count target). */
const DEFAULT_SEQUENCE: ShowcaseSceneType[] = [
  "showcase-hero",
  "showcase-problem",
  "showcase-identity",
  "showcase-operating-model",
  "showcase-value-pillars",
  "showcase-capabilities",
  "showcase-differentiators",
  "showcase-closing",
];

const VISUAL_METAPHOR_BY_TYPE: Record<ShowcaseSceneType, ShowcaseVisualMetaphor> = {
  "showcase-hero": "hero",
  "showcase-problem": "causal-flow",
  "showcase-identity": "hero",
  "showcase-operating-model": "layered-architecture",
  "showcase-value-pillars": "pillar-grid",
  "showcase-capabilities": "capability-map",
  "showcase-differentiators": "constellation",
  "showcase-proof": "proof-cards",
  "showcase-limitations": "capability-map",
  "showcase-closing": "north-star",
  "portfolio-overview": "capability-map",
};

const NARRATIVE_ROLE_BY_TYPE: Record<ShowcaseSceneType, string> = {
  "showcase-hero": "context",
  "showcase-problem": "problem",
  "showcase-identity": "product-identity",
  "showcase-operating-model": "how-it-works",
  "showcase-value-pillars": "value-pillars",
  "showcase-capabilities": "proof",
  "showcase-differentiators": "distinctive-strengths",
  "showcase-proof": "proof",
  "showcase-limitations": "distinctive-strengths",
  "showcase-closing": "closing",
  "portfolio-overview": "context",
};

function headline(text: string): string {
  return truncateToWords(text, SHOWCASE_HEADLINE_HARD_MAX_WORDS);
}

function approvedClaimIdsFor(claims: ProductClaim[], claimType: ProductClaim["claimType"]): string[] {
  return claims
    .filter((c) => c.claimType === claimType && (c.status === "approved" || c.status === "approved_with_qualification"))
    .map((c) => c.id)
    .sort((a, b) => a.localeCompare(b));
}

function buildScene(
  type: ShowcaseSceneType,
  index: number,
  headlineText: string,
  subheadline: string | undefined,
  capabilityIds: string[],
  claimIds: string[],
  evidenceIds: string[],
  qualifiers: string[],
  density: ShowcaseDensity = "low",
): ShowcaseScenePlan {
  return {
    id: showcaseSceneId(type, index),
    type,
    headline: headline(headlineText),
    subheadline: subheadline ? truncateToWords(subheadline, 18) : undefined,
    narrativeRole: NARRATIVE_ROLE_BY_TYPE[type],
    density,
    visualMetaphor: VISUAL_METAPHOR_BY_TYPE[type],
    capabilityIds: [...capabilityIds].sort((a, b) => a.localeCompare(b)),
    claimIds: [...claimIds].sort((a, b) => a.localeCompare(b)),
    evidenceIds: [...new Set(evidenceIds)].sort((a, b) => a.localeCompare(b)),
    qualifiers,
  };
}

/**
 * §12/§13: builds the showcase scene sequence. Optional scenes (proof,
 * limitations) are included only when the evidence backing them clears a
 * minimum bar — an empty/weak scene is never inserted just to hit the
 * scene-count band.
 */
function selectSceneTypes(identity: ProductIdentity, narrative: ExecutiveNarrative): ShowcaseSceneType[] {
  const sequence: ShowcaseSceneType[] = [];
  for (const type of DEFAULT_SEQUENCE) {
    if (type === "showcase-differentiators" && identity.differentiators.length === 0) continue;
    sequence.push(type);
    if (type === "showcase-capabilities") {
      const strongProof = narrative.proofPoints.filter((p) => p.status === "confirmed" || p.status === "derived");
      if (strongProof.length >= 3) sequence.push("showcase-proof");
    }
    if (type === "showcase-differentiators" && narrative.limitations.length > 0) {
      sequence.push("showcase-limitations");
    }
  }
  return sequence.slice(0, SHOWCASE_MAX_SCENES);
}

function buildScenesForTypes(types: ShowcaseSceneType[], identity: ProductIdentity, narrative: ExecutiveNarrative, model: CapabilityModel, claims: ProductClaim[]): ShowcaseScenePlan[] {
  return types.map((type, index) => {
    switch (type) {
      case "showcase-hero":
        return buildScene(type, index, identity.shortPromise, identity.descriptor, [], approvedClaimIdsFor(claims, "identity"), identity.evidence.slice(0, 3).map((e) => e.id), []);
      case "showcase-problem":
        return buildScene(type, index, narrative.problemStatement, undefined, [], approvedClaimIdsFor(claims, "purpose"), [], []);
      case "showcase-identity":
        return buildScene(type, index, `${identity.displayName} is a ${identity.descriptor}`, identity.purpose, [], approvedClaimIdsFor(claims, "identity"), identity.evidence.slice(0, 5).map((e) => e.id), []);
      case "showcase-operating-model": {
        const pillarTitles = identity.valuePillars.map((p) => p.title).slice(0, 3);
        return buildScene(type, index, `How it works: ${pillarTitles.join(", ")}`, undefined, [], approvedClaimIdsFor(claims, "outcome"), identity.valuePillars.flatMap((p) => p.evidenceIds), []);
      }
      case "showcase-value-pillars": {
        const evidenceIds = identity.valuePillars.flatMap((p) => p.evidenceIds);
        const qualifiers = identity.valuePillars.filter((p) => p.qualification).map((p) => p.qualification!);
        return buildScene(type, index, `Value delivered across ${identity.valuePillars.length} pillars`, undefined, [...identity.currentCapabilities, ...identity.qualifiedCapabilities], approvedClaimIdsFor(claims, "outcome"), evidenceIds, qualifiers);
      }
      case "showcase-capabilities": {
        const qualifiedCount = identity.qualifiedCapabilities.length;
        const headlineText =
          qualifiedCount > 0
            ? `${identity.currentCapabilities.length} evidence-backed capabilities, ${qualifiedCount} qualified`
            : `${identity.currentCapabilities.length} evidence-backed capabilities in current use`;
        return buildScene(
          type,
          index,
          headlineText,
          undefined,
          [...identity.currentCapabilities, ...identity.qualifiedCapabilities],
          approvedClaimIdsFor(claims, "capability"),
          model.includedCapabilities.flatMap((c) => c.evidence.map((e) => e.id)).slice(0, 20),
          qualifiedCount > 0 ? [`${qualifiedCount} capabilities carry an evidence qualifier and are marked accordingly.`] : [],
        );
      }
      case "showcase-differentiators":
        return buildScene(
          type,
          index,
          identity.differentiators[0]?.title ?? "What makes this different",
          undefined,
          identity.differentiators.flatMap((d) => d.supportingCapabilityIds),
          approvedClaimIdsFor(claims, "differentiator"),
          identity.differentiators.flatMap((d) => d.evidenceIds),
          [],
        );
      case "showcase-proof": {
        const strongProof = narrative.proofPoints.filter((p) => p.status === "confirmed" || p.status === "derived").slice(0, 4);
        return buildScene(type, index, "Proof points confirmed by evidence", undefined, [], approvedClaimIdsFor(claims, "maturity"), strongProof.flatMap((p) => p.evidenceIds), []);
      }
      case "showcase-limitations":
        return buildScene(type, index, "Known limitations and qualifications", undefined, identity.qualifiedCapabilities, [], [], narrative.limitations.slice(0, 6));
      case "showcase-closing":
        return buildScene(type, index, narrative.centralMessage, undefined, [], [], [], []);
      case "portfolio-overview":
        return buildScene(type, index, "Portfolio context", undefined, [], [], [], []);
    }
  });
}

function buildMetrics(narrative: ExecutiveNarrative): ShowcaseMetric[] {
  const eligible = narrative.proofPoints.filter((p) => p.status === "confirmed" || p.status === "derived");
  return eligible.slice(0, 4).map((p, index) => ({
    id: showcaseMetricId(p.id),
    label: p.label,
    value: p.value,
    status: p.status,
    evidenceIds: p.evidenceIds,
    audiencePriority: index,
  }));
}

function buildEvidenceSummary(model: CapabilityModel, claims: ProductClaim[]): ShowcaseEvidenceSummary {
  return {
    totalEvidence: model.evidenceSummary.confidence.total,
    confirmedCount: model.evidenceSummary.confidence.confirmed,
    derivedCount: model.evidenceSummary.confidence.derived,
    runtimeUnverifiedCount: claims.filter((c) => c.status === "runtime_verification_required").length,
    approvedClaimCount: claims.filter((c) => c.status === "approved").length,
    qualifiedClaimCount: claims.filter((c) => c.status === "approved_with_qualification").length,
    rejectedClaimCount: claims.filter((c) => c.status === "rejected").length,
    runtimeVerificationClaimCount: claims.filter((c) => c.status === "runtime_verification_required").length,
  };
}

export interface BuildShowcasePlanOptions {
  audience: AudienceType;
  theme: string;
  evidenceMode: ShowcaseEvidenceMode;
  gitCommit: string;
  generatedAt: string;
}

export function buildShowcasePlan(identity: ProductIdentity, narrative: ExecutiveNarrative, model: CapabilityModel, claims: ProductClaim[], options: BuildShowcasePlanOptions): ShowcasePlan {
  const sceneTypes = selectSceneTypes(identity, narrative);
  const scenes = buildScenesForTypes(sceneTypes, identity, narrative, model, claims);
  const metrics = buildMetrics(narrative);

  const generationMetadata: ShowcaseGenerationMetadata = {
    generated_at: options.generatedAt,
    git_commit: options.gitCommit,
    schema_version: 1,
    source_product_identity_generated_at: options.generatedAt,
    assist_used: false,
    audience: options.audience,
    theme: options.theme,
    evidenceMode: options.evidenceMode,
    sceneCount: scenes.length,
  };

  return {
    schemaVersion: 1,
    identity,
    narrative,
    scenes,
    metrics,
    evidenceSummary: buildEvidenceSummary(model, claims),
    generationMetadata,
  };
}

export function headlineWordCount(text: string): number {
  return wordCount(text);
}
