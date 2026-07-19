import type { PortfolioClaim, PortfolioModel, PortfolioPlan, PortfolioWarning } from "./contracts.js";
import { PORTFOLIO_HEADLINE_HARD_MAX_WORDS, PORTFOLIO_PLAN_MAX_SCENES, PORTFOLIO_PLAN_MIN_SCENES } from "./portfolio-plan.js";

// ---------------------------------------------------------------------------
// §30-31 Validation
//
// Three independent validators — validatePortfolioModel, validatePortfolioClaims,
// validatePortfolioPlan — mirroring @rvs/product-intelligence/src/validation.ts's
// own split (validateProductIdentityModel / validateShowcasePlan). Callers
// compose whichever subset applies (index.ts composes all three when
// synthesizing; `rvs validate --ci` re-validates a cached PortfolioPlan, which
// already carries its model and claims).
//
// Tier 1 codes (severity "error") block `rvs validate --ci`; everything else
// is Tier 2 ("warning", visible but non-blocking) — structural corruption,
// dangling references, and claim-control contradictions are always Tier 1;
// content-quality signals that could reflect genuinely weak evidence rather
// than a synthesis bug (too few scenes, thin relationship evidence) stay
// Tier 2, mirroring product-intelligence's SHOWCASE_TOO_FEW_SCENES precedent.
// ---------------------------------------------------------------------------

const GENERIC_HEADLINE_LABELS = new Set(["overview", "introduction", "summary", "portfolio", "products", "capabilities", "about", "welcome", "next steps"]);

const TIER1_ERROR_CODES = new Set([
  "PORTFOLIO_MODEL_MISSING_DISPLAY_NAME",
  "PORTFOLIO_MODEL_NO_PRODUCTS",
  "PORTFOLIO_MODEL_DUPLICATE_PRODUCT_ID",
  "PORTFOLIO_MODEL_DUPLICATE_CAPABILITY_ID",
  "PORTFOLIO_MODEL_CAPABILITY_EVIDENCE_MISSING",
  "PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH",
  "PORTFOLIO_MODEL_CAPABILITY_UNKNOWN_PARTICIPANT",
  "PORTFOLIO_MODEL_RELATIONSHIP_SELF_REFERENCE",
  "PORTFOLIO_MODEL_RELATIONSHIP_UNKNOWN_PRODUCT",
  "PORTFOLIO_MODEL_RELATIONSHIP_EVIDENCE_MISSING",
  "PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED",
  "PORTFOLIO_MODEL_DEPENDENCY_EDGE_UNKNOWN_ENDPOINT",
  "PORTFOLIO_MODEL_DEPENDENCY_NODE_DUPLICATE_ID",
  "PORTFOLIO_MODEL_OVERLAP_UNKNOWN_CAPABILITY",
  "PORTFOLIO_MODEL_OVERLAP_EVIDENCE_MISSING",
  "PORTFOLIO_MODEL_GAP_UNKNOWN_CAPABILITY",
  "PORTFOLIO_MODEL_GAP_EVIDENCE_MISSING",
  "PORTFOLIO_MODEL_OPERATING_MODEL_CONTRADICTION",
  "PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT",
  "PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE",
  "PORTFOLIO_MODEL_EVIDENCE_DUPLICATE_ID",
  "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER",
  "PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS",
  "PORTFOLIO_CLAIM_UNEXPECTED_REJECTION_REASONS",
  "PORTFOLIO_CLAIM_QUALIFICATION_MISSING_QUALIFIER",
  "PORTFOLIO_CLAIM_DUPLICATE_ID",
  "PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE",
  "PORTFOLIO_CLAIM_NONDETERMINISTIC_ORDER",
  "PORTFOLIO_PLAN_HEADLINE_TOO_LONG",
  "PORTFOLIO_PLAN_GENERIC_HEADLINE",
  "PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE",
  "PORTFOLIO_PLAN_DECISION_MISSING_STATEMENT",
  "PORTFOLIO_PLAN_DECISION_UNKNOWN_PRODUCT",
  "PORTFOLIO_PLAN_DECISION_DUPLICATE_ID",
  "PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER",
]);

function severityFor(code: string): "error" | "warning" {
  return TIER1_ERROR_CODES.has(code) ? "error" : "warning";
}

