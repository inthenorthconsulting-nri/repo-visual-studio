import type { ArchitectureIntelligence, ResponsibilityKind } from "@rvs/architecture-intelligence";
import type { Capability, CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductArchetype, ProductArchetypeScore } from "./contracts.js";

// §4: evidence-weighted archetype classification. Every signal below is a
// generic structural/vocabulary concept (governance, operations,
// reliability, ...) — never a repository-specific product name or phrase.
// The same signal list runs unchanged against any repository.
const ARCHETYPE_TEXT_SIGNALS: Record<ProductArchetype, readonly string[]> = {
  governance_platform: ["governance", "policy", "compliance", "audit", "access control", "permission", "approval", "guardrail"],
  operations_platform: ["operations", "operational", "orchestration", "scheduling", "pipeline", "runbook", "administration"],
  reliability_platform: ["reliability", "health", "uptime", "incident", "alert", "recovery", "resilience", "diagnostic", "doctor"],
  developer_tool: ["cli", "developer", "sdk", "scaffold", "generator", "local development", "tooling", "command line"],
  automation_platform: ["automation", "automate", "trigger", "scheduled job", "workflow automation", "auto-remediate"],
  migration_platform: ["migration", "migrate", "upgrade path", "conversion", "legacy", "cutover"],
  observability_platform: ["observability", "logging", "metrics", "tracing", "dashboard", "telemetry", "monitoring"],
  control_plane: ["control plane", "provisioning", "configuration management", "infrastructure control", "topology"],
  integration_platform: ["integration", "connector", "sync", "api gateway", "webhook", "adapter"],
  data_product: ["data pipeline", "analytics", "reporting", "dataset", "etl", "warehouse", "extraction"],
  library: ["library", "reusable package", "utility", "primitive"],
  framework: ["framework", "extensible", "plugin architecture", "abstraction layer", "scaffolding for"],
  unknown: [],
};

/** Responsibility kinds discovered by Architecture Intelligence provide a coarse structural boost independent of capability wording. */
const RESPONSIBILITY_ARCHETYPE_BOOST: Partial<Record<ResponsibilityKind, ProductArchetype[]>> = {
  governance: ["governance_platform"],
  automation: ["automation_platform", "operations_platform"],
  infrastructure: ["control_plane"],
  data: ["data_product"],
  integration: ["integration_platform"],
  operations: ["operations_platform"],
  security: ["governance_platform"],
};

const ALL_ARCHETYPES = Object.keys(ARCHETYPE_TEXT_SIGNALS) as ProductArchetype[];

function textMatchesArchetype(text: string, archetype: ProductArchetype): boolean {
  const lower = text.toLowerCase();
  return ARCHETYPE_TEXT_SIGNALS[archetype].some((signal) => lower.includes(signal));
}

export function classifyArchetypes(model: CapabilityModel, arch: ArchitectureIntelligence): ProductArchetypeScore[] {
  const included = model.includedCapabilities;
  const qualified = model.qualifiedCapabilities;

  const scores = new Map<ProductArchetype, { score: number; includedSignalCount: number; qualifiedSignalCount: number; matchedCapabilityIds: Set<string> }>();
  for (const archetype of ALL_ARCHETYPES) {
    if (archetype === "unknown") continue;
    scores.set(archetype, { score: 0, includedSignalCount: 0, qualifiedSignalCount: 0, matchedCapabilityIds: new Set() });
  }

  const applyCapability = (cap: Capability, weight: number, isIncluded: boolean) => {
    const text = `${cap.displayName} ${cap.purpose} ${cap.shortDescription}`;
    for (const archetype of ALL_ARCHETYPES) {
      if (archetype === "unknown") continue;
      if (textMatchesArchetype(text, archetype)) {
        const bucket = scores.get(archetype)!;
        bucket.score += weight;
        bucket.matchedCapabilityIds.add(cap.id);
        if (isIncluded) bucket.includedSignalCount += 1;
        else bucket.qualifiedSignalCount += 1;
      }
    }
  };

  for (const cap of included) applyCapability(cap, 2, true);
  for (const cap of qualified) applyCapability(cap, 1, false);

  for (const responsibility of arch.responsibilities) {
    const boosted = RESPONSIBILITY_ARCHETYPE_BOOST[responsibility.kind];
    if (!boosted) continue;
    for (const archetype of boosted) {
      const bucket = scores.get(archetype)!;
      bucket.score += 1;
    }
  }

  if (arch.components.some((c) => c.kind === "cli")) {
    scores.get("developer_tool")!.score += 1;
  }

  const result: ProductArchetypeScore[] = ALL_ARCHETYPES.filter((a) => a !== "unknown").map((archetype) => {
    const bucket = scores.get(archetype)!;
    return {
      archetype,
      score: bucket.score,
      includedSignalCount: bucket.includedSignalCount,
      qualifiedSignalCount: bucket.qualifiedSignalCount,
      matchedCapabilityIds: [...bucket.matchedCapabilityIds].sort((a, b) => a.localeCompare(b)),
    };
  });

  // Deterministic ordering: score desc, then archetype id asc as a stable tiebreak.
  result.sort((a, b) => b.score - a.score || a.archetype.localeCompare(b.archetype));
  return result;
}

/**
 * §4 primary-archetype rule: needs >=2 included capabilities OR 1 included +
 * 2 qualified with strong (score-contributing) evidence. When no archetype
 * clears the bar, the primary archetype must be "unknown" rather than an
 * impressive-but-unsupported guess — per the spec's closing guidance.
 */
export function selectArchetypes(scores: ProductArchetypeScore[]): { primary: ProductArchetype; secondary: ProductArchetype[] } {
  const qualifying = scores.filter((s) => s.includedSignalCount >= 2 || (s.includedSignalCount >= 1 && s.qualifiedSignalCount >= 2));
  if (qualifying.length === 0) {
    return { primary: "unknown", secondary: [] };
  }
  const [primary, ...rest] = qualifying;
  const secondary = rest
    .filter((s) => s.score > 0)
    .slice(0, 2)
    .map((s) => s.archetype);
  return { primary: primary.archetype, secondary };
}
