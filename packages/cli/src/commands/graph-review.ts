import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import {
  assessSnapshotPairCompatibility,
  buildDecisionStateLookup,
  diffGraphs,
  isComparableStatus,
  KNOWLEDGE_GRAPH_OUTPUT_FILES,
  uncomparableDomains,
} from "@rvs/knowledge-graph";
import type {
  DecisionImpactEntry,
  GraphSnapshotState,
  ImpactResult,
  KnowledgeEdge,
  KnowledgeNode,
} from "@rvs/knowledge-graph";
import { GOVERNANCE_OUTPUT_FILES } from "@rvs/governance-intelligence";
import type { ArchitectureChangeSet, GovernanceFinding } from "@rvs/governance-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { ArchitectureDecision, DecisionAssumption } from "@rvs/decision-intelligence";
import { DETAIL_MODES, VISUAL_AUDIENCES } from "@rvs/visual-intelligence";
import type { DetailMode, MotionPlan, VisualAudience } from "@rvs/visual-intelligence";
import { buildChangeReviewArtifact, buildReviewAssembly, isReviewLens } from "@rvs/visual-change-review";
import type {
  ChangeReviewArtifact,
  ChangeReviewSourceInput,
  ReviewEntityLink,
  ReviewLens,
  ReviewSnapshot,
  UpstreamImpactPath,
  UpstreamUnresolvedLink,
} from "@rvs/visual-change-review";
import { buildMotionPlan } from "@rvs/visual-intelligence";
import { upstreamFromChangeReview } from "@rvs/visual-delivery";
import { readGraphCachedJsonOptional } from "../graph-cache.js";
import { deliverVerifiedArtifact, resolveDeliveryProfile } from "../visual-delivery.js";
import type { VerifiedDeliveryOptions } from "../visual-delivery.js";
import { readGovernanceCachedJsonOptional } from "../governance-cache.js";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";
import { readGraphSnapshotDir } from "../snapshot-dir.js";

// `rvs graph review` -- the before / delta / after architecture change review.
//
// The whole of this command is: read two snapshots, ask the *existing* compare
// engine what changed, collect the governance, decision and impact truth that
// is already cached, hand all of it to the visual layer, and write one file.
//
// It computes no difference of its own. `diffGraphs` is the same function
// `rvs graph compare` calls, with the same inputs, so the two commands cannot
// disagree about what changed -- a review that showed a different set of
// changes than the comparison it claims to be visualising would be worse than
// no review.
//
// Nothing is posted, commented, approved or blocked. The command writes a file
// and exits.

export interface GraphReviewOptions extends VerifiedDeliveryOptions {
  from?: string;
  to?: string;
  output?: string;
  detail?: string;
  audience?: string;
  lens?: string;
  motion?: string;
}

const DEFAULT_OUTPUT = "artifacts/visuals/change-review.html";

function parseAudience(value: string | undefined): VisualAudience {
  if (value === undefined) return "engineering";
  if ((VISUAL_AUDIENCES as readonly string[]).includes(value)) return value as VisualAudience;
  throw new Error(`Invalid --audience "${value}". Expected one of: ${VISUAL_AUDIENCES.join(", ")}.`);
}

function parseDetail(value: string | undefined): DetailMode {
  if (value === undefined) return "balanced";
  if ((DETAIL_MODES as readonly string[]).includes(value)) return value as DetailMode;
  throw new Error(`Invalid --detail "${value}". Expected one of: ${DETAIL_MODES.join(", ")}.`);
}

function parseLens(value: string | undefined): ReviewLens {
  if (value === undefined) return "architecture";
  if (isReviewLens(value)) return value;
  throw new Error(
    `Invalid --lens "${value}". Expected one of: architecture, capabilities, governance, decisions, impact, unresolved.`,
  );
}

function parseMotion(value: string | undefined): "none" | "compare" {
  if (value === undefined) return "compare";
  if (value === "none" || value === "compare") return value;
  throw new Error(`Invalid --motion "${value}". Expected "none" or "compare".`);
}

