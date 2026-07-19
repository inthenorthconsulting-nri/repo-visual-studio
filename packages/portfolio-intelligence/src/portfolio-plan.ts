import type { AudienceType } from "@rvs/product-intelligence";
import { truncateToWords } from "@rvs/product-intelligence";
import type {
  PortfolioCapability,
  PortfolioClaim,
  PortfolioDecision,
  PortfolioDecisionOwnerType,
  PortfolioDecisionType,
  PortfolioDecisionUrgency,
  PortfolioEvidenceMode,
  PortfolioGap,
  PortfolioGapType,
  PortfolioModel,
  PortfolioNarrative,
  PortfolioOverlap,
  PortfolioPlan,
  PortfolioPlanGenerationMetadata,
  PortfolioProduct,
  PortfolioProductRelationship,
  PortfolioRelationshipConfidence,
  PortfolioScenePlan,
  PortfolioSceneType,
} from "./contracts.js";
import { detectReconciliationSignals, type PortfolioReconciliationSignal } from "./identity-reconciliation.js";
import { portfolioDecisionId, portfolioSceneId } from "./ids.js";
import { defaultDecisionOwnerType } from "./ownership.js";

// ---------------------------------------------------------------------------
// §20-27 Presentation planning: decision register + scene sequence
// ---------------------------------------------------------------------------

export const PORTFOLIO_PLAN_MIN_SCENES = 6;
export const PORTFOLIO_PLAN_MAX_SCENES = 13;
export const PORTFOLIO_HEADLINE_HARD_MAX_WORDS = 14;
const RELATIONSHIP_MAP_DENSE_THRESHOLD = 12;
const CAPABILITY_COVERAGE_MAX = 40;

const EVIDENCE_MODE_CAP: Record<PortfolioEvidenceMode, number> = {
  concise: 2,
  visible: 6,
  appendix: 12,
  audit: Number.POSITIVE_INFINITY,
};

function headline(text: string): string {
  return truncateToWords(text, PORTFOLIO_HEADLINE_HARD_MAX_WORDS);
}

function capEvidence(ids: string[], mode: PortfolioEvidenceMode): string[] {
  const unique = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  const cap = EVIDENCE_MODE_CAP[mode];
  return Number.isFinite(cap) ? unique.slice(0, cap) : unique;
}

