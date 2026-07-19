import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityModel, ProductIdentityOverride, ProductIntelWarning, ShowcasePlan } from "./contracts.js";
import { compareIdentityCandidates } from "./identity-candidates.js";
import { containsAbsoluteSuperiorityTerm, containsGenericMarketingTerm, findUnsupportedEnterpriseTerm, findUnsupportedQualifiedMaturityTerm, wordCount } from "./label.js";
import { SHOWCASE_HEADLINE_HARD_MAX_WORDS, SHOWCASE_MAX_SCENES, SHOWCASE_MIN_SCENES } from "./showcase-plan.js";

const GENERIC_HEADLINE_LABELS = new Set(["overview", "introduction", "summary", "capabilities", "features", "about", "welcome", "next steps"]);
const SCENE_TOTAL_WORD_BUDGET = 30;
// §28 SHOWCASE_SCENE_TOO_DENSE: generic content-volume ceilings per declared
// density, independent of any repository's actual capability count.
const SCENE_ITEM_DENSITY_BUDGET: Record<"low" | "medium", number> = { low: 15, medium: 25 };

// §28: Tier 1 codes block `rvs validate --ci`; everything else is Tier 2
// (visible, non-blocking) — mirrors capability-intelligence's severity split.
const TIER1_ERROR_CODES = new Set([
  "PRODUCT_IDENTITY_GENERIC_MARKETING",
  "PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM",
  "PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM",
  "PRODUCT_IDENTITY_OVERRIDE_CONFLICT",
  "SHOWCASE_MISSING_CENTRAL_MESSAGE",
  "SHOWCASE_GENERIC_HEADLINE",
  "SHOWCASE_HEADLINE_TOO_LONG",
  "SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM",
  "SHOWCASE_HEADLINE_ROADMAP_PROMOTED",
  "SHOWCASE_ROADMAP_PROMOTED",
  "SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED",
  "SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED",
  "SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY",
  "SHOWCASE_NONDETERMINISTIC_ORDER",
]);

function severityFor(code: string): "error" | "warning" {
  return TIER1_ERROR_CODES.has(code) ? "error" : "warning";
}

function warn(code: ProductIntelWarning["code"], message: string, relatedId?: string, remediation?: string): ProductIntelWarning {
  return { code, severity: severityFor(code), message, relatedId, remediation };
}

/**
 * `ProductIdentityModel.candidates` is ordered by score descending with id
 * ascending as the tie-break (see `compareIdentityCandidates()` in
 * `identity-candidates.ts`, the single source of truth for this order) — not
 * a plain ascending-id sort. Checking against any other invariant here would
 * make this fire on every run where two candidates have different scores,
 * which is the deterministic common case, not an instability.
 */
function checkCandidatesOrder(candidates: ProductIdentityModel["candidates"]): ProductIntelWarning | undefined {
  for (let i = 1; i < candidates.length; i++) {
    if (compareIdentityCandidates(candidates[i - 1], candidates[i]) > 0) {
      return warn(
        "SHOWCASE_NONDETERMINISTIC_ORDER",
        `ProductIdentityModel.candidates is not sorted deterministically (found "${candidates[i - 1].id}" (score ${candidates[i - 1].score}) before "${candidates[i].id}" (score ${candidates[i].score}), which violates the score-descending/id-ascending order).`,
        candidates[i].id,
        "Sort this collection with compareIdentityCandidates() (score descending, id ascending tie-break) before returning it from synthesis.",
      );
    }
  }
  return undefined;
}