/** A knowledge-graph state as the review's structural intake. No field is renamed and none is invented. */
function reviewSnapshot(state: GraphSnapshotState): ReviewSnapshot {
  return {
    snapshot_id: state.snapshotId,
    nodes: state.nodes.map((node: KnowledgeNode) => ({
      id: node.id,
      node_type: node.node_type,
      label: node.label,
      source_entity_id: node.source_entity_id,
      resolution_status: node.resolution_status,
      confidence: node.confidence,
      evidence_refs: node.evidence_refs.map((ref) => ({
        source_artifact: ref.source_artifact,
        ...(ref.path === undefined ? {} : { path: ref.path }),
        ...(ref.lines === undefined ? {} : { lines: ref.lines }),
      })),
    })),
    edges: state.edges.map((edge: KnowledgeEdge) => ({
      id: edge.id,
      edge_type: edge.edge_type,
      from_node_id: edge.from_node_id,
      to_node_id: edge.to_node_id,
      resolution_status: edge.resolution_status,
      detail: edge.detail,
    })),
  };
}

/**
 * Impact results as reviewable routes.
 *
 * Only depth-1 reach becomes a drawn route. `impact-results.json` records
 * *that* a deeper entity was reached and at what depth, but not the entities
 * in between -- so drawing origin → entity for a depth-4 reach would draw a
 * direct relationship that does not exist, which is exactly the "adjacency is
 * not causality" mistake in reverse. Deeper reach is still reported, through
 * the blast radius the change already carries, and the command says how many
 * routes it declined to draw.
 */
function impactPaths(results: readonly ImpactResult[]): { paths: UpstreamImpactPath[]; deeper: number } {
  const paths: UpstreamImpactPath[] = [];
  let deeper = 0;
  for (const result of results) {
    const origin = result.query.entity_node_id;
    for (const finding of [...result.directly_affected, ...result.transitively_affected]) {
      if (finding.depth !== 1) {
        deeper += 1;
        continue;
      }
      paths.push({
        id: finding.path_id ?? `${result.id}:${finding.node_id}`,
        origin_entity_id: origin,
        entity_ids: [origin, finding.node_id],
        artifact_id: KNOWLEDGE_GRAPH_OUTPUT_FILES.impactResults,
        ...(result.truncated ? { truncated: true } : {}),
        boundary: `downstream traversal, max depth ${result.query.max_depth}`,
        evidence_refs: result.evidence_refs.map((ref) => ({
          source_artifact: ref.source_artifact,
          ...(ref.path === undefined ? {} : { path: ref.path }),
          ...(ref.lines === undefined ? {} : { lines: ref.lines }),
        })),
      });
    }
  }
  return { paths: paths.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), deeper };
}

/**
 * Relationships the graph recorded but could not resolve.
 *
 * Read from the edges themselves rather than derived: an edge whose
 * resolution status is anything but `resolved` is upstream saying it knows a
 * relationship exists and does not know where it lands. That is an open
 * question, and the review's job is to show it as one instead of letting it
 * pass as a silence.
 */