function approvedClaimIdsFor(claims: PortfolioClaim[], claimType: PortfolioClaim["claimType"]): string[] {
  return claims
    .filter((c) => c.claimType === claimType && (c.status === "approved" || c.status === "approved_with_qualification"))
    .map((c) => c.id)
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// §25 Decision register
//
// Every decision traces to an already-computed structural signal — a gap
// (gaps.ts), an unresolved-ownership overlap (overlaps.ts), a product
// boundary ambiguity (identity-reconciliation.ts's reconciliation signals),
// or an unresolved cross-product relationship (product-relationships.ts).
// "deprecation" is the one PortfolioDecisionType this module never emits:
// distinguishing a genuinely deprecated capability from one that is simply
// less-used would require usage-trend or "superseded-by" evidence this
// milestone does not consume — reserved, not fabricated, the same
// disclosed-scope-trim pattern already used for 4/8 gap types.
// ---------------------------------------------------------------------------

function decisionOwnerType(affectedProductIds: string[], productsById: Map<string, PortfolioProduct>): PortfolioDecisionOwnerType {
  const roles = new Set(affectedProductIds.map((id) => productsById.get(id)?.primaryRole).filter((r): r is PortfolioProduct["primaryRole"] => Boolean(r)));
  if (roles.size === 1) return defaultDecisionOwnerType([...roles][0]!);
  return "architecture_council";
}

const GAP_TYPE_TO_DECISION_TYPE: Partial<Record<PortfolioGapType, PortfolioDecisionType>> = {
  qualified_only_coverage: "qualified_capability_investment",
  unowned_capability: "ownership",
  runtime_verification_gap: "runtime_verification",
  dependency_gap: "shared_contract",
};

function whyItMattersForGapType(type: PortfolioGapType): string {
  switch (type) {
    case "qualified_only_coverage":
      return "Capabilities with only qualified coverage carry a higher risk of silently regressing without a fully current implementation to anchor them.";
    case "unowned_capability":
      return "Capabilities without a clear owner risk divergent evolution and duplicated maintenance effort across products.";
    case "runtime_verification_gap":
      return "Capabilities confirmed only by static evidence have not been observed operating; a regression here would not be caught by current evidence.";
    case "dependency_gap":
      return "Undeclared shared dependencies between products can break silently when either product changes its integration surface.";
    default:
      return "This gap affects the portfolio's evidence-backed maturity.";
  }
}

function urgencyForGapType(type: PortfolioGapType): PortfolioDecisionUrgency {
  switch (type) {
    case "unowned_capability":
      return "high";
    case "dependency_gap":
    case "runtime_verification_gap":
      return "medium";
    default:
      return "low";
  }
}

function decisionsFromGaps(gaps: PortfolioGap[], capabilitiesById: Map<string, PortfolioCapability>, productsById: Map<string, PortfolioProduct>): PortfolioDecision[] {
  const decisions: PortfolioDecision[] = [];
  for (const gap of gaps) {
    const decisionType = GAP_TYPE_TO_DECISION_TYPE[gap.type];
    if (!decisionType) continue;
    const confidence: PortfolioRelationshipConfidence = (gap.capabilityId && capabilitiesById.get(gap.capabilityId)?.confidence) || "derived";
    decisions.push({
      id: portfolioDecisionId(decisionType, gap.id),
      type: decisionType,
      statement: gap.statement,
      whyItMatters: whyItMattersForGapType(gap.type),
      affectedProductIds: gap.affectedProductIds,
      evidenceIds: gap.evidenceIds,
      currentAmbiguity: gap.statement,
      recommendedOwnerType: decisionOwnerType(gap.affectedProductIds, productsById),
      urgency: urgencyForGapType(gap.type),
      confidence,
    });
  }
  return decisions;
}

function decisionsFromOverlaps(overlaps: PortfolioOverlap[], productsById: Map<string, PortfolioProduct>): PortfolioDecision[] {
  return overlaps
    .filter((o) => o.severity === "strategic")
    .map((o) => ({
      id: portfolioDecisionId("overlap_resolution", o.id),
      type: "overlap_resolution" as const,
      statement: `${o.productIds.length} products implement overlapping capability coverage with no resolved owner; determine whether these implementations are complementary or should be consolidated.`,
      whyItMatters: "Strategic-severity overlaps involve enough independent implementations that unresolved duplication carries material maintenance and consistency risk.",
      affectedProductIds: o.productIds,
      evidenceIds: o.evidenceIds,
      currentAmbiguity: o.statement,
      recommendedOwnerType: decisionOwnerType(o.productIds, productsById),
      urgency: "high" as const,
      confidence: "derived" as const,
    }));
}

function decisionsFromReconciliationSignals(signals: PortfolioReconciliationSignal[], productsById: Map<string, PortfolioProduct>): PortfolioDecision[] {
  return signals.map((s) => ({
    id: portfolioDecisionId("product_boundary", `${s.kind}:${s.productIds.join(",")}`),
    type: "product_boundary" as const,
    statement: s.message,
    whyItMatters: "Ambiguous product boundaries make ownership, roadmap, and capability-coverage claims harder to state precisely.",
    affectedProductIds: s.productIds,
    evidenceIds: [],
    currentAmbiguity: s.message,
    recommendedOwnerType: decisionOwnerType(s.productIds, productsById),
    urgency: "low" as const,
    confidence: "suggested" as const,
  }));
}

function decisionsFromUnresolvedRelationships(unresolved: PortfolioProductRelationship[], productsById: Map<string, PortfolioProduct>): PortfolioDecision[] {
  return unresolved.map((rel) => ({
    id: portfolioDecisionId("integration_priority", rel.id),
    type: "integration_priority" as const,
    statement: rel.statement,
    whyItMatters: "Behavioral overlap without a confirmed relationship type is a candidate for either a deliberate integration or an explicit decision that none is needed.",
    affectedProductIds: [rel.productAId, rel.productBId],
    evidenceIds: rel.evidenceIds,
    currentAmbiguity: rel.statement,
    recommendedOwnerType: decisionOwnerType([rel.productAId, rel.productBId], productsById),
    urgency: "low" as const,
    confidence: "unresolved" as const,
  }));
}

export function buildPortfolioDecisions(model: PortfolioModel): PortfolioDecision[] {
  const productsById = new Map(model.products.map((p) => [p.id, p]));
  const capabilitiesById = new Map(model.capabilities.map((c) => [c.id, c]));
  const signals = detectReconciliationSignals(model.products);

  const decisions: PortfolioDecision[] = [
    ...decisionsFromGaps(model.gaps, capabilitiesById, productsById),
    ...decisionsFromOverlaps(model.overlaps, productsById),
    ...decisionsFromReconciliationSignals(signals, productsById),
    ...decisionsFromUnresolvedRelationships(model.unresolvedRelationships, productsById),
  ];

  return decisions.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// §20-24, 26-27 Scene sequence
//
// Every optional scene is evidence-gated, never inserted to hit a
// scene-count target (mirrors showcase-plan.ts's own hard rule). The
// relationship map degrades to "low" density and a truncated edge list once
// evidence crosses RELATIONSHIP_MAP_DENSE_THRESHOLD, with a qualifier
// disclosing the truncation rather than silently dropping edges (§26).
// ---------------------------------------------------------------------------

const DEFAULT_SEQUENCE: PortfolioSceneType[] = [
  "portfolio-hero",
  "portfolio-mission",
  "portfolio-landscape",
  "portfolio-product-roles",
  "portfolio-operating-model",
  "portfolio-capability-coverage",
  "portfolio-relationship-map",
  "portfolio-dependency-map",
  "portfolio-shared-contracts",
  "portfolio-maturity",
  "portfolio-gaps",
  "portfolio-decisions",
  "portfolio-closing",
];

function selectSceneTypes(model: PortfolioModel, decisions: PortfolioDecision[]): PortfolioSceneType[] {
  const sequence: PortfolioSceneType[] = [];
  for (const type of DEFAULT_SEQUENCE) {
    switch (type) {
      case "portfolio-landscape":
        if (model.products.length < 2) continue;
        break;
      case "portfolio-operating-model":
        if (model.operatingModel.stages.length === 0) continue;
        break;
      case "portfolio-relationship-map":
        if (model.relationships.length === 0) continue;
        break;
      case "portfolio-dependency-map":
        if (model.dependencyGraph.edges.length === 0) continue;
        break;
      case "portfolio-shared-contracts":
        if (!model.relationships.some((r) => r.type === "shared_platform" || r.type === "shared_contract")) continue;
        break;
      case "portfolio-gaps":
        if (model.gaps.length === 0) continue;
        break;
      case "portfolio-decisions":
        if (decisions.length === 0) continue;
        break;
      default:
        break;
    }
    sequence.push(type);
  }
  return sequence.slice(0, PORTFOLIO_PLAN_MAX_SCENES);
}

interface SceneContentOptions {
  productIds?: string[];
  capabilityIds?: string[];
  relationshipIds?: string[];
  gapIds?: string[];
  claimIds?: string[];
  evidenceIds?: string[];
  qualifiers?: string[];
  density?: PortfolioScenePlan["density"];
}

function buildScene(type: PortfolioSceneType, index: number, headlineText: string, subheadline: string | undefined, evidenceMode: PortfolioEvidenceMode, opts: SceneContentOptions): PortfolioScenePlan {
  return {
    id: portfolioSceneId(type, index),
    type,
    headline: headline(headlineText),
    subheadline: subheadline ? truncateToWords(subheadline, 18) : undefined,
    density: opts.density ?? "low",
    productIds: [...new Set(opts.productIds ?? [])].sort((a, b) => a.localeCompare(b)),
    capabilityIds: [...new Set(opts.capabilityIds ?? [])].sort((a, b) => a.localeCompare(b)),
    relationshipIds: [...new Set(opts.relationshipIds ?? [])].sort((a, b) => a.localeCompare(b)),
    gapIds: [...new Set(opts.gapIds ?? [])].sort((a, b) => a.localeCompare(b)),
    claimIds: [...new Set(opts.claimIds ?? [])].sort((a, b) => a.localeCompare(b)),
    evidenceIds: capEvidence(opts.evidenceIds ?? [], evidenceMode),
    qualifiers: opts.qualifiers ?? [],
  };
}

function buildScenesForTypes(types: PortfolioSceneType[], model: PortfolioModel, narrative: PortfolioNarrative, claims: PortfolioClaim[], decisions: PortfolioDecision[], evidenceMode: PortfolioEvidenceMode): PortfolioScenePlan[] {
  return types.map((type, index) => {
    switch (type) {
      case "portfolio-hero":
        return buildScene(type, index, `${model.displayName}: ${model.products.length} products, ${model.capabilities.length} normalized capabilities`, narrative.mission, evidenceMode, {
          productIds: model.products.map((p) => p.id),
          claimIds: approvedClaimIdsFor(claims, "identity"),
        });
      case "portfolio-mission":
        return buildScene(type, index, narrative.mission, undefined, evidenceMode, { claimIds: approvedClaimIdsFor(claims, "identity") });
      case "portfolio-landscape":
        return buildScene(type, index, `${model.products.length} products across ${new Set(model.products.map((p) => p.primaryRole)).size} portfolio roles`, narrative.productsAndRoles, evidenceMode, {
          productIds: model.products.map((p) => p.id),
          claimIds: approvedClaimIdsFor(claims, "identity"),
        });
      case "portfolio-product-roles":
        return buildScene(type, index, "Product roles across the portfolio", narrative.productsAndRoles, evidenceMode, {
          productIds: model.products.map((p) => p.id),
          claimIds: approvedClaimIdsFor(claims, "identity"),
        });
      case "portfolio-operating-model": {
        const productIds = model.operatingModel.stages.flatMap((s) => s.productIds);
        return buildScene(type, index, `Operating model spans ${model.operatingModel.stages.length} stages`, narrative.sharedOperatingModel, evidenceMode, {
          productIds,
          capabilityIds: model.operatingModel.stages.flatMap((s) => s.capabilityIds),
          claimIds: approvedClaimIdsFor(claims, "operating_model"),
          qualifiers: ["Stage placement is inferred from product role and capability domain, not from observed pipeline or deployment order."],
        });
      }
      case "portfolio-capability-coverage": {
        const sortedIds = model.capabilities.map((c) => c.id).sort((a, b) => a.localeCompare(b));
        const truncated = sortedIds.length > CAPABILITY_COVERAGE_MAX;
        const sharedCount = model.capabilities.filter((c) => c.coverage === "shared" || c.coverage === "overlapping").length;
        return buildScene(type, index, `${model.capabilities.length} capabilities across the portfolio, ${sharedCount} shared`, narrative.capabilityCoverage, evidenceMode, {
          capabilityIds: sortedIds.slice(0, CAPABILITY_COVERAGE_MAX),
          claimIds: approvedClaimIdsFor(claims, "coverage"),
          evidenceIds: model.capabilities.flatMap((c) => c.evidenceIds),
          qualifiers: truncated ? [`Showing ${CAPABILITY_COVERAGE_MAX} of ${sortedIds.length} capabilities; remaining capabilities are available in the full export.`] : [],
        });
      }
      case "portfolio-relationship-map": {
        const dense = model.relationships.length > RELATIONSHIP_MAP_DENSE_THRESHOLD;
        const sorted = [...model.relationships].sort((a, b) => a.id.localeCompare(b.id));
        const included = dense ? sorted.slice(0, RELATIONSHIP_MAP_DENSE_THRESHOLD) : sorted;
        return buildScene(type, index, `${model.relationships.length} confirmed cross-product relationships`, narrative.productRelationships, evidenceMode, {
          productIds: included.flatMap((r) => [r.productAId, r.productBId]),
          relationshipIds: included.map((r) => r.id),
          claimIds: [...approvedClaimIdsFor(claims, "relationship"), ...approvedClaimIdsFor(claims, "integration"), ...approvedClaimIdsFor(claims, "unification")],
          evidenceIds: included.flatMap((r) => r.evidenceIds),
          density: dense ? "low" : "medium",
          qualifiers: dense ? [`Showing the ${RELATIONSHIP_MAP_DENSE_THRESHOLD} highest-priority relationships of ${model.relationships.length}; the full set is available in the evidence export.`] : [],
        });
      }
      case "portfolio-dependency-map": {
        const productIds = [...new Set(model.dependencyGraph.edges.map((e) => e.sourceProductId))];
        const nonProductNodeCount = model.dependencyGraph.nodes.filter((n) => n.kind !== "product").length;
        return buildScene(type, index, `${model.dependencyGraph.edges.length} dependency edges across ${nonProductNodeCount} shared nodes`, undefined, evidenceMode, {
          productIds,
          evidenceIds: model.dependencyGraph.edges.flatMap((e) => e.evidenceIds),
        });
      }
      case "portfolio-shared-contracts": {
        const shared = model.relationships.filter((r) => r.type === "shared_platform" || r.type === "shared_contract");
        return buildScene(type, index, `${shared.length} shared platform or contract relationships`, undefined, evidenceMode, {
          productIds: shared.flatMap((r) => [r.productAId, r.productBId]),
          relationshipIds: shared.map((r) => r.id),
          claimIds: approvedClaimIdsFor(claims, "integration"),
          evidenceIds: shared.flatMap((r) => r.evidenceIds),
        });
      }
      case "portfolio-maturity":
        return buildScene(type, index, "Portfolio maturity, by evidence dimension", narrative.proofAndMaturity, evidenceMode, {
          claimIds: approvedClaimIdsFor(claims, "maturity"),
          evidenceIds: claims.filter((c) => c.claimType === "maturity").flatMap((c) => c.evidenceIds),
        });
      case "portfolio-gaps":
        return buildScene(type, index, `${model.gaps.length} structural gaps identified`, narrative.gapsAndDecisions, evidenceMode, {
          gapIds: model.gaps.map((g) => g.id),
          productIds: model.gaps.flatMap((g) => g.affectedProductIds),
          capabilityIds: model.gaps.map((g) => g.capabilityId).filter((id): id is string => Boolean(id)),
          evidenceIds: model.gaps.flatMap((g) => g.evidenceIds),
        });
      case "portfolio-decisions":
        return buildScene(type, index, `${decisions.length} portfolio decisions for review`, narrative.strategicDirection, evidenceMode, {
          productIds: decisions.flatMap((d) => d.affectedProductIds),
          evidenceIds: decisions.flatMap((d) => d.evidenceIds),
        });
      case "portfolio-closing":
        return buildScene(type, index, narrative.strategicDirection, undefined, evidenceMode, {});
    }
  });
}

export interface BuildPortfolioPlanOptions {
  audience: AudienceType;
  theme: string;
  evidenceMode: PortfolioEvidenceMode;
  generatedAt: string;
}

export function buildPortfolioPlan(model: PortfolioModel, narrative: PortfolioNarrative, claims: PortfolioClaim[], options: BuildPortfolioPlanOptions): PortfolioPlan {
  const decisions = buildPortfolioDecisions(model);
  const sceneTypes = selectSceneTypes(model, decisions);
  const scenes = buildScenesForTypes(sceneTypes, model, narrative, claims, decisions, options.evidenceMode);

  const generationMetadata: PortfolioPlanGenerationMetadata = {
    generated_at: options.generatedAt,
    schema_version: 1,
    audience: options.audience,
    theme: options.theme,
    evidenceMode: options.evidenceMode,
    includeRoadmap: model.capabilities.some((c) => c.coverage === "roadmap_only"),
    sceneCount: scenes.length,
  };

  return {
    schemaVersion: 1,
    model,
    narrative,
    decisions,
    scenes,
    generationMetadata,
  };
}
