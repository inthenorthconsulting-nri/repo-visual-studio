import type { ArchIntelWarning, ArchitectureIntelligence, InferredStatement } from "@rvs/architecture-intelligence";
import { NARRATIVE_PROFILES } from "@rvs/architecture-intelligence";
import type { RepositoryModel } from "@rvs/repository-model";
import type { ArchitectureIntelligenceScene, ArchitectureSceneKind, VisualDoc } from "@rvs/visualdoc-schema";

// Pure, deterministic checks over an already-synthesized ArchitectureIntelligence
// artifact, the VisualDoc built from it, and (for the two label-integrity
// checks) the already-rendered deck HTML string. No I/O, no Playwright/DOM —
// sibling to workflow-checks.ts/terraform-checks.ts. The label-integrity
// checks deliberately re-derive their expectation from the artifact and then
// search the *rendered* HTML for it, rather than trusting the renderer code
// path that is supposed to add the qualifier — an independent regression
// safety net, mirroring how checks.ts audits the real DOM instead of trusting
// the renderer.
//
// Scope limitation (intentional, not silently hidden): the three genuinely
// SVG-diagram scene kinds (system-context, logical-architecture,
// architecture-flow) are excluded from the per-kind statement/word-budget
// checks below. Their content is a rendered SVG box diagram, not synthesized
// prose, and is already covered by checks.ts's overflow/min-font-size checks
// at the DOM tier. boundary-map is NOT excluded here despite also appearing
// in the four-diagram-kind list elsewhere (e.g. the DOM-tier scope note
// above) — it renders as an .arch-card grid of boundary descriptions, the
// same prose mechanism capability-map/workflow-family-map use, so its
// synthesized statements are included below like any other narrated scene.

// The sole Level-1-only narrative profile's scene sequence defines the set of
// scene kinds this file treats as "Level 1 Executive" — independent of which
// profile actually produced a given VisualDoc, so the check still applies to
// (e.g.) an architecture-review deck's executive-title scene.
const LEVEL1_KINDS = new Set<ArchitectureSceneKind>(NARRATIVE_PROFILES["executive-overview"].sceneSequence);

// decision-or-next-step renders artifact.questions[].question — open
// questions ARE deliberately unresolved by design, so they are exempt from
// the unresolved-claim check (flagging them would be flagging the feature).

const WORD_BUDGETS: Partial<Record<ArchitectureSceneKind, number>> = {
  "executive-title": 40,
  "executive-summary": 120,
  "problem-and-response": 120,
  "platform-responsibilities": 150,
  "capability-map": 150,
  "boundary-map": 150,
  "operating-model": 180,
  outcomes: 120,
  "risk-summary": 150,
  "risk-and-dependency-summary": 180,
  "workflow-family-map": 150,
  "repository-map": 250,
  "evidence-confidence": 100,
  "decision-or-next-step": 120,
};

/**
 * The synthesized statements a rendered scene of this kind draws from,
 * mirroring @rvs/renderer-html's scenes/architecture-intelligence/{text,maps}.ts
 * field-by-field. Returns undefined for diagram kinds and kinds that don't
 * render InferredStatement text (repository-map, evidence-confidence,
 * decision-or-next-step) — callers skip those, an intentional, documented
 * scope limit rather than a silent gap.
 */