function unresolvedLinks(state: GraphSnapshotState): UpstreamUnresolvedLink[] {
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  return state.edges
    .filter((edge) => edge.resolution_status !== "resolved")
    .map((edge) => {
      const from = nodeById.get(edge.from_node_id);
      return {
        id: edge.id,
        from_entity_id: from?.source_entity_id ?? edge.from_node_id,
        detail: `${edge.edge_type} relationship recorded as "${edge.resolution_status}": ${edge.detail}`,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Capability and product links, copied from the impact results that established them. */
function entityLinks(results: readonly ImpactResult[]): ReviewEntityLink[] {
  const byEntity = new Map<string, { capabilities: Set<string>; products: Set<string> }>();
  for (const result of results) {
    const entry = byEntity.get(result.query.entity_node_id) ?? {
      capabilities: new Set<string>(),
      products: new Set<string>(),
    };
    for (const id of result.capabilities_affected) entry.capabilities.add(id);
    for (const id of result.products_affected) entry.products.add(id);
    byEntity.set(result.query.entity_node_id, entry);
  }
  return [...byEntity.entries()]
    .map(([entity_id, entry]) => ({
      entity_id,
      capability_ids: [...entry.capabilities].sort(),
      product_ids: [...entry.products].sort(),
    }))
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1));
}

/**
 * Everything the review reads, gathered once.
 *
 * `rvs graph review` and `rvs export change-review-summary` are two renderings
 * of one answer, so they read through this single function: two commands that
 * collected their own inputs could disagree about what changed, and a summary
 * that disagreed with the review it summarises would be worse than no summary.
 */
export interface ChangeReviewCollection {
  before: GraphSnapshotState;
  after: GraphSnapshotState;
  compatibility: { status: string; reasons: string[] };
  source: ChangeReviewSourceInput;
  findingCount: number;
  decisionImpactCount: number;
  impactResultCount: number;
  /** Recorded impacts that reach beyond depth 1, which the review declines to draw as routes. */
  deeperImpacts: number;
  sourceArtifactIds: string[];
}

export function collectChangeReviewSource(repoRoot: string, from: string, to: string): ChangeReviewCollection {
  const before = readGraphSnapshotDir(repoRoot, from);
  const after = readGraphSnapshotDir(repoRoot, to);

  // Comparability is decided before anything is drawn. Two snapshots that are
  // not comparable produce differences that are artefacts of the mismatch, and
  // a review of those differences would be a review of nothing.
  const compatibility = assessSnapshotPairCompatibility(before.snapshot, after.snapshot);
  if (!isComparableStatus(compatibility.status)) {
    throw new Error(
      `These snapshots are not comparable (${compatibility.status}): ${compatibility.reasons.join(" ")} ` +
        `No review was written; a difference between two things that cannot be compared is not a change.`,
    );
  }

  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(
    repoRoot,
    DECISION_OUTPUT_FILES.decisions,
  );
  const rawAssumptions = readDecisionCachedJsonOptional<DecisionAssumption[]>(
    repoRoot,
    DECISION_OUTPUT_FILES.assumptions,
  );
  const decisionStateLookup = buildDecisionStateLookup(
    decisionsFile,
    rawAssumptions ? { assumptions: rawAssumptions } : undefined,
  );

  // The same call `rvs graph compare` makes. Not a second diff engine, not a
  // second set of options: the same function over the same two snapshots.
  const changeSet = diffGraphs(before, after, { decisionStateLookup });

  const findings =
    readGovernanceCachedJsonOptional<GovernanceFinding[]>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceFindings) ?? [];
  const architectureChanges = readGovernanceCachedJsonOptional<ArchitectureChangeSet>(
    repoRoot,
    GOVERNANCE_OUTPUT_FILES.architectureChanges,
  );
  const decisionImpacts =
    readGraphCachedJsonOptional<DecisionImpactEntry[]>(repoRoot, KNOWLEDGE_GRAPH_OUTPUT_FILES.decisionImpact) ?? [];
  const impactResults =
    readGraphCachedJsonOptional<ImpactResult[]>(repoRoot, KNOWLEDGE_GRAPH_OUTPUT_FILES.impactResults) ?? [];

  const { paths, deeper } = impactPaths(impactResults);

  const source: ChangeReviewSourceInput = {
    before: reviewSnapshot(before),
    after: reviewSnapshot(after),
    compatibility: { status: compatibility.status, reasons: compatibility.reasons },
    graph_changes: changeSet,
    governance_changes: architectureChanges?.changes ?? [],
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      statement: finding.statement,
      affected_entity_ids: finding.affected_entity_ids,
      human_review_required: finding.human_review_required,
      ...(finding.blast_radius === undefined ? {} : { blast_radius: finding.blast_radius }),
      evidence_refs: finding.evidence_refs.map((ref) => ({
        source_artifact: ref.source_artifact,
        ...(ref.path === undefined ? {} : { path: ref.path }),
        ...(ref.lines === undefined ? {} : { lines: ref.lines }),
      })),
    })),
    decision_impacts: decisionImpacts.map((entry) => ({
      id: entry.id,
      decision_node_id: entry.decision_node_id,
      target_entity_node_id: entry.target_entity_node_id,
      state: entry.state,
      detail: entry.detail,
      evidence_refs: entry.evidence_refs.map((ref) => ({
        source_artifact: ref.source_artifact,
        ...(ref.path === undefined ? {} : { path: ref.path }),
        ...(ref.lines === undefined ? {} : { lines: ref.lines }),
      })),
    })),
    impact_paths: paths,
    unresolved_links: unresolvedLinks(after),
    entity_links: entityLinks(impactResults),
    unavailable_domains: uncomparableDomains(before.snapshot, after.snapshot),
  };

  return {
    before,
    after,
    compatibility: { status: compatibility.status, reasons: compatibility.reasons },
    source,
    findingCount: findings.length,
    decisionImpactCount: decisionImpacts.length,
    impactResultCount: impactResults.length,
    deeperImpacts: deeper,
    sourceArtifactIds: [
      KNOWLEDGE_GRAPH_OUTPUT_FILES.graphChanges,
      ...(findings.length > 0 ? [GOVERNANCE_OUTPUT_FILES.governanceFindings] : []),
      ...(architectureChanges === undefined ? [] : [GOVERNANCE_OUTPUT_FILES.architectureChanges]),
      ...(decisionImpacts.length > 0 ? [KNOWLEDGE_GRAPH_OUTPUT_FILES.decisionImpact] : []),
      ...(impactResults.length > 0 ? [KNOWLEDGE_GRAPH_OUTPUT_FILES.impactResults] : []),
    ],
  };
}

