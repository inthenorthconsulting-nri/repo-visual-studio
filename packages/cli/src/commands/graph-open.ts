import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Logger } from "@rvs/core";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { GOVERNANCE_OUTPUT_FILES } from "@rvs/governance-intelligence";
import type { GovernanceFinding } from "@rvs/governance-intelligence";
import { DECISION_OUTPUT_FILES } from "@rvs/decision-intelligence";
import type { ArchitectureDecision } from "@rvs/decision-intelligence";
import { DETAIL_MODES, VISUAL_AUDIENCES } from "@rvs/visual-intelligence";
import type { DetailMode, VisualAudience, VisualDecisionStatus } from "@rvs/visual-intelligence";
import { buildExplorerArtifact, buildExplorerModel } from "@rvs/visual-explorer";
import type { ExplorerArtifact, ExplorerDecisionOverlay, ExplorerSeverityOverlay } from "@rvs/visual-explorer";
import { readGraphCachedJson } from "../graph-cache.js";
import { deliverVerifiedArtifact, resolveDeliveryProfile } from "../visual-delivery.js";
import type { VerifiedDeliveryOptions } from "../visual-delivery.js";
import { readGovernanceCachedJsonOptional } from "../governance-cache.js";
import { readDecisionCachedJsonOptional } from "../decision-cache.js";

// `rvs graph open` -- writes the interactive architecture explorer.
//
// It writes a file and stops. No server is started, no port is opened, no
// browser is launched, nothing watches for changes: the reader opens the file
// when they want to, from the filesystem, and it works with the network
// unplugged. A command that quietly left a process listening would be a
// different and much larger thing than "render what is already cached".
//
// Everything it draws is already on disk. This command reads caches, adapts
// them, and renders; it runs no analysis and establishes no fact.

export interface GraphOpenOptions extends VerifiedDeliveryOptions {
  output?: string;
  audience?: string;
  detail?: string;
  focus?: string[];
}

const DEFAULT_OUTPUT = ".rvs/out/architecture-explorer.html";

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

/**
 * A decision's status in the visual vocabulary.
 *
 * Only the statuses that exist under the same name in both vocabularies are
 * carried across. `draft`, `under_review` and `withdrawn` have no visual
 * equivalent, and mapping them onto a neighbour -- `draft` as `proposed`, say
 * -- would be this command inventing a decision status that
 * @rvs/decision-intelligence never assigned. They become `unknown`, and the
 * command says how many did.
 */
const VISUAL_DECISION_STATUSES = new Set<string>([
  "proposed",
  "accepted",
  "rejected",
  "deprecated",
  "superseded",
]);

function visualStatus(status: string): VisualDecisionStatus {
  return VISUAL_DECISION_STATUSES.has(status) ? (status as VisualDecisionStatus) : "unknown";
}

/**
 * The worst severity recorded against each entity.
 *
 * A finding is attached to every entity it names, and one entity can be named
 * by several. Showing the most severe is the only choice that cannot mislead:
 * an entity carrying both an advisory note and a blocking finding must not
 * read as advisory.
 */
function severityOverlays(findings: readonly GovernanceFinding[]): ExplorerSeverityOverlay[] {
  const rank: Record<ExplorerSeverityOverlay["severity"], number> = {
    blocking: 0,
    review_required: 1,
    advisory: 2,
    informational: 3,
  };
  const worst = new Map<string, ExplorerSeverityOverlay["severity"]>();
  for (const finding of findings) {
    for (const entityId of finding.affected_entity_ids) {
      const current = worst.get(entityId);
      if (current === undefined || rank[finding.severity] < rank[current]) worst.set(entityId, finding.severity);
    }
  }
  return [...worst.entries()]
    .map(([entity_id, severity]) => ({ entity_id, severity }))
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1));
}