function warn(code: string, message: string, relatedId?: string, remediation?: string): PortfolioWarning {
  return { code, severity: severityFor(code), message, relatedId, remediation };
}

function checkSortedById<T extends { id: string }>(items: T[], code: string, label: string): PortfolioWarning | undefined {
  for (let i = 1; i < items.length; i++) {
    if (items[i - 1].id.localeCompare(items[i].id) > 0) {
      return warn(code, `${label} is not sorted deterministically by id (found "${items[i - 1].id}" before "${items[i].id}").`, items[i].id, "Sort this collection by id before returning it from synthesis.");
    }
  }
  return undefined;
}

function checkDuplicateIds<T extends { id: string }>(items: T[], code: string, label: string): PortfolioWarning[] {
  const seen = new Set<string>();
  const warnings: PortfolioWarning[] = [];
  for (const item of items) {
    if (seen.has(item.id)) warnings.push(warn(code, `${label} contains duplicate id "${item.id}".`, item.id));
    seen.add(item.id);
  }
  return warnings;
}

/** §31: validates a synthesized PortfolioModel structurally — never re-runs synthesis, only checks the output for the invariants §8-17 require. */
export function validatePortfolioModel(model: PortfolioModel): PortfolioWarning[] {
  const warnings: PortfolioWarning[] = [];

  if (!model.displayName.trim()) {
    warnings.push(warn("PORTFOLIO_MODEL_MISSING_DISPLAY_NAME", "Portfolio has no display name."));
  }
  if (model.products.length === 0) {
    warnings.push(warn("PORTFOLIO_MODEL_NO_PRODUCTS", "Portfolio model has zero products."));
  }

  warnings.push(...checkDuplicateIds(model.products, "PORTFOLIO_MODEL_DUPLICATE_PRODUCT_ID", "PortfolioModel.products"));
  warnings.push(...checkDuplicateIds(model.capabilities, "PORTFOLIO_MODEL_DUPLICATE_CAPABILITY_ID", "PortfolioModel.capabilities"));
  warnings.push(...checkDuplicateIds(model.evidence, "PORTFOLIO_MODEL_EVIDENCE_DUPLICATE_ID", "PortfolioModel.evidence"));
  warnings.push(...checkDuplicateIds(model.dependencyGraph.nodes, "PORTFOLIO_MODEL_DEPENDENCY_NODE_DUPLICATE_ID", "PortfolioModel.dependencyGraph.nodes"));

  const productIds = new Set(model.products.map((p) => p.id));
  const capabilityIds = new Set(model.capabilities.map((c) => c.id));
  const evidenceIds = new Set(model.evidence.map((e) => e.id));
  const nodeIds = new Set(model.dependencyGraph.nodes.map((n) => n.id));

  function checkEvidenceIds(ids: string[], relatedId: string) {
    for (const id of ids) {
      if (!evidenceIds.has(id)) {
        warnings.push(warn("PORTFOLIO_MODEL_EVIDENCE_DANGLING_REFERENCE", `"${relatedId}" cites evidence id "${id}" which does not exist in PortfolioModel.evidence.`, relatedId));
      }
    }
  }

  for (const capability of model.capabilities) {
    if (capability.evidenceIds.length === 0) {
      warnings.push(warn("PORTFOLIO_MODEL_CAPABILITY_EVIDENCE_MISSING", `Capability "${capability.id}" has no supporting evidence.`, capability.id));
    }
    checkEvidenceIds(capability.evidenceIds, capability.id);
    const expectEmpty = capability.coverage === "missing";
    if (expectEmpty && capability.participation.length > 0) {
      warnings.push(warn("PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH", `Capability "${capability.id}" is coverage "missing" but has ${capability.participation.length} participant(s).`, capability.id));
    }
    if (!expectEmpty && capability.participation.length === 0) {
      warnings.push(warn("PORTFOLIO_MODEL_CAPABILITY_COVERAGE_PARTICIPATION_MISMATCH", `Capability "${capability.id}" is coverage "${capability.coverage}" but has no participants.`, capability.id));
    }
    for (const participant of capability.participation) {
      if (!productIds.has(participant.productId)) {
        warnings.push(warn("PORTFOLIO_MODEL_CAPABILITY_UNKNOWN_PARTICIPANT", `Capability "${capability.id}" references unknown product "${participant.productId}".`, capability.id));
      }
    }
  }

  for (const relationship of [...model.relationships, ...model.unresolvedRelationships]) {
    if (relationship.productAId === relationship.productBId) {
      warnings.push(warn("PORTFOLIO_MODEL_RELATIONSHIP_SELF_REFERENCE", `Relationship "${relationship.id}" references the same product ("${relationship.productAId}") on both sides.`, relationship.id));
    }
    if (!productIds.has(relationship.productAId) || !productIds.has(relationship.productBId)) {
      warnings.push(warn("PORTFOLIO_MODEL_RELATIONSHIP_UNKNOWN_PRODUCT", `Relationship "${relationship.id}" references a product not present in PortfolioModel.products.`, relationship.id));
    }
    if (relationship.evidenceIds.length === 0) {
      warnings.push(warn("PORTFOLIO_MODEL_RELATIONSHIP_EVIDENCE_MISSING", `Relationship "${relationship.id}" has no supporting evidence.`, relationship.id));
    }
    checkEvidenceIds(relationship.evidenceIds, relationship.id);
  }
  for (const relationship of model.relationships) {
    if (relationship.type === "unresolved") {
      warnings.push(warn("PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED", `Relationship "${relationship.id}" has type "unresolved" but appears in PortfolioModel.relationships instead of unresolvedRelationships.`, relationship.id));
    }
  }
  for (const relationship of model.unresolvedRelationships) {
    if (relationship.type !== "unresolved") {
      warnings.push(warn("PORTFOLIO_MODEL_RELATIONSHIP_MISCLASSIFIED", `Relationship "${relationship.id}" has resolved type "${relationship.type}" but appears in PortfolioModel.unresolvedRelationships.`, relationship.id));
    }
  }

  for (const edge of model.dependencyGraph.edges) {
    if (!productIds.has(edge.sourceProductId) || !nodeIds.has(edge.targetId)) {
      warnings.push(warn("PORTFOLIO_MODEL_DEPENDENCY_EDGE_UNKNOWN_ENDPOINT", `Dependency edge "${edge.id}" references an unknown source product or target node.`, edge.id));
    }
    checkEvidenceIds(edge.evidenceIds, edge.id);
  }

  for (const overlap of model.overlaps) {
    if (!capabilityIds.has(overlap.capabilityId)) {
      warnings.push(warn("PORTFOLIO_MODEL_OVERLAP_UNKNOWN_CAPABILITY", `Overlap "${overlap.id}" references unknown capability "${overlap.capabilityId}".`, overlap.id));
    }
    if (overlap.evidenceIds.length === 0) {
      warnings.push(warn("PORTFOLIO_MODEL_OVERLAP_EVIDENCE_MISSING", `Overlap "${overlap.id}" has no supporting evidence.`, overlap.id));
    }
    checkEvidenceIds(overlap.evidenceIds, overlap.id);
  }

  for (const gap of model.gaps) {
    if (gap.capabilityId && !capabilityIds.has(gap.capabilityId)) {
      warnings.push(warn("PORTFOLIO_MODEL_GAP_UNKNOWN_CAPABILITY", `Gap "${gap.id}" references unknown capability "${gap.capabilityId}".`, gap.id));
    }
    if (gap.evidenceIds.length === 0) {
      warnings.push(warn("PORTFOLIO_MODEL_GAP_EVIDENCE_MISSING", `Gap "${gap.id}" has no supporting evidence.`, gap.id));
    }
    checkEvidenceIds(gap.evidenceIds, gap.id);
  }

  const unassigned = new Set(model.operatingModel.unassignedProductIds);
  for (const stage of model.operatingModel.stages) {
    for (const productId of stage.productIds) {
      if (!productIds.has(productId)) {
        warnings.push(warn("PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT", `Operating-model stage "${stage.stage}" references unknown product "${productId}".`, stage.stage));
      }
      if (unassigned.has(productId)) {
        warnings.push(warn("PORTFOLIO_MODEL_OPERATING_MODEL_CONTRADICTION", `Product "${productId}" is both assigned to stage "${stage.stage}" and listed as unassigned.`, productId));
      }
    }
  }
  for (const productId of model.operatingModel.unassignedProductIds) {
    if (!productIds.has(productId)) {
      warnings.push(warn("PORTFOLIO_MODEL_OPERATING_MODEL_UNKNOWN_PRODUCT", `Operating-model unassignedProductIds references unknown product "${productId}".`, productId));
    }
  }

  for (const [key, dimension] of Object.entries(model.maturity)) {
    const expectedScore = dimension.denominator === 0 ? 0 : dimension.numerator / dimension.denominator;
    if (Math.abs(dimension.score - expectedScore) > 1e-9) {
      warnings.push(warn("PORTFOLIO_MODEL_MATURITY_INCONSISTENT_SCORE", `Maturity dimension "${key}" score ${dimension.score} does not match numerator/denominator (${dimension.numerator}/${dimension.denominator}).`, key));
    }
  }

  const orderChecks = [
    checkSortedById(model.products, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.products"),
    checkSortedById(model.capabilities, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.capabilities"),
    checkSortedById(model.relationships, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.relationships"),
    checkSortedById(model.overlaps, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.overlaps"),
    checkSortedById(model.gaps, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.gaps"),
    checkSortedById(model.evidence, "PORTFOLIO_MODEL_NONDETERMINISTIC_ORDER", "PortfolioModel.evidence"),
  ];
  for (const check of orderChecks) if (check) warnings.push(check);

  return warnings;
}

/** §31: validates the claim-control invariants (§18) hold — every rejected claim carries reasons, every approved claim carries none, every qualification is accompanied by qualifier text, and every cited evidence id resolves. */
export function validatePortfolioClaims(claims: PortfolioClaim[], model: PortfolioModel): PortfolioWarning[] {
  const warnings: PortfolioWarning[] = [];
  const evidenceIds = new Set(model.evidence.map((e) => e.id));

  warnings.push(...checkDuplicateIds(claims, "PORTFOLIO_CLAIM_DUPLICATE_ID", "claims"));

  for (const claim of claims) {
    if (claim.status === "rejected" && claim.rejectionReasons.length === 0) {
      warnings.push(warn("PORTFOLIO_CLAIM_MISSING_REJECTION_REASONS", `Claim "${claim.id}" is rejected but records no rejection reason codes.`, claim.id));
    }
    if (claim.status !== "rejected" && claim.rejectionReasons.length > 0) {
      warnings.push(warn("PORTFOLIO_CLAIM_UNEXPECTED_REJECTION_REASONS", `Claim "${claim.id}" has status "${claim.status}" but records rejection reason codes.`, claim.id));
    }
    if (claim.status === "approved_with_qualification" && claim.qualifiers.length === 0) {
      warnings.push(warn("PORTFOLIO_CLAIM_QUALIFICATION_MISSING_QUALIFIER", `Claim "${claim.id}" is approved_with_qualification but has no qualifier text.`, claim.id));
    }
    for (const id of claim.evidenceIds) {
      if (!evidenceIds.has(id)) {
        warnings.push(warn("PORTFOLIO_CLAIM_EVIDENCE_DANGLING_REFERENCE", `Claim "${claim.id}" cites evidence id "${id}" which does not exist in PortfolioModel.evidence.`, claim.id));
      }
    }
  }

  const orderCheck = checkSortedById(claims, "PORTFOLIO_CLAIM_NONDETERMINISTIC_ORDER", "claims");
  if (orderCheck) warnings.push(orderCheck);

  return warnings;
}

/** §31: validates a synthesized PortfolioPlan structurally, including headline, dangling-pointer, and decision invariants (§20-27). Does not re-validate `plan.model`; compose with validatePortfolioModel separately. */
export function validatePortfolioPlan(plan: PortfolioPlan): PortfolioWarning[] {
  const warnings: PortfolioWarning[] = [];

  if (plan.scenes.length < PORTFOLIO_PLAN_MIN_SCENES) {
    warnings.push(warn("PORTFOLIO_PLAN_TOO_FEW_SCENES", `Portfolio plan has ${plan.scenes.length} scenes, below the ${PORTFOLIO_PLAN_MIN_SCENES}-scene minimum.`, undefined, "This may reflect genuinely weak evidence rather than a bug — do not pad with unsupported scenes."));
  }
  if (plan.scenes.length > PORTFOLIO_PLAN_MAX_SCENES) {
    warnings.push(warn("PORTFOLIO_PLAN_TOO_MANY_SCENES", `Portfolio plan has ${plan.scenes.length} scenes, above the ${PORTFOLIO_PLAN_MAX_SCENES}-scene maximum.`));
  }

  const productIds = new Set(plan.model.products.map((p) => p.id));
  const capabilityIds = new Set(plan.model.capabilities.map((c) => c.id));
  const relationshipIds = new Set([...plan.model.relationships, ...plan.model.unresolvedRelationships].map((r) => r.id));
  const gapIds = new Set(plan.model.gaps.map((g) => g.id));
  const decisionIds = new Set(plan.decisions.map((d) => d.id));
  const claimIds = new Set([...plan.narrative.approvedClaims, ...plan.narrative.rejectedClaims, ...plan.narrative.runtimeVerificationClaims].map((c) => c.id));
  const evidenceIds = new Set(plan.model.evidence.map((e) => e.id));

  for (const scene of plan.scenes) {
    const headlineWordCount = scene.headline.trim().split(/\s+/).filter(Boolean).length;
    if (headlineWordCount > PORTFOLIO_HEADLINE_HARD_MAX_WORDS) {
      warnings.push(warn("PORTFOLIO_PLAN_HEADLINE_TOO_LONG", `Scene "${scene.id}" headline is ${headlineWordCount} words, above the ${PORTFOLIO_HEADLINE_HARD_MAX_WORDS}-word maximum.`, scene.id));
    }
    if (GENERIC_HEADLINE_LABELS.has(scene.headline.trim().toLowerCase())) {
      warnings.push(warn("PORTFOLIO_PLAN_GENERIC_HEADLINE", `Scene "${scene.id}" headline "${scene.headline}" is a generic slide label rather than a conclusion.`, scene.id));
    }

    const dangling = [
      ...scene.productIds.filter((id) => !productIds.has(id)),
      ...scene.capabilityIds.filter((id) => !capabilityIds.has(id)),
      ...scene.relationshipIds.filter((id) => !relationshipIds.has(id)),
      ...scene.gapIds.filter((id) => !gapIds.has(id)),
      ...scene.decisionIds.filter((id) => !decisionIds.has(id)),
      ...scene.claimIds.filter((id) => !claimIds.has(id)),
      ...scene.evidenceIds.filter((id) => !evidenceIds.has(id)),
    ];
    if (dangling.length > 0) {
      warnings.push(warn("PORTFOLIO_PLAN_SCENE_DANGLING_REFERENCE", `Scene "${scene.id}" references ${dangling.length} id(s) not present in the plan's model or narrative claims: ${dangling.join(", ")}.`, scene.id));
    }
  }

  warnings.push(...checkDuplicateIds(plan.decisions, "PORTFOLIO_PLAN_DECISION_DUPLICATE_ID", "plan.decisions"));
  for (const decision of plan.decisions) {
    if (!decision.statement.trim()) {
      warnings.push(warn("PORTFOLIO_PLAN_DECISION_MISSING_STATEMENT", `Decision "${decision.id}" has no statement.`, decision.id));
    }
    for (const productId of decision.affectedProductIds) {
      if (!productIds.has(productId)) {
        warnings.push(warn("PORTFOLIO_PLAN_DECISION_UNKNOWN_PRODUCT", `Decision "${decision.id}" references unknown product "${productId}".`, decision.id));
      }
    }
  }

  // Scenes are intentionally NOT checked for id-sorted order: their sequence is
  // presentation order (DEFAULT_SEQUENCE in portfolio-plan.ts), which is itself
  // a deterministic function of model evidence — mirroring
  // @rvs/product-intelligence/src/validation.ts, which likewise never checks
  // showcase scene order by id.
  const decisionOrderCheck = checkSortedById(plan.decisions, "PORTFOLIO_PLAN_NONDETERMINISTIC_ORDER", "plan.decisions");
  if (decisionOrderCheck) warnings.push(decisionOrderCheck);

  return warnings;
}