export async function runGraphReviewCommand(
  repoRoot: string,
  opts: GraphReviewOptions,
  logger: Logger,
): Promise<void> {
  if (!opts.from || !opts.to) {
    throw new Error("`rvs graph review` requires --from <snapshot-dir> and --to <snapshot-dir>.");
  }

  const {
    before,
    after,
    compatibility,
    source,
    findingCount,
    impactResultCount,
    deeperImpacts: deeper,
    sourceArtifactIds,
  } = collectChangeReviewSource(repoRoot, opts.from, opts.to);

  const assembly = buildReviewAssembly(source);
  const audience = parseAudience(opts.audience);
  const detail = parseDetail(opts.detail);
  const lens = parseLens(opts.lens);
  const motion = parseMotion(opts.motion);

  const artifact = buildChangeReviewArtifact({
    producer: "rvs graph review",
    subject: "Architecture change review",
    assembly,
    audience,
    detail_mode: detail,
    initial_lens: lens,
    motion,
    caption: `${before.snapshotId} → ${after.snapshotId} · ${audience} · ${detail} detail`,
    source_artifact_ids: sourceArtifactIds,
  });

  const outputPath = resolve(repoRoot, opts.output ?? DEFAULT_OUTPUT);
  const coverage = artifact.document.coverage;

  // The default route is untouched: without `--verified` this command writes
  // its file exactly as it always has. `--verified` routes the same bytes
  // through the delivery gate instead, and writes nothing to the target
  // unless every check the profile requires passed.
  if (opts.verified === true) {
    const profile = resolveDeliveryProfile("change_review", opts.profile);
    const plan = comparePlan(artifact, motion);
    logger.info(
      `Verifying a candidate for ${relative(repoRoot, outputPath)} against ${profile.id} (${assembly.changes.length} changes, candidate digest ${artifact.digest.slice(0, 12)}).`,
    );
    await deliverVerifiedArtifact({
      repoRoot,
      logger,
      artifact_type: "change_review",
      profile,
      target_path: outputPath,
      html: artifact.html,
      document: artifact.document,
      producer: "rvs graph review",
      critical_paths: assembly.visual.paths
        .filter((p) => p.critical)
        .map((p) => ({ id: p.id, node_ids: p.node_ids })),
      source_snapshot_ids: [before.snapshotId, after.snapshotId],
      change_review_model_id: artifact.model.id,
      // The review's own findings, produced by `validateChangeReview` inside
      // `buildChangeReviewArtifact` over a model that no longer exists once
      // the HTML is on disk. They travel with the candidate rather than being
      // re-derived, and nothing downstream re-grades them.
      upstream_findings: upstreamFromChangeReview(artifact.findings),
      ...(plan === undefined ? {} : { motion: plan }),
      now: new Date().toISOString(),
    });
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, artifact.html);
    logger.info(
      `Wrote ${relative(repoRoot, outputPath)} (${assembly.changes.length} changes, digest ${artifact.digest.slice(0, 12)}).`,
    );
  }

  logger.info(
    `  ${before.snapshotId} → ${after.snapshotId}, compatibility "${compatibility.status}".`,
  );
  logger.info(
    `  ${coverage.primary_entity_ids.length} entities in the review, ${coverage.detail_entity_ids.length} in detail views, ${coverage.collapsed_entity_ids.length} behind a collapsed group, ${coverage.hidden_entity_ids.length} not drawn.`,
  );
  if (assembly.changes.length === 0) {
    logger.info(`  No material graph changes were detected between these compatible snapshots.`);
  }
  if (compatibility.status === "partial") {
    logger.info(`  Partial comparison: ${compatibility.reasons.join(" ")}`);
  }
  if (assembly.unavailable_domains.length > 0) {
    logger.info(
      `  Not comparable, so unreported either way: ${assembly.unavailable_domains.join(", ")}. This is not "no change" in those domains.`,
    );
  }
  if (impactResultCount === 0) {
    logger.info(
      `  No cached impact results; downstream consumer reach is unresolved for every change. Run \`rvs graph impact\` for the entities you care about.`,
    );
  } else if (deeper > 0) {
    logger.info(
      `  ${deeper} recorded impact(s) reach beyond depth 1; impact-results.json does not record the entities in between, so those routes are not drawn.`,
    );
  }
  if (findingCount === 0) {
    logger.info(`  No cached governance findings; the governance lens will bring nothing forward.`);
  }
  reportReview(artifact, logger);
  logger.info(`  Open it directly from the filesystem; it needs no server and no network.`);
  logger.info(`  This review is read-only: nothing was posted, approved, or blocked.`);
}

