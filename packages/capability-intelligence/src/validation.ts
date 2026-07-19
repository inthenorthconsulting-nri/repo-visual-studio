import type { Capability, CapabilityModel, CapIntelWarning } from "./contracts.js";
import { PLACEHOLDER_STYLE_SIGNAL_KEYWORDS } from "./contracts.js";

const RAW_PATH_PATTERN = /[/\\]|\.(ts|js|tsx|jsx|py|go|rb|yml|yaml|json|md)$/i;
const OVER_GRANULAR_WORD_COUNT = 1;

function checkRawPathName(cap: Capability, warnings: CapIntelWarning[]): void {
  if (RAW_PATH_PATTERN.test(cap.displayName)) {
    warnings.push({
      code: "CAP_INTEL_RAW_PATH_AS_CAPABILITY_NAME",
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) renders a raw source path or filename as its display name instead of a human-readable capability name.`,
      relatedId: cap.id,
      remediation: "Ensure candidate discovery routes this through normalizeLabel()/humanizeCapabilityName() rather than a raw directory or file name.",
    });
  }
  if (cap.granularity !== "capability") {
    warnings.push({
      code: "CAP_INTEL_CAPABILITY_TOO_GRANULAR",
      severity: "error",
      message: `"${cap.displayName}" (${cap.id}) has granularity "${cap.granularity}" but appears among primary capability entries; only granularity "capability" may appear as a primary CAPABILITIES.md entry.`,
      relatedId: cap.id,
      remediation: "Fold this item under its parent capability as a feature/implementation_step, or re-classify its granularity.",
    });
  }
  if (cap.displayName.trim().split(/\s+/).length <= OVER_GRANULAR_WORD_COUNT && cap.evidence.length <= 1) {
    warnings.push({
      code: "CAP_INTEL_CAPABILITY_TOO_GRANULAR",
      severity: "informational",
      message: `"${cap.displayName}" (${cap.id}) is named with a single word and backed by a single piece of evidence — verify it is not an implementation detail promoted above its real granularity.`,
      relatedId: cap.id,
    });
  }
}

function checkPromotedStatus(cap: Capability, warnings: CapIntelWarning[]): void {
  const promotedButUnsupported: Record<string, CapIntelWarning["code"]> = {
    scaffolded: "CAP_INTEL_SCAFFOLD_PROMOTED",
    planned: "CAP_INTEL_PLANNED_CAPABILITY_PROMOTED",
    deprecated: "CAP_INTEL_DEPRECATED_CAPABILITY_PROMOTED",
    unknown: "CAP_INTEL_DOCUMENTATION_ONLY_CAPABILITY",
  };
  const code = promotedButUnsupported[cap.status];
  if (code) {
    warnings.push({
      code,
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) has status "${cap.status}" but inclusion "${cap.inclusion}" — a ${cap.status} candidate must never be promoted into the current-capability narrative.`,
      relatedId: cap.id,
      remediation: "Re-run the evidence/maturity gate; this indicates an inclusion-policy defect, not a content problem.",
    });
  }
  if (cap.readiness.executionScore === 0 && (cap.status === "operational" || cap.status === "implemented")) {
    warnings.push({
      code: "CAP_INTEL_NO_EXECUTION_PATH",
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) is classified "${cap.status}" with zero execution-evidence score — status classification must never override the execution hard gate.`,
      relatedId: cap.id,
    });
  }
}

/**
 * decideCapabilityInclusion() already routes most placeholder-flagged
 * candidates to PLACEHOLDER_IMPLEMENTATION exclusion (see
 * inclusion-policy.ts), but a candidate carrying only one placeholder-style
 * signal alongside otherwise-strong evidence can still legitimately reach
 * include/include_with_qualification (score erosion, not a hard gate). This
 * is the post-hoc invariant check catching one that slipped through — or
 * flagging that its evidence descriptions deserve a second look even though
 * it was not hard-excluded.
 */
function checkPlaceholderPromoted(cap: Capability, warnings: CapIntelWarning[]): void {
  const matched = cap.matchedIncompleteSignals.filter((s) => PLACEHOLDER_STYLE_SIGNAL_KEYWORDS.includes(s));
  if (matched.length > 0) {
    warnings.push({
      code: "CAP_INTEL_PLACEHOLDER_PROMOTED",
      severity: "warning",
      message: `Capability "${cap.displayName}" (${cap.id}) is promoted into current-capability output (inclusion "${cap.inclusion}") but still carries placeholder-style incomplete signals (${matched.join(", ")}); verify this reflects a real implementation rather than a stub/mock/prototype.`,
      relatedId: cap.id,
      remediation: "Re-check this capability's evidence descriptions and matchedIncompleteSignals; if implementation evidence is genuinely a stub/mock, decideCapabilityInclusion() should be routing it to PLACEHOLDER_IMPLEMENTATION exclusion instead.",
    });
  }
}

function checkQualification(cap: Capability, warnings: CapIntelWarning[]): void {
  if (cap.status === "partial" && cap.inclusion === "include") {
    warnings.push({
      code: "CAP_INTEL_PARTIAL_CAPABILITY_UNQUALIFIED",
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) has status "partial" but inclusion "include" — partial capabilities must render under "Available with limitations" (include_with_qualification), never as an unqualified current capability.`,
      relatedId: cap.id,
    });
  }
}