export async function runGraphOpenCommand(
  repoRoot: string,
  opts: GraphOpenOptions,
  logger: Logger,
): Promise<void> {
  const nodes = readGraphCachedJson<KnowledgeNode[]>(repoRoot, "nodes.json");
  const edges = readGraphCachedJson<KnowledgeEdge[]>(repoRoot, "edges.json");

  // Governance and decision intelligence are optional inputs: a repository
  // that has never run them still has an architecture worth exploring, and
  // refusing to draw one until every upstream layer had run would make this
  // command useless exactly where it is most useful.
  const findings =
    readGovernanceCachedJsonOptional<GovernanceFinding[]>(repoRoot, GOVERNANCE_OUTPUT_FILES.governanceFindings) ?? [];
  // `decisions.json` is an object with a `decisions` array in it, not a bare
  // array. Every other reader of this file -- graph-build, graph-compare,
  // graph-impact, graph-plan-change, graph-review -- already read it that
  // way; this command alone read it as an array and threw
  // "decisions.map is not a function" in any repository that had actually run
  // decision intelligence. The command worked only where the file was absent,
  // which is exactly where its output matters least.
  const decisionsFile = readDecisionCachedJsonOptional<{ decisions: ArchitectureDecision[] }>(
    repoRoot,
    DECISION_OUTPUT_FILES.decisions,
  );
  const decisions = Array.isArray(decisionsFile?.decisions) ? decisionsFile.decisions : [];

  const decisionOverlays: ExplorerDecisionOverlay[] = decisions
    .map((decision) => ({ entity_id: decision.id, status: visualStatus(decision.decision_status) }))
    .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1));
  const unmapped = decisions.filter((d) => !VISUAL_DECISION_STATUSES.has(d.decision_status));

  const focus = [...new Set(opts.focus ?? [])].sort();
  const model = buildExplorerModel({
    nodes,
    edges,
    severities: severityOverlays(findings),
    decisions: decisionOverlays,
    focal_entity_ids: focus,
  });

  const audience = parseAudience(opts.audience);
  const detail = parseDetail(opts.detail);
  const artifact = buildExplorerArtifact({
    producer: "rvs graph open",
    subject: "Architecture",
    model,
    audience,
    detail_mode: detail,
    focal_entity_ids: focus,
    caption: `Interactive architecture explorer · ${audience} · ${detail} detail`,
  });

  const outputPath = resolve(repoRoot, opts.output ?? DEFAULT_OUTPUT);
  const coverage = artifact.document.coverage;

  // Two routes, and the default one is untouched. Without `--verified` this
  // command writes its file exactly as it always has -- the same path, the
  // same bytes, the same exit code -- because a rendering command that
  // silently started refusing to write would break every caller that already
  // depends on it. `--verified` is the reader asking for the gate.
  if (opts.verified === true) {
    const profile = resolveDeliveryProfile("architecture_explorer", opts.profile);
    logger.info(
      `Verifying a candidate for ${relative(repoRoot, outputPath)} against ${profile.id} (${coverage.source_entity_ids.length} entities, candidate digest ${artifact.digest.slice(0, 12)}).`,
    );
    await deliverVerifiedArtifact({
      repoRoot,
      logger,
      artifact_type: "architecture_explorer",
      profile,
      target_path: outputPath,
      html: artifact.html,
      document: artifact.document,
      producer: "rvs graph open",
      critical_paths: model.paths.filter((p) => p.critical).map((p) => ({ id: p.id, node_ids: p.node_ids })),
      now: new Date().toISOString(),
    });
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, artifact.html);
    logger.info(
      `Wrote ${relative(repoRoot, outputPath)} (${coverage.source_entity_ids.length} entities, digest ${artifact.digest.slice(0, 12)}).`,
    );
  }

  reportComposition(artifact, findings, decisions, unmapped, logger);
  // Stated rather than done. Opening a browser is an action on the reader's
  // machine that they did not ask this command to take.
  logger.info(`  Open it directly from the filesystem; it needs no server and no network.`);
}

/** What was drawn and what was left out. The same account either route produces. */
function reportComposition(
  artifact: ExplorerArtifact,
  findings: readonly GovernanceFinding[],
  decisions: readonly ArchitectureDecision[],
  unmapped: readonly ArchitectureDecision[],
  logger: Logger,
): void {
  const coverage = artifact.document.coverage;
  logger.info(
    `  ${coverage.primary_entity_ids.length} in the overview, ${coverage.detail_entity_ids.length} in detail views, ${coverage.collapsed_entity_ids.length} behind a collapsed group, ${coverage.hidden_entity_ids.length} not drawn.`,
  );
  if (artifact.document.receipt_required) {
    logger.info(`  Fidelity receipt: ${artifact.document.receipt.reason_codes.join(", ")}.`);
  }
  if (findings.length === 0) {
    logger.info("  No cached governance findings; the governance lens will bring nothing forward.");
  }
  if (decisions.length === 0) {
    logger.info("  No cached decisions; the decisions lens will bring nothing forward.");
  } else if (unmapped.length > 0) {
    logger.info(
      `  ${unmapped.length} decision(s) carry a status with no visual equivalent (${[...new Set(unmapped.map((d) => d.decision_status))].sort().join(", ")}); shown as "unknown" rather than mapped onto a neighbouring status.`,
    );
  }
  for (const finding of artifact.document.validation) {
    logger.info(`  [${finding.code}] ${finding.message}`);
  }
}