function statementsForKind(scene: ArchitectureIntelligenceScene, artifact: ArchitectureIntelligence): InferredStatement[] | undefined {
  const focusIds = new Set(scene.focus_ids);
  const applyFocus = <T extends { id: string }>(items: T[]): T[] => (focusIds.size === 0 ? items : items.filter((i) => focusIds.has(i.id)));

  switch (scene.kind) {
    case "executive-title":
      return [artifact.identity.oneLineDescription];
    case "executive-summary":
      return [artifact.purpose.problemStatement, ...artifact.capabilityDomains.map((d) => d.summary)].slice(0, 6);
    case "problem-and-response":
      return [artifact.purpose.problemStatement, ...artifact.purpose.scopeBoundaries];
    case "platform-responsibilities":
      return applyFocus(artifact.responsibilities).map((r) => r.description);
    case "capability-map":
      return applyFocus(artifact.capabilityDomains).map((d) => d.summary);
    case "operating-model":
      return [
        ...artifact.operatingModel.deploymentEnvironments,
        ...artifact.operatingModel.releaseProcess,
        ...artifact.operatingModel.observability,
        ...artifact.operatingModel.approvalGates,
      ];
    case "outcomes":
      return applyFocus(artifact.outcomes).map((o) => o.statement);
    case "risk-summary":
      return applyFocus(artifact.risks).map((r) => r.description);
    case "risk-and-dependency-summary":
      return [...applyFocus(artifact.risks).map((r) => r.description), ...artifact.dependencies.map((d) => d.description)];
    case "workflow-family-map":
      return applyFocus(artifact.workflowFamilies).map((f) => f.description);
    case "boundary-map":
      return applyFocus(artifact.boundaries).map((b) => b.description);
    case "repository-map":
    case "evidence-confidence":
    case "decision-or-next-step":
      return undefined;
    case "system-context":
    case "logical-architecture":
    case "architecture-flow":
      return undefined;
    default: {
      const exhaustive: never = scene.kind;
      throw new Error(`Unhandled architecture scene kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function architectureIntelligenceScenes(doc: VisualDoc): ArchitectureIntelligenceScene[] {
  return doc.scenes.filter((s): s is ArchitectureIntelligenceScene => s.type === "architecture-intelligence");
}

/** Maps each scene id to its rendered HTML block (`.scene-inner` plus its sibling citations footer). Sections never nest, so a single non-greedy scan is safe. */
function extractSceneHtmlById(html: string): Map<string, string> {
  const byId = new Map<string, string>();
  const re = /<section class="scene"[^>]*data-scene-id="([^"]*)"[^>]*>([\s\S]*?)<\/section>/g;
  for (const m of html.matchAll(re)) byId.set(m[1], m[2]);
  return byId;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Level 1 Executive narration must never present an unresolved statement without its "Unconfirmed:" qualifier visibly rendered. */
export function checkUnresolvedClaimsInLevel1(doc: VisualDoc, artifact: ArchitectureIntelligence, html: string): ArchIntelWarning[] {
  const warnings: ArchIntelWarning[] = [];
  const sceneHtmlById = extractSceneHtmlById(html);
  for (const scene of architectureIntelligenceScenes(doc)) {
    if (!LEVEL1_KINDS.has(scene.kind) || scene.kind === "decision-or-next-step") continue;
    const statements = statementsForKind(scene, artifact);
    if (!statements) continue;
    const sceneHtml = sceneHtmlById.get(scene.id);
    if (sceneHtml === undefined) continue;
    for (const statement of statements) {
      if (statement.inference !== "unresolved") continue;
      const expected = escapeHtml(`Unconfirmed: ${statement.value}`);
      if (!sceneHtml.includes(expected)) {
        warnings.push({
          code: "ARCH_INTEL_UNRESOLVED_CLAIM_IN_LEVEL1",
          severity: "error",
          message: `Scene "${scene.id}" (${scene.kind}) presents an unresolved statement ("${statement.value}") without its "Unconfirmed:" qualifier visible in the rendered output.`,
          relatedId: scene.id,
          remediation: "Ensure statementText()/qualifierFor() is applied before this statement reaches the rendered scene, or mark it confirmed/derived once evidenced.",
        });
      }
    }
  }
  return warnings;
}

/** A "suggested" statement must never be silently presented as fact in Level 1/2 narration — its "Likely:" qualifier must be visibly rendered. */
export function checkSuggestedClaimsUnlabeled(doc: VisualDoc, artifact: ArchitectureIntelligence, html: string): ArchIntelWarning[] {
  const warnings: ArchIntelWarning[] = [];
  const sceneHtmlById = extractSceneHtmlById(html);
  for (const scene of architectureIntelligenceScenes(doc)) {
    const statements = statementsForKind(scene, artifact);
    if (!statements) continue;
    const sceneHtml = sceneHtmlById.get(scene.id);
    if (sceneHtml === undefined) continue;
    for (const statement of statements) {
      if (statement.inference !== "suggested") continue;
      const expected = escapeHtml(`Likely: ${statement.value}`);
      if (!sceneHtml.includes(expected)) {
        warnings.push({
          code: "ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED",
          severity: "error",
          message: `Scene "${scene.id}" (${scene.kind}) presents a suggested statement ("${statement.value}") without its "Likely:" qualifier visible in the rendered output.`,
          relatedId: scene.id,
          remediation: "Ensure statementText()/qualifierFor() is applied before this statement reaches the rendered scene, or promote it to derived once independently confirmed.",
        });
      }
    }
  }
  return warnings;
}

/** Slides are meant to be skimmable, not read like documentation — a scene whose rendered text blows past a per-kind word budget defeats that. */
export function checkSceneWordBudget(doc: VisualDoc, html: string): ArchIntelWarning[] {
  const warnings: ArchIntelWarning[] = [];
  const sceneHtmlById = extractSceneHtmlById(html);
  for (const scene of architectureIntelligenceScenes(doc)) {
    const budget = WORD_BUDGETS[scene.kind];
    if (budget === undefined) continue;
    const sceneHtml = sceneHtmlById.get(scene.id);
    if (sceneHtml === undefined) continue;
    const wordCount = stripTags(sceneHtml).split(" ").filter(Boolean).length;
    if (wordCount > budget) {
      warnings.push({
        code: "ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED",
        severity: "warning",
        message: `Scene "${scene.id}" (${scene.kind}) renders ${wordCount} words, exceeding its ${budget}-word budget.`,
        relatedId: scene.id,
        remediation: "Narrow scene.focus_ids to a smaller subset, or split this view across multiple scenes of the same kind.",
      });
    }
  }
  return warnings;
}

// A raw filesystem path leaking into synthesized prose is a sign the engine
// lowered the level of abstraction instead of raising it — implementation
// detail belongs in the evidence citation attached to the statement, not in
// its narrated value.
const IMPLEMENTATION_DETAIL_PATTERN = /[\w.-]+\/[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|py|yml|yaml|tf|tfvars|json|md|go|rb|java|rs|sql)\b/i;

/** Level 1 Executive statement values must read as prose, not as evidence — a leaked file path belongs in the citation, not the narration. */
export function checkLevel1LeaksImplementationDetail(doc: VisualDoc, artifact: ArchitectureIntelligence): ArchIntelWarning[] {
  const warnings: ArchIntelWarning[] = [];
  for (const scene of architectureIntelligenceScenes(doc)) {
    if (!LEVEL1_KINDS.has(scene.kind)) continue;
    const statements = statementsForKind(scene, artifact);
    if (!statements) continue;
    for (const statement of statements) {
      const match = statement.value.match(IMPLEMENTATION_DETAIL_PATTERN);
      if (match) {
        warnings.push({
          code: "ARCH_INTEL_LEVEL1_LEAKS_IMPLEMENTATION_DETAIL",
          severity: "warning",
          message: `Scene "${scene.id}" (${scene.kind}) narrates a statement containing what looks like a raw file path ("${match[0]}"): "${statement.value}"`,
          relatedId: scene.id,
          remediation: "Move the path reference into the statement's evidence citation and keep the narrated value itself free of implementation detail.",
        });
      }
    }
  }
  return warnings;
}

/** The cached ArchitectureIntelligence artifact is stale once `rvs inspect` has rescanned the repository since it was synthesized. */
export function checkStaleInput(artifact: ArchitectureIntelligence, currentModel: RepositoryModel): ArchIntelWarning[] {
  if (artifact.metadata.source_repository_model_generated_at === currentModel.generated_at) return [];
  return [
    {
      code: "ARCH_INTEL_STALE_INPUT",
      severity: "warning",
      message: `The cached architecture intelligence was synthesized from a repository-model snapshot generated at ${artifact.metadata.source_repository_model_generated_at}, but the current snapshot is ${currentModel.generated_at}.`,
      remediation: "Run `rvs synthesize architecture` again to re-synthesize against the current repository-model snapshot.",
    },
  ];
}

export interface ArchitectureIntelligenceCheckInputs {
  doc: VisualDoc;
  artifact: ArchitectureIntelligence;
  html: string;
  currentModel: RepositoryModel;
}

export function runArchitectureIntelligenceChecks(input: ArchitectureIntelligenceCheckInputs): ArchIntelWarning[] {
  return [
    ...checkUnresolvedClaimsInLevel1(input.doc, input.artifact, input.html),
    ...checkSuggestedClaimsUnlabeled(input.doc, input.artifact, input.html),
    ...checkSceneWordBudget(input.doc, input.html),
    ...checkLevel1LeaksImplementationDetail(input.doc, input.artifact),
    ...checkStaleInput(input.artifact, input.currentModel),
  ];
}
