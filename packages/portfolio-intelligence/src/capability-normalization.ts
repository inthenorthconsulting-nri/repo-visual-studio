import type { Capability, CapabilityModel } from "@rvs/capability-intelligence";
import type { PortfolioCapability, PortfolioCapabilityParticipation, PortfolioEvidence, PortfolioProduct } from "./contracts.js";
import { portfolioCapabilityId, portfolioEvidenceId } from "./ids.js";

// ---------------------------------------------------------------------------
// §8 Capability normalization
//
// Determines which capabilities across independently-generated products are
// the *same* underlying responsibility using multiple deterministic
// evidence signals (name/purpose token overlap, domain compatibility, actor
// overlap, workflow overlap, external-system overlap, evidence-type
// overlap) — never string similarity alone. A capability pair only merges
// into one normalized PortfolioCapability when it crosses SAME_THRESHOLD
// *and* at least one non-lexical signal (domain/actor/workflow/external
// system) also agrees; lexical overlap by itself is never sufficient
// (§8 hard rule).
//
// This module only ever produces "single_product" (one implementation) or
// "shared" (multiple products implement the same responsibility) coverage.
// "overlapping" is a later, evidence-gated *reclassification* of a "shared"
// entry performed by overlaps.ts (§14) once actor/outcome/ownership signals
// have been evaluated — never assigned here. "complementary" describes a
// relationship *between two distinct* normalized capabilities (different
// responsibilities that work together) and is represented as a
// PortfolioProductRelationship by product-relationships.ts, not as a
// coverage value on a single capability. "fragmented", "missing", and
// "roadmap_only" are reserved for future use once this module is extended
// to reason over CapabilityModel.gapCapabilities/roadmapCapabilities across
// products — mirroring @rvs/capability-intelligence's own
// unresolvedCapabilities precedent of a typed-but-not-yet-populated state.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "via", "by", "is", "are", "as", "at", "from"]);

/** Generic synonym groups (§8) — never a product-specific capability name. */
const SYNONYM_GROUPS: string[][] = [
  ["identity", "access", "permission", "entitlement"],
  ["validation", "quality", "diagnostics", "checks", "check"],
  ["migration", "transition", "move", "promotion"],
  ["governance", "policy", "control"],
  ["operations", "administration", "management"],
  ["metadata", "catalog", "lineage"],
];

const SYNONYM_CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) for (const term of group) SYNONYM_CANONICAL.set(term, group[0]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
      .map((t) => SYNONYM_CANONICAL.get(t) ?? t),
  );
}

function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = a instanceof Set ? a : new Set(a);
  const sb = b instanceof Set ? b : new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection += 1;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ProductCapabilityRef {
  productId: string;
  configId: string;
  capability: Capability;
  qualified: boolean;
}

export function collectCapabilityRefs(products: PortfolioProduct[], capabilityModelsByProductId: Map<string, CapabilityModel>): ProductCapabilityRef[] {
  const refs: ProductCapabilityRef[] = [];
  for (const product of products) {
    const model = capabilityModelsByProductId.get(product.id);
    if (!model) continue;
    const byId = new Map<string, { capability: Capability; qualified: boolean }>();
    for (const c of model.includedCapabilities) byId.set(c.id, { capability: c, qualified: false });
    for (const c of model.qualifiedCapabilities) byId.set(c.id, { capability: c, qualified: true });
    // Dedupe: current/qualified come from an external, unrevalidated product-identity.json
    // artifact -- a malformed generator run could list the same capability id in both lists,
    // and a Set here (rather than a plain concatenated array) keeps that from producing two
    // refs for the same (product, capability) pair, which would double-count it downstream.
    for (const id of new Set([...product.currentCapabilityIds, ...product.qualifiedCapabilityIds])) {
      const entry = byId.get(id);
      if (entry) refs.push({ productId: product.id, configId: product.source.configId, capability: entry.capability, qualified: entry.qualified });
    }
  }
  return refs.sort((a, b) => a.productId.localeCompare(b.productId) || a.capability.id.localeCompare(b.capability.id));
}

function domainLabel(capability: Capability, model: CapabilityModel | undefined): string {
  return model?.domains.find((d) => d.id === capability.domainId)?.displayName ?? capability.domainId;
}

export interface CapabilitySimilaritySignals {
  nameOverlap: number;
  domainOverlap: number;
  actorOverlap: number;
  workflowOverlap: number;
  externalSystemOverlap: number;
  evidenceTypeOverlap: number;
}

export function computeCapabilitySimilarity(a: ProductCapabilityRef, b: ProductCapabilityRef): { score: number; signals: CapabilitySimilaritySignals } {
  const aTokens = new Set([...tokenize(a.capability.displayName), ...tokenize(a.capability.purpose), ...tokenize(a.capability.outcome ?? "")]);
  const bTokens = new Set([...tokenize(b.capability.displayName), ...tokenize(b.capability.purpose), ...tokenize(b.capability.outcome ?? "")]);

  const signals: CapabilitySimilaritySignals = {
    nameOverlap: jaccard(aTokens, bTokens),
    domainOverlap: jaccard(tokenize(a.capability.domainId), tokenize(b.capability.domainId)),
    actorOverlap: jaccard(a.capability.actors, b.capability.actors),
    workflowOverlap: jaccard(a.capability.workflows, b.capability.workflows),
    externalSystemOverlap: jaccard(a.capability.externalSystems, b.capability.externalSystems),
    evidenceTypeOverlap: jaccard(
      a.capability.evidence.map((e) => e.type),
      b.capability.evidence.map((e) => e.type),
    ),
  };

  const score = signals.nameOverlap * 0.35 + signals.domainOverlap * 0.15 + signals.actorOverlap * 0.15 + signals.workflowOverlap * 0.15 + signals.externalSystemOverlap * 0.1 + signals.evidenceTypeOverlap * 0.1;

  return { score, signals };
}