/** The fidelity receipt and every finding the review raised. The same account either route produces. */
function reportReview(artifact: ChangeReviewArtifact, logger: Logger): void {
  if (artifact.document.receipt_required) {
    logger.info(`  Fidelity receipt: ${artifact.document.receipt.reason_codes.join(", ")}.`);
  }
  for (const finding of artifact.findings) {
    logger.info(`  [${finding.code}] ${finding.message}`);
  }
  for (const finding of artifact.document.validation) {
    logger.info(`  [${finding.code}] ${finding.message}`);
  }
}

/**
 * The motion plan the page will really build if a reader presses "Animate
 * what changed".
 *
 * Reconstructed here from the same inputs the runtime uses -- the change
 * list in its own order, deduplicated, and the grammar the document drew --
 * so verification measures the sequence that will actually play rather than
 * an idealised one. `--motion none` produces no plan and no finding: a review
 * that does not move is a valid review, not a degraded one.
 */
function comparePlan(
  artifact: ChangeReviewArtifact,
  motion: "none" | "compare",
): { plan: MotionPlan; known_target_ids: readonly string[] } | undefined {
  if (motion === "none") return undefined;
  // Drawn entities only, in the change list's order, exactly as the runtime
  // sequences them. A change can name an edge, and an edge is not something
  // the drawing gives a group to emphasise, so the runtime skips it; if this
  // reconstruction did not, verification would grade a sequence the page will
  // never play and reject the review for a step that does not exist.
  const drawn = new Set(artifact.reachable_entity_ids);
  const sequence: string[] = [];
  const seen = new Set<string>();
  for (const change of artifact.model.changes) {
    if (seen.has(change.entity_id)) continue;
    seen.add(change.entity_id);
    if (!drawn.has(change.entity_id)) continue;
    sequence.push(change.entity_id);
  }
  return {
    plan: buildMotionPlan({
      mode: "compare",
      grammar: artifact.document.spec.visual_grammar,
      sequence,
      destination_announcement:
        sequence.length === 0
          ? "No entity changed between these snapshots."
          : `Compared ${sequence.length} changed entities across before, delta and after.`,
    }),
    known_target_ids: artifact.reachable_entity_ids,
  };
}