function checkOutcome(cap: Capability, warnings: CapIntelWarning[]): void {
  if (!cap.outcome) return;
  if (/\b(in production|at scale|saves? \$?[\d,]+|reduces? .* by \d+%)\b/i.test(cap.outcome) && !cap.evidence.some((e) => e.type === "usage" || e.type === "deployment" || e.type === "release")) {
    warnings.push({
      code: "CAP_INTEL_UNSUPPORTED_OUTCOME",
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) states an outcome ("${cap.outcome}") that reads as a quantified or production-use claim without adoption/deployment/release evidence to support it.`,
      relatedId: cap.id,
    });
  }
}

function checkEvidence(cap: Capability, warnings: CapIntelWarning[]): void {
  if (cap.evidence.length === 0) {
    warnings.push({
      code: "CAP_INTEL_MISSING_EVIDENCE",
      severity: "error",
      message: `Capability "${cap.displayName}" (${cap.id}) has inclusion "${cap.inclusion}" but carries no evidence at all.`,
      relatedId: cap.id,
    });
  }
  const hasConfirmedStructural = cap.evidence.some((e) => e.confidence === "confirmed" && e.type !== "documentation" && e.type !== "example" && e.type !== "todo_marker" && e.type !== "deprecated_marker");
  const hasDeprecatedMarker = cap.evidence.some((e) => e.type === "deprecated_marker");
  if (hasConfirmedStructural && hasDeprecatedMarker && cap.status !== "deprecated") {
    warnings.push({
      code: "CAP_INTEL_CONTRADICTORY_EVIDENCE",
      severity: "warning",
      message: `Capability "${cap.displayName}" (${cap.id}) carries both confirmed structural evidence and a deprecated/disabled marker; this should have been routed through the contradictory-evidence exclusion path.`,
      relatedId: cap.id,
    });
  }
}

/**
 * Every pipeline stage that assembles an id-bearing collection (grouping.ts,
 * index.ts's synthesizeCapabilities()) sorts it by `.id.localeCompare()`
 * specifically so two syntheses of the same commit produce byte-identical
 * output. This is a structural promise this validator can check directly —
 * one out-of-order pair anywhere in `items` proves the promise was broken,
 * without needing to re-run the stage that produced it.
 */
function checkSortedById<T extends { id: string }>(items: T[], collectionLabel: string, warnings: CapIntelWarning[]): void {
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1]!;
    const curr = items[i]!;
    if (prev.id.localeCompare(curr.id) > 0) {
      warnings.push({
        code: "CAP_INTEL_NONDETERMINISTIC_ORDER",
        severity: "error",
        message: `${collectionLabel} is not sorted by id ascending ("${prev.id}" appears before "${curr.id}"); output must be deterministic across syntheses of the same commit.`,
        relatedId: curr.id,
        remediation: "Ensure the stage producing this collection sorts by .id.localeCompare() before returning (see grouping.ts / index.ts's synthesizeCapabilities()).",
      });
      return;
    }
  }
}

function checkDuplicates(capabilities: Capability[], warnings: CapIntelWarning[]): void {
  const byName = new Map<string, Capability[]>();
  for (const cap of capabilities) {
    const key = cap.displayName.trim().toLowerCase();
    const bucket = byName.get(key) ?? [];
    bucket.push(cap);
    byName.set(key, bucket);
  }
  for (const [name, caps] of byName) {
    if (caps.length > 1) {
      for (const cap of caps) {
        warnings.push({
          code: "CAP_INTEL_DUPLICATE_CAPABILITY",
          severity: "warning",
          message: `Capability name "${name}" is used by ${caps.length} distinct capability ids (${caps.map((c) => c.id).join(", ")}); these were not merged by candidate deduplication.`,
          relatedId: cap.id,
          remediation: "Verify these represent genuinely distinct capabilities, or extend candidates.ts's merge heuristic to catch this overlap.",
        });
      }
    }
  }
}

/**
 * Pure structural checks over an already-synthesized CapabilityModel — no
 * rendering, no layout. Mirrors validateArchitectureIntelligenceStructure().
 * These checks exist to catch defects in this package's own inclusion logic
 * (a status/inclusion mismatch, a promoted scaffold, an unsupported outcome
 * claim) before a CapabilityModel ever reaches an exporter or presentation.
 */
export function validateCapabilityModelStructure(model: CapabilityModel): CapIntelWarning[] {
  const warnings: CapIntelWarning[] = [];

  checkSortedById(model.domains, "model.domains", warnings);
  for (const domain of model.domains) {
    checkSortedById(domain.capabilities, `domain "${domain.displayName}" (${domain.id}) capabilities`, warnings);
  }
  checkSortedById(model.includedCapabilities, "model.includedCapabilities", warnings);
  checkSortedById(model.qualifiedCapabilities, "model.qualifiedCapabilities", warnings);
  checkSortedById(model.roadmapCapabilities, "model.roadmapCapabilities", warnings);
  checkSortedById(model.gapCapabilities, "model.gapCapabilities", warnings);
  checkSortedById(model.unresolvedCapabilities, "model.unresolvedCapabilities", warnings);
  checkSortedById(model.excludedCandidates, "model.excludedCandidates", warnings);

  const seenIds = new Map<string, number>();
  const allCapabilities = [...model.includedCapabilities, ...model.qualifiedCapabilities, ...model.roadmapCapabilities, ...model.gapCapabilities, ...model.unresolvedCapabilities];
  const allIds = [...model.domains.map((d) => d.id), ...allCapabilities.map((c) => c.id), ...model.excludedCandidates.map((c) => c.id)];
  for (const id of allIds) seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
  for (const [id, count] of seenIds) {
    if (count > 1) {
      warnings.push({ code: "CAP_INTEL_DUPLICATE_CAPABILITY", severity: "error", message: `Id "${id}" is used ${count} times across the capability model.`, relatedId: id });
    }
  }

  for (const domain of model.domains) {
    if (domain.capabilities.length === 0) {
      warnings.push({ code: "CAP_INTEL_EMPTY_DOMAIN", severity: "error", message: `Domain "${domain.displayName}" (${domain.id}) has no included/qualified capabilities.`, relatedId: domain.id });
    }
  }

  const domainIdsWithVisibleCapability = new Set(model.domains.filter((d) => d.capabilities.length > 0).map((d) => d.id));
  const roadmapOnlyDomainIds = new Set(model.roadmapCapabilities.map((c) => c.domainId).filter((id) => !domainIdsWithVisibleCapability.has(id)));
  for (const domainId of roadmapOnlyDomainIds) {
    warnings.push({
      code: "CAP_INTEL_DOMAIN_WITH_ONLY_ROADMAP_ITEMS",
      severity: "warning",
      message: `Domain id "${domainId}" has no included/qualified capabilities but has roadmap-only capabilities referencing it; do not surface this domain in current-capability output.`,
      relatedId: domainId,
    });
  }

  for (const cap of [...model.includedCapabilities, ...model.qualifiedCapabilities]) {
    checkRawPathName(cap, warnings);
    checkPromotedStatus(cap, warnings);
    checkQualification(cap, warnings);
    checkOutcome(cap, warnings);
    checkEvidence(cap, warnings);
    checkPlaceholderPromoted(cap, warnings);
    if (cap.status === "unknown" || cap.confidence === "unresolved") {
      warnings.push({
        code: "CAP_INTEL_UNKNOWN_STATUS_IN_EXECUTIVE_OUTPUT",
        severity: "error",
        message: `Capability "${cap.displayName}" (${cap.id}) has status/confidence "${cap.status}"/"${cap.confidence}" but is included in executive-facing output.`,
        relatedId: cap.id,
      });
    }
  }

  checkDuplicates([...model.includedCapabilities, ...model.qualifiedCapabilities], warnings);

  for (const cap of model.roadmapCapabilities) {
    if (cap.status === "operational" || cap.status === "implemented") {
      warnings.push({
        code: "CAP_INTEL_ROADMAP_ITEM_COUNTED_AS_CURRENT",
        severity: "error",
        message: `Roadmap-only capability "${cap.displayName}" (${cap.id}) has status "${cap.status}" — a roadmap item should never carry a current-implementation status.`,
        relatedId: cap.id,
      });
    }
  }

  for (const excluded of model.excludedCandidates) {
    if (excluded.status === "operational" || excluded.status === "implemented") {
      warnings.push({
        code: "CAP_INTEL_EXCLUDED_CAPABILITY_COUNTED_AS_CURRENT",
        severity: "warning",
        message: `Excluded candidate "${excluded.displayName}" (${excluded.id}) has status "${excluded.status}" despite exclusion; verify it is never counted in current-capability metrics.`,
        relatedId: excluded.id,
      });
    }
  }

  return warnings;
}