export const SAME_CAPABILITY_THRESHOLD = 0.5;

/** Multi-signal gate (§8): lexical overlap alone, however high, is never sufficient — at least one structural signal must also agree. */
export function isSameCapability(signals: CapabilitySimilaritySignals, score: number): boolean {
  if (score < SAME_CAPABILITY_THRESHOLD) return false;
  const structuralAgreement = signals.domainOverlap > 0 || signals.actorOverlap > 0 || signals.workflowOverlap > 0 || signals.externalSystemOverlap > 0;
  return signals.nameOverlap > 0 && structuralAgreement;
}

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function capabilityRefKey(ref: ProductCapabilityRef): string {
  return `${ref.productId}::${ref.capability.id}`;
}

export interface CapabilityNormalizationResult {
  capabilities: PortfolioCapability[];
  evidence: PortfolioEvidence[];
  /** ref key -> normalized PortfolioCapability id, used by capability-relationships.ts/product-relationships.ts to look up which group a given product capability landed in. */
  refToCapabilityId: Map<string, string>;
}

export function normalizePortfolioCapabilities(products: PortfolioProduct[], capabilityModelsByProductId: Map<string, CapabilityModel>): CapabilityNormalizationResult {
  const refs = collectCapabilityRefs(products, capabilityModelsByProductId);
  const uf = new UnionFind(refs.length);

  for (let i = 0; i < refs.length; i += 1) {
    for (let j = i + 1; j < refs.length; j += 1) {
      if (refs[i].productId === refs[j].productId) continue;
      const { score, signals } = computeCapabilitySimilarity(refs[i], refs[j]);
      if (isSameCapability(signals, score)) uf.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < refs.length; i += 1) {
    const root = uf.find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }

  const capabilities: PortfolioCapability[] = [];
  const evidence: PortfolioEvidence[] = [];
  const refToCapabilityId = new Map<string, string>();

  // `capability.id` is a pure function of source label text alone (not
  // product-scoped), so two unrelated products can produce identically-named
  // capabilities that land in different groups — a group's first-member
  // capability.id alone is not always unique, so the group's full
  // `normalizedKey` (unique by construction, computed once here) breaks the
  // tie deterministically instead of falling back to Map insertion order.
  const groupEntries = [...groups.values()].map((memberIndices) => {
    const members = memberIndices.map((i) => refs[i]).sort((a, b) => a.productId.localeCompare(b.productId) || a.capability.id.localeCompare(b.capability.id));
    const normalizedKey = members.map((m) => `${m.productId}:${m.capability.id}`).join("|");
    return { members, normalizedKey };
  });
  const sortedGroups = groupEntries.sort((a, b) => a.members[0].capability.id.localeCompare(b.members[0].capability.id) || a.normalizedKey.localeCompare(b.normalizedKey));

  for (const { members, normalizedKey } of sortedGroups) {
    // Canonical label: the member with the most evidence wins (best-supported label); ties broken by shorter, then alphabetically earlier, display name for determinism.
    const canonical = [...members].sort(
      (a, b) => b.capability.evidence.length - a.capability.evidence.length || a.capability.displayName.length - b.capability.displayName.length || a.capability.displayName.localeCompare(b.capability.displayName),
    )[0];
    const capabilityId = portfolioCapabilityId(normalizedKey);

    const participation: PortfolioCapabilityParticipation[] = members.map((m) => ({
      productId: m.productId,
      productCapabilityId: m.capability.id,
      productCapabilityDisplayName: m.capability.displayName,
      qualified: m.qualified,
    }));

    const capabilityEvidenceIds: string[] = [];
    for (const m of members) {
      const evidenceId = portfolioEvidenceId("capability", m.productId, evidence.length);
      evidence.push({
        id: evidenceId,
        sourceType: "capability",
        productId: m.productId,
        sourceId: m.capability.id,
        text: `${m.capability.displayName}: ${m.capability.purpose}`,
        confidence: m.capability.confidence === "unresolved" ? "unresolved" : m.capability.confidence,
      });
      capabilityEvidenceIds.push(evidenceId);
    }

    const confidences = members.map((m) => m.capability.confidence);
    const confidence = confidences.includes("unresolved") ? "unresolved" : confidences.every((c) => c === "confirmed") ? "confirmed" : confidences.some((c) => c === "confirmed" || c === "derived") ? "derived" : "suggested";

    capabilities.push({
      id: capabilityId,
      displayName: canonical.capability.displayName,
      domain: domainLabel(canonical.capability, capabilityModelsByProductId.get(canonical.productId)),
      coverage: members.length > 1 ? "shared" : "single_product",
      participation,
      evidenceIds: capabilityEvidenceIds,
      confidence,
    });

    for (const m of members) refToCapabilityId.set(capabilityRefKey(m), capabilityId);
  }

  return { capabilities: capabilities.sort((a, b) => a.id.localeCompare(b.id)), evidence, refToCapabilityId };
}
