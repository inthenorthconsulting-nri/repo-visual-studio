// Coverage always emits a numerator/denominator pair, never a bare
// adjective claim. A dimension whose upstream snapshot was never supplied
// is omitted entirely rather than reported as "0/0" -- "no way to even
// ask" must never collapse into "no coverage."

import type { DecisionCoverageMetric, DecisionLink, EvidenceRef } from "./contracts.js";
import { extractExceptions } from "./governance-links.js";
import { buildCoverageMetricId } from "./ids.js";
import { collectKnownEntityIds } from "./links.js";

export interface CoverageInputs {
  architectureSnapshot?: unknown;
  capabilitySnapshot?: unknown;
  productSnapshot?: unknown;
  portfolioSnapshot?: unknown;
  governancePolicy?: unknown;
}

const ENTITY_DIMENSIONS: ReadonlyArray<{ dimension: DecisionCoverageMetric["dimension"]; domain: DecisionLink["target_domain"]; snapshotKey: keyof CoverageInputs }> = [
  { dimension: "architecture_entities", domain: "architecture", snapshotKey: "architectureSnapshot" },
  { dimension: "capabilities", domain: "capability", snapshotKey: "capabilitySnapshot" },
  { dimension: "products", domain: "product", snapshotKey: "productSnapshot" },
  { dimension: "portfolio_relationships", domain: "portfolio", snapshotKey: "portfolioSnapshot" },
];

export function buildDecisionCoverage(links: DecisionLink[], inputs: CoverageInputs, evidenceRefs: EvidenceRef[]): DecisionCoverageMetric[] {
  const metrics: Array<DecisionCoverageMetric | undefined> = ENTITY_DIMENSIONS.map(({ dimension, domain, snapshotKey }) =>
    buildEntityMetric(dimension, domain, links, inputs[snapshotKey], evidenceRefs),
  );
  metrics.push(buildGovernanceMetric(links, inputs.governancePolicy, evidenceRefs));

  return metrics.filter((m): m is DecisionCoverageMetric => m !== undefined).sort((a, b) => a.id.localeCompare(b.id));
}

function buildEntityMetric(
  dimension: DecisionCoverageMetric["dimension"],
  domain: DecisionLink["target_domain"],
  links: DecisionLink[],
  snapshot: unknown,
  evidenceRefs: EvidenceRef[],
): DecisionCoverageMetric | undefined {
  if (snapshot === undefined) return undefined;

  const knownIds = collectKnownEntityIds(snapshot);
  const coveredIds = new Set(
    links
      .filter((l) => l.target_domain === domain && l.target_id !== undefined && (l.resolution === "resolved" || l.resolution === "partially_resolved") && knownIds.has(l.target_id))
      .map((l) => l.target_id as string),
  );

  return {
    id: buildCoverageMetricId(dimension),
    dimension,
    numerator: coveredIds.size,
    denominator: knownIds.size,
    evidence_refs: evidenceRefs,
  };
}

function buildGovernanceMetric(links: DecisionLink[], governancePolicy: unknown, evidenceRefs: EvidenceRef[]): DecisionCoverageMetric | undefined {
  if (governancePolicy === undefined) return undefined;

  const denominator = extractExceptions(governancePolicy).length;
  const numerator = links.filter((l) => l.target_domain === "governance" && l.link_type === "excepts" && l.resolution === "resolved").length;

  return {
    id: buildCoverageMetricId("governance_exceptions"),
    dimension: "governance_exceptions",
    numerator,
    denominator,
    evidence_refs: evidenceRefs,
  };
}