/** §28: validates a synthesized ProductIdentityModel structurally — never re-runs synthesis, only checks the output for the invariants the spec requires. `override` is optional and only enables the PRODUCT_IDENTITY_OVERRIDE_CONFLICT check. */
export function validateProductIdentityModel(model: ProductIdentityModel, capModel: CapabilityModel, override?: ProductIdentityOverride): ProductIntelWarning[] {
  const warnings: ProductIntelWarning[] = [];
  const { identity } = model;

  if (!identity.displayName.trim() || !identity.descriptor.trim() || !identity.purpose.trim()) {
    const missingFields = [
      !identity.displayName.trim() ? "displayName" : undefined,
      !identity.descriptor.trim() ? "descriptor" : undefined,
      !identity.purpose.trim() ? "purpose" : undefined,
    ].filter((f): f is string => Boolean(f));
    warnings.push(warn("PRODUCT_IDENTITY_MISSING", `Identity is missing required field(s): ${missingFields.join(", ")}.`, undefined, "Ensure identity synthesis (or a .rvs/product.yml override) populates every required field."));
  }

  if (identity.archetype === "unknown") {
    warnings.push(warn("PRODUCT_IDENTITY_WEAK_EVIDENCE", "No archetype cleared the evidence bar; identity was conservatively left as unknown rather than guessed.", undefined, "Add more evidence-backed capabilities, or accept unknown until more evidence accumulates."));
  }

  const sortedScores = [...model.archetypeScores].sort((a, b) => b.score - a.score);
  const [top, runnerUp] = sortedScores;
  if (top && runnerUp && top.score > 0 && top.score === runnerUp.score) {
    const disjoint = !top.matchedCapabilityIds.some((id) => runnerUp.matchedCapabilityIds.includes(id));
    if (disjoint) {
      warnings.push(warn("PRODUCT_IDENTITY_CONFLICTING_ARCHETYPES", `Archetypes "${top.archetype}" and "${runnerUp.archetype}" tie at score ${top.score} with no overlapping evidence, but only one was selected.`, undefined, "Add distinguishing evidence, or accept the tie as a signal that archetype confidence is low."));
    }
  }

  // approved_terms only lifts this check for descriptor/purpose/shortPromise —
  // the three identity fields an override already has direct authority over
  // (see synthesizeProductIdentity's override application). It is never
  // consulted below for value pillars, differentiators, capabilities, or
  // limitations, which stay strictly evidence-gated.
  const approvedTerms = new Set((override?.approved_terms ?? []).map((t) => t.toLowerCase()));

  const marketingTerm = containsGenericMarketingTerm(`${identity.descriptor} ${identity.purpose} ${identity.shortPromise}`);
  if (marketingTerm && !approvedTerms.has(marketingTerm)) {
    warnings.push(warn("PRODUCT_IDENTITY_GENERIC_MARKETING", `Identity text contains unsupported marketing language: "${marketingTerm}".`, undefined, "Remove the generic marketing phrase and rely on evidence-backed structural language instead."));
  }

  const absoluteTerm = containsAbsoluteSuperiorityTerm(`${identity.descriptor} ${identity.purpose}`);
  if (absoluteTerm && !approvedTerms.has(absoluteTerm)) {
    warnings.push(warn("PRODUCT_IDENTITY_GENERIC_MARKETING", `Identity text contains unsupported comparative language: "${absoluteTerm}".`, undefined, "Remove comparative/superiority language this engine cannot evidence."));
  }

  const availableEvidenceClasses = new Set(identity.evidence.map((e) => e.sourceType === "deployment" ? "deployment" as const : e.sourceType === "release" ? "release" as const : e.sourceType === "usage" ? "usage" as const : undefined).filter((x): x is "deployment" | "release" | "usage" => Boolean(x)));
  const unsupportedProdTerm = findUnsupportedQualifiedMaturityTerm(`${identity.descriptor} ${identity.purpose}`, availableEvidenceClasses);
  if (unsupportedProdTerm) {
    warnings.push(warn("PRODUCT_IDENTITY_UNSUPPORTED_PRODUCTION_CLAIM", `"${unsupportedProdTerm}" is used without deployment/release/usage evidence to support it.`, undefined, "Remove the maturity claim or add supporting deployment/release/usage evidence."));
  }

  const unsupportedEnterpriseTerm = findUnsupportedEnterpriseTerm(`${identity.descriptor} ${identity.purpose}`, availableEvidenceClasses);
  if (unsupportedEnterpriseTerm) {
    warnings.push(warn("PRODUCT_IDENTITY_UNSUPPORTED_ENTERPRISE_CLAIM", `"${unsupportedEnterpriseTerm}" is used without deployment/release/usage evidence to support it.`, undefined, "Remove the enterprise/scale claim or add supporting deployment/release/usage evidence."));
  }

  const roadmapIds = new Set(capModel.roadmapCapabilities.map((c) => c.id));
  const excludedIds = new Set(capModel.excludedCandidates.map((c) => c.id));
  const qualifiedOnlyIds = new Set(capModel.qualifiedCapabilities.map((c) => c.id));
  for (const capId of identity.currentCapabilities) {
    if (roadmapIds.has(capId)) warnings.push(warn("SHOWCASE_ROADMAP_PROMOTED", `Roadmap-only capability "${capId}" appears in currentCapabilities.`, capId));
    if (excludedIds.has(capId)) warnings.push(warn("SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED", `Excluded candidate "${capId}" appears in currentCapabilities.`, capId));
    if (qualifiedOnlyIds.has(capId)) {
      warnings.push(warn("SHOWCASE_PARTIAL_CAPABILITY_UNQUALIFIED", `Capability "${capId}" is only evidence-qualified in the capability model but appears in currentCapabilities without carrying its qualification forward.`, capId, "Move this id to qualifiedCapabilities, or add the supporting evidence needed to fully include it."));
    }
  }

  for (const differentiator of identity.differentiators) {
    if (differentiator.evidenceIds.length === 0) {
      warnings.push(warn("SHOWCASE_UNSUPPORTED_DIFFERENTIATOR", `Differentiator "${differentiator.id}" has no supporting evidence.`, differentiator.id, "Remove this differentiator or attach at least one evidence id."));
    }
  }

  if (override?.disallowed_terms && override.disallowed_terms.length > 0) {
    const evidenceDerivedText = [
      ...identity.valuePillars.flatMap((p) => [p.title, p.explanation]),
      ...identity.differentiators.flatMap((d) => [d.title, d.description]),
      ...identity.limitations,
    ]
      .join(" ")
      .toLowerCase();
    for (const term of override.disallowed_terms) {
      if (term && evidenceDerivedText.includes(term.toLowerCase())) {
        warnings.push(warn("PRODUCT_IDENTITY_OVERRIDE_CONFLICT", `Disallowed term "${term}" from .rvs/product.yml appears in evidence-derived identity content that the override does not control.`, undefined, "Either remove the term from disallowed_terms, or address its source in the underlying evidence — the override cannot rewrite evidence-derived value pillars, differentiators, or limitations."));
      }
    }
  }

  const orderCheck = checkCandidatesOrder(model.candidates);
  if (orderCheck) warnings.push(orderCheck);

  return warnings;
}

