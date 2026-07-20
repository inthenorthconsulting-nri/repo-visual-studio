import { createHash } from "node:crypto";
import type { GovernanceArtifactDigest, GovernanceArtifactKind, IntelligenceSnapshot } from "./contracts.js";
import { GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION } from "./contracts.js";
import { buildSnapshotId } from "./ids.js";

// ---------------------------------------------------------------------------
// Canonicalization and digesting
// ---------------------------------------------------------------------------

/** Recursively sorts object keys so JSON.stringify never depends on the source object's own key insertion order. Array element order is preserved as-is -- the upstream artifacts already document their own array sort order, and reordering elements here would defeat that. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

/** SHA-256 hex digest of a value's canonical (key-sorted) JSON string form. */
function digestOf(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonical).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Minimal identity extraction -- only the fields governance actually needs
// (repo id/name, schema version, generated_at, git_commit) are read; the
// rest of each artifact's shape is treated as opaque content to be digested.
// ---------------------------------------------------------------------------

interface SnapshotIdentityFields {
  id?: string;
  name?: string;
  schemaVersion?: number;
  generatedAt?: string;
  gitCommit?: string;
}

/** Reads packages/architecture-intelligence/src/types.ts's ArchitectureIntelligence shape: `identity.id`, `identity.name.displayLabel`, and `metadata.{schema_version,generated_at,git_commit}`. */
function parseArchitectureForSnapshot(value: unknown): SnapshotIdentityFields {
  if (!isRecord(value)) return {};
  const identity = isRecord(value.identity) ? value.identity : undefined;
  const name = identity && isRecord(identity.name) ? identity.name : undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  return {
    id: stringField(identity, "id"),
    name: stringField(name, "displayLabel"),
    schemaVersion: numberField(metadata, "schema_version"),
    generatedAt: stringField(metadata, "generated_at"),
    gitCommit: stringField(metadata, "git_commit"),
  };
}

/** Reads packages/capability-intelligence/src/contracts.ts's CapabilityModel shape: `schemaVersion`, `systemIdentity.displayName`, and `generationMetadata.{schema_version,generated_at,git_commit}`. */
function parseCapabilityForSnapshot(value: unknown): SnapshotIdentityFields {
  if (!isRecord(value)) return {};
  const systemIdentity = isRecord(value.systemIdentity) ? value.systemIdentity : undefined;
  const generationMetadata = isRecord(value.generationMetadata) ? value.generationMetadata : undefined;
  return {
    name: stringField(systemIdentity, "displayName"),
    schemaVersion: numberField(value, "schemaVersion") ?? numberField(generationMetadata, "schema_version"),
    generatedAt: stringField(generationMetadata, "generated_at"),
    gitCommit: stringField(generationMetadata, "git_commit"),
  };
}

/** Reads packages/product-intelligence/src/contracts.ts's ProductIdentityModel shape: `schemaVersion`, `identity.displayName`, and `generationMetadata.{schema_version,generated_at,git_commit}`. */
function parseProductForSnapshot(value: unknown): SnapshotIdentityFields {
  if (!isRecord(value)) return {};
  const identity = isRecord(value.identity) ? value.identity : undefined;
  const generationMetadata = isRecord(value.generationMetadata) ? value.generationMetadata : undefined;
  return {
    name: stringField(identity, "displayName"),
    schemaVersion: numberField(value, "schemaVersion") ?? numberField(generationMetadata, "schema_version"),
    generatedAt: stringField(generationMetadata, "generated_at"),
    gitCommit: stringField(generationMetadata, "git_commit"),
  };
}

