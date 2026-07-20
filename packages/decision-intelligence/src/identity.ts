// Decision ID resolution + duplicate/alias detection. Preference order is
// configurable via .rvs/decisions.yml's identity.prefer list; the default
// order is frontmatter id -> recognized ADR/RFC identifier in title/
// filename -> repository-relative path -> content-digest fallback.
//
// `configured_id` is a reserved preference value: decisions.yml has no
// per-file id override field today, so this strategy never resolves. It
// exists so a future config extension can slot in without an identity.ts
// rewrite or a breaking change to the preference vocabulary.

import type { DecisionSourceIssue, DecisionSourceIssueKind, EvidenceRef } from "./contracts.js";
import { buildDecisionId, buildDecisionSourceIssueId } from "./ids.js";

const ADR_IDENTIFIER = /\b(ADR|RFC)[-_]?(\d+)\b/i;

type IdentityStrategy = "configured_id" | "frontmatter.id" | "filename" | "path" | "content_digest";

const DEFAULT_PREFERENCE_ORDER: IdentityStrategy[] = ["frontmatter.id", "filename", "path", "content_digest"];

export interface DecisionIdentityInput {
  repo_relative_path: string;
  frontmatter: Record<string, unknown> | undefined;
  title: string;
  content_digest: string;
}

export type DecisionIdentityBasis = "frontmatter_id" | "title_or_filename_pattern" | "path" | "content_digest";

export interface DecisionIdentityResult {
  id: string;
  basis: DecisionIdentityBasis;
}

export function resolveDecisionIdentity(input: DecisionIdentityInput, preference: string[] | undefined): DecisionIdentityResult {
  const order = filterKnownStrategies(preference && preference.length > 0 ? preference : DEFAULT_PREFERENCE_ORDER);

  for (const strategy of order) {
    const resolved = tryStrategy(strategy, input);
    if (resolved) return resolved;
  }

  // No configured strategy resolved -- content digest is the unconditional
  // last resort, since every discovered file has content to hash.
  return { id: buildDecisionId(input.content_digest), basis: "content_digest" };
}

function tryStrategy(strategy: IdentityStrategy, input: DecisionIdentityInput): DecisionIdentityResult | undefined {
  switch (strategy) {
    case "configured_id":
      return undefined;
    case "frontmatter.id": {
      const raw = input.frontmatter?.["id"];
      if (typeof raw === "string" && raw.trim().length > 0) {
        return { id: buildDecisionId(raw.trim()), basis: "frontmatter_id" };
      }
      return undefined;
    }
    case "filename": {
      const match = input.title.match(ADR_IDENTIFIER) ?? input.repo_relative_path.match(ADR_IDENTIFIER);
      if (match) {
        return { id: buildDecisionId(`${match[1].toUpperCase()}-${match[2]}`), basis: "title_or_filename_pattern" };
      }
      return undefined;
    }
    case "path":
      return { id: buildDecisionId(input.repo_relative_path), basis: "path" };
    case "content_digest":
      return { id: buildDecisionId(input.content_digest), basis: "content_digest" };
    default:
      return undefined;
  }
}

function filterKnownStrategies(values: string[]): IdentityStrategy[] {
  return values.filter(
    (v): v is IdentityStrategy => v === "configured_id" || v === "frontmatter.id" || v === "filename" || v === "path" || v === "content_digest",
  );
}

export interface ResolvedDecisionSourceRecord {
  id: string;
  repo_relative_path: string;
  content_digest: string;
  evidence_refs: EvidenceRef[];
}

/**
 * Same-scan duplicate/alias detection. Exact-ID and case-only collisions are
 * always checked; `id_reused_with_changed_content` additionally needs the
 * prior scan's records (typically the previous cached decision-snapshot.json)
 * -- when `priorRecords` is omitted, that one issue kind is simply never
 * reported, which is correct for a first-ever `rvs decisions analyze` run.
 */
export function detectDecisionIdentityIssues(
  records: ResolvedDecisionSourceRecord[],
  priorRecords: ResolvedDecisionSourceRecord[] = [],
): DecisionSourceIssue[] {
  const issues: DecisionSourceIssue[] = [];
  const reportedPaths = new Set<string>();

  const byExactId = groupBy(records, (r) => r.id);
  for (const [id, group] of byExactId) {
    if (group.length < 2) continue;
    const paths = sortedPaths(group);
    issues.push(buildIssue("multiple_files_claim_one_id", paths, `${group.length} decision documents resolve to the same id "${id}".`, group));
    paths.forEach((p) => reportedPaths.add(p));
  }

  const byLowerId = groupBy(records, (r) => r.id.toLowerCase());
  for (const [, group] of byLowerId) {
    if (group.length < 2) continue;
    const distinctExactIds = new Set(group.map((r) => r.id));
    if (distinctExactIds.size < 2) continue; // already reported as exact-id collision above
    const paths = sortedPaths(group);
    issues.push(buildIssue("duplicate_id_case_only", paths, `${group.length} decision documents resolve to the same id differing only by case.`, group));
  }

  const byPath = groupBy([...records, ...priorRecords], (r) => r.repo_relative_path);
  for (const [path, group] of byPath) {
    const distinctIds = new Set(group.map((r) => r.id));
    if (distinctIds.size < 2) continue;
    const current = records.find((r) => r.repo_relative_path === path);
    const prior = priorRecords.find((r) => r.repo_relative_path === path);
    if (!current || !prior || current.content_digest === prior.content_digest) continue;
    issues.push(
      buildIssue(
        "id_reused_with_changed_content",
        [path],
        `The document at "${path}" changed content and now resolves to a different id than in the prior scan.`,
        [current],
      ),
    );
  }

  return issues;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function sortedPaths(records: ResolvedDecisionSourceRecord[]): string[] {
  return [...new Set(records.map((r) => r.repo_relative_path))].sort();
}

function buildIssue(kind: DecisionSourceIssueKind, affectedPaths: string[], detail: string, source: ResolvedDecisionSourceRecord[]): DecisionSourceIssue {
  return {
    id: buildDecisionSourceIssueId(kind, [...affectedPaths].sort()),
    kind,
    affected_paths: affectedPaths,
    detail,
    evidence_refs: source.flatMap((r) => r.evidence_refs),
  };
}