/** §28: validates a synthesized ShowcasePlan structurally, including headline/density/claim-control invariants. */
export function validateShowcasePlan(plan: ShowcasePlan, capModel: CapabilityModel): ProductIntelWarning[] {
  const warnings: ProductIntelWarning[] = [];

  if (plan.scenes.length < SHOWCASE_MIN_SCENES) {
    warnings.push(warn("SHOWCASE_TOO_FEW_SCENES", `Showcase plan has ${plan.scenes.length} scenes, below the ${SHOWCASE_MIN_SCENES}-scene minimum.`, undefined, "This may reflect genuinely weak evidence rather than a bug — do not pad with unsupported scenes."));
  }
  if (plan.scenes.length > SHOWCASE_MAX_SCENES) {
    warnings.push(warn("SHOWCASE_TOO_MANY_SCENES", `Showcase plan has ${plan.scenes.length} scenes, above the ${SHOWCASE_MAX_SCENES}-scene maximum.`));
  }

  if (!plan.narrative.centralMessage.trim()) {
    warnings.push(warn("SHOWCASE_MISSING_CENTRAL_MESSAGE", "Executive narrative has no central message."));
  }

  const qualifiedIds = new Set(plan.identity.qualifiedCapabilities);
  const roadmapIds = new Set(capModel.roadmapCapabilities.map((c) => c.id));
  const excludedIds = new Set(capModel.excludedCandidates.map((c) => c.id));
  const runtimeClaimIds = new Set(plan.narrative.runtimeVerificationClaims.map((c) => c.id));
  const evidenceIdToSourceId = new Map(plan.identity.evidence.map((e) => [e.id, e.sourceId]));

  const seenPurposeHeadline = new Set<string>();
  for (const scene of plan.scenes) {
    const headlineWords = wordCount(scene.headline);
    if (headlineWords > SHOWCASE_HEADLINE_HARD_MAX_WORDS) {
      warnings.push(warn("SHOWCASE_HEADLINE_TOO_LONG", `Scene "${scene.id}" headline is ${headlineWords} words, above the ${SHOWCASE_HEADLINE_HARD_MAX_WORDS}-word maximum.`, scene.id));
    }
    if (GENERIC_HEADLINE_LABELS.has(scene.headline.trim().toLowerCase())) {
      warnings.push(warn("SHOWCASE_GENERIC_HEADLINE", `Scene "${scene.id}" headline "${scene.headline}" is a generic slide label rather than a conclusion.`, scene.id));
    }
    if (scene.headline.trim().endsWith("?")) {
      warnings.push(warn("SHOWCASE_HEADLINE_NOT_CONCLUSION_ORIENTED", `Scene "${scene.id}" headline "${scene.headline}" is phrased as a question rather than a stated conclusion.`, scene.id));
    }

    const itemCount = scene.capabilityIds.length + scene.claimIds.length + scene.evidenceIds.length;
    const densityBudget = SCENE_ITEM_DENSITY_BUDGET[scene.density];
    if (itemCount > densityBudget) {
      warnings.push(warn("SHOWCASE_SCENE_TOO_DENSE", `Scene "${scene.id}" references ${itemCount} capability/claim/evidence ids, above the ${densityBudget}-item budget for "${scene.density}" density.`, scene.id, "Split content across more scenes, or raise the scene's density tier if that is genuinely warranted."));
    }

    const referencesQualifiedCapability = scene.capabilityIds.some((id) => qualifiedIds.has(id));
    if (referencesQualifiedCapability && !/qualif/i.test(scene.headline) && !scene.qualifiers.some((q) => /qualif/i.test(q))) {
      warnings.push(warn("SHOWCASE_HEADLINE_UNSUPPORTED_CLAIM", `Scene "${scene.id}" references a qualified capability but neither its headline nor qualifiers imply the limitation.`, scene.id));
    }

    for (const capId of scene.capabilityIds) {
      if (roadmapIds.has(capId)) warnings.push(warn("SHOWCASE_HEADLINE_ROADMAP_PROMOTED", `Scene "${scene.id}" references roadmap-only capability "${capId}".`, scene.id));
      if (excludedIds.has(capId)) warnings.push(warn("SHOWCASE_EXCLUDED_CAPABILITY_PROMOTED", `Scene "${scene.id}" references excluded candidate "${capId}".`, scene.id));
    }

    const referencesUnverifiedRuntimeClaim = scene.claimIds.some((id) => runtimeClaimIds.has(id));
    if (referencesUnverifiedRuntimeClaim && !scene.qualifiers.some((q) => /runtime|verif/i.test(q))) {
      warnings.push(warn("SHOWCASE_RUNTIME_CLAIM_UNVERIFIED", `Scene "${scene.id}" references a runtime-verification-required claim without a qualifier disclosing it is unverified.`, scene.id));
    }

    const totalWords = headlineWords + (scene.subheadline ? wordCount(scene.subheadline) : 0);
    if (totalWords > SCENE_TOTAL_WORD_BUDGET) {
      warnings.push(warn("SHOWCASE_SCENE_WORD_BUDGET_EXCEEDED", `Scene "${scene.id}" uses ${totalWords} narrative words, above the low-density budget of ${SCENE_TOTAL_WORD_BUDGET}.`, scene.id));
    }

    const purposeKey = `${scene.narrativeRole}:${scene.headline.trim().toLowerCase()}`;
    if (seenPurposeHeadline.has(purposeKey)) {
      warnings.push(warn("SHOWCASE_DUPLICATE_SCENE_PURPOSE", `Scene "${scene.id}" duplicates another scene's narrative role and headline.`, scene.id));
    }
    seenPurposeHeadline.add(purposeKey);

    const capIdOrderCheck = [...scene.capabilityIds].every((id, i, arr) => i === 0 || arr[i - 1].localeCompare(id) <= 0);
    if (!capIdOrderCheck) {
      warnings.push(warn("SHOWCASE_NONDETERMINISTIC_ORDER", `Scene "${scene.id}" capabilityIds are not sorted deterministically.`, scene.id));
    }
  }

  for (const metric of plan.metrics) {
    const resolvedSourceIds = metric.evidenceIds.map((id) => evidenceIdToSourceId.get(id)).filter((id): id is string => Boolean(id));
    if (metric.evidenceIds.length === 0 || resolvedSourceIds.length === 0) {
      warnings.push(warn("SHOWCASE_UNSUPPORTED_METRIC", `Metric "${metric.id}" does not resolve to any evidence in the identity model.`, metric.id, "Remove this metric or back it with a real evidence id."));
    }
    if (resolvedSourceIds.some((id) => roadmapIds.has(id) || excludedIds.has(id))) {
      warnings.push(warn("SHOWCASE_METRIC_COUNTS_EXCLUDED_CAPABILITY", `Metric "${metric.id}" traces back to a roadmap-only or excluded capability.`, metric.id, "Exclude the roadmap/excluded capability's evidence from this metric's basis."));
    }
  }

  for (const claim of plan.narrative.rejectedClaims) {
    if (claim.rejectionReasons.length === 0) {
      warnings.push(warn("SHOWCASE_EVIDENCE_MISSING", `Rejected claim "${claim.id}" has no rejection reason codes recorded.`, claim.id));
    }
  }

  return warnings;
}