/** Reads packages/portfolio-intelligence/src/contracts.ts's PortfolioModel shape: `schemaVersion`, `portfolioId`, `displayName`, and `generationMetadata.{schema_version,generated_at}`. */
function parsePortfolioForSnapshot(value: unknown): SnapshotIdentityFields {
  if (!isRecord(value)) return {};
  const generationMetadata = isRecord(value.generationMetadata) ? value.generationMetadata : undefined;
  return {
    id: stringField(value, "portfolioId"),
    name: stringField(value, "displayName"),
    schemaVersion: numberField(value, "schemaVersion") ?? numberField(generationMetadata, "schema_version"),
    generatedAt: stringField(generationMetadata, "generated_at"),
  };
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

export interface BuildIntelligenceSnapshotInput {
  /**
   * Explicit repository identity override. If omitted, the repository id is
   * derived from the architecture artifact's `identity.id` when the
   * architecture artifact is provided; falls back to "unknown-repository"
   * when neither is available (still a pure function of the input, so
   * determinism is preserved).
   */
  repositoryId?: string;
  /** Caller-supplied wall-clock timestamp (e.g. `new Date().toISOString()`); this package never calls Date/Math.random/etc. itself, so its output stays a pure function of its input, matching @rvs/portfolio-intelligence's `generatedAt` input convention (see its index.ts). */
  generatedAt: string;
  /** Already-parsed JSON of `.rvs/cache/architecture-intelligence.json`, if available. */
  architecture?: unknown;
  /** Already-parsed JSON of `.rvs/cache/capability-model.json`, if available. */
  capability?: unknown;
  /** Already-parsed JSON of `.rvs/cache/product-identity-model.json`, if available. */
  product?: unknown;
  /** Already-parsed JSON of `.rvs/cache/portfolio-model.json`, if available. */
  portfolio?: unknown;
}

const DOMAIN_ORDER: GovernanceArtifactKind[] = ["architecture", "capability", "product", "portfolio"];

/**
 * Assembles a deterministic IntelligenceSnapshot from already-loaded artifact
 * objects. Never re-scans a repository and never calls an external model --
 * every field is derived solely from the JSON the caller passes in plus the
 * caller-supplied `generatedAt` timestamp (the one non-content-derived
 * field, excluded from all determinism comparisons per contracts.ts's
 * top-of-file note).
 */
export function buildIntelligenceSnapshot(input: BuildIntelligenceSnapshotInput): IntelligenceSnapshot {
  const architecture = parseArchitectureForSnapshot(input.architecture);
  const capability = parseCapabilityForSnapshot(input.capability);
  const product = parseProductForSnapshot(input.product);
  const portfolio = parsePortfolioForSnapshot(input.portfolio);

  const parsed: Record<GovernanceArtifactKind, SnapshotIdentityFields> = { architecture, capability, product, portfolio };
  const raw: Record<GovernanceArtifactKind, unknown> = {
    architecture: input.architecture,
    capability: input.capability,
    product: input.product,
    portfolio: input.portfolio,
  };

  const artifacts: GovernanceArtifactDigest[] = DOMAIN_ORDER.map((kind) => {
    const value = raw[kind];
    if (value === undefined || value === null) {
      return { artifact: kind, provenance: "unavailable" };
    }
    if (!isRecord(value)) {
      // Present but not a parseable object -- malformed cache content.
      return { artifact: kind, provenance: "partial" };
    }
    return {
      artifact: kind,
      provenance: "complete",
      schema_version: parsed[kind].schemaVersion,
      digest: digestOf(value),
      source_generated_at: parsed[kind].generatedAt,
    };
  });

  const repositoryId = input.repositoryId ?? architecture.id ?? "unknown-repository";
  const gitCommit = architecture.gitCommit ?? capability.gitCommit ?? product.gitCommit;

  const sortedDigestTokens = artifacts
    .filter((artifact): artifact is GovernanceArtifactDigest & { digest: string } => typeof artifact.digest === "string")
    .map((artifact) => `${artifact.artifact}:${artifact.digest}`)
    .sort();

  return {
    schema_version: GOVERNANCE_INTELLIGENCE_SCHEMA_VERSION,
    id: buildSnapshotId(repositoryId, sortedDigestTokens),
    repository_id: architecture.id,
    repository_name: architecture.name,
    portfolio_id: portfolio.id,
    portfolio_name: portfolio.name,
    git_commit: gitCommit,
    artifacts,
    evidence_refs: [],
    generation: { generated_at: input.generatedAt },
  };
}
