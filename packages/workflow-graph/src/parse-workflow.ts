import { readFileSync } from "node:fs";
import { LineCounter, isMap, isSeq, parseDocument, type Document, type Pair, type YAMLMap } from "yaml";
import { resolveWorkflowPath } from "./discover.js";
import { classifyExpressionConfidence, containsExpression, scanExpressions } from "./expressions.js";
import * as ids from "./ids.js";
import type {
  EvidenceConfidence,
  EvidenceReference,
  ParsedWorkflow,
  WorkflowEdge,
  WorkflowEdgeType,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTrigger,
  WorkflowWarning,
} from "./types.js";

const KNOWN_TRIGGERS = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "workflow_dispatch",
  "workflow_call",
  "workflow_run",
  "schedule",
  "release",
  "issues",
  "issue_comment",
  "repository_dispatch",
]);

function toArray(value: unknown): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

interface ParseContext {
  sourcePath: string;
  lineCounter: LineCounter;
  warnings: WorkflowWarning[];
}

// Ranges reported by the `yaml` AST for a mapping value extend to the byte
// offset where the *next* sibling key begins, not the value's own last
// content line. We trim one line off the end (never below the start line) so
// evidence ranges point at the construct itself, not its neighbor.
function lineRangeFromOffsets(ctx: ParseContext, startOffset: number, endOffset: number): string {
  const start = ctx.lineCounter.linePos(startOffset).line;
  let end = ctx.lineCounter.linePos(endOffset).line;
  if (end > start) end -= 1;
  end = Math.max(start, end);
  return `${start}-${end}`;
}

function evidenceFromPair(ctx: ParseContext, pair: Pair | undefined): EvidenceReference[] {
  if (!pair) return [{ path: ctx.sourcePath }];
  const key = pair.key as { range?: [number, number, number] } | null;
  const value = pair.value as { range?: [number, number, number] } | null;
  const startOffset = key?.range?.[0] ?? value?.range?.[0];
  const endOffset = value?.range?.[1] ?? key?.range?.[1];
  if (startOffset == null || endOffset == null) return [{ path: ctx.sourcePath }];
  return [{ path: ctx.sourcePath, lines: lineRangeFromOffsets(ctx, startOffset, endOffset) }];
}

function evidenceFromNode(ctx: ParseContext, node: { range?: [number, number, number] } | null | undefined): EvidenceReference[] {
  if (!node?.range) return [{ path: ctx.sourcePath }];
  return [{ path: ctx.sourcePath, lines: lineRangeFromOffsets(ctx, node.range[0], node.range[1]) }];
}

function getPair(map: YAMLMap | null | undefined, key: string): Pair | undefined {
  if (!map || !isMap(map)) return undefined;
  return map.items.find((p) => String((p.key as { value?: unknown })?.value) === key);
}

function docWideEvidence(ctx: ParseContext, doc: Document): EvidenceReference[] {
  const range = doc.contents?.range;
  if (!range) return [{ path: ctx.sourcePath }];
  return [{ path: ctx.sourcePath, lines: `1-${ctx.lineCounter.linePos(range[1]).line}` }];
}

function confidenceForRawValue(rawValue: string | undefined): { confidence: EvidenceConfidence; expressions: string[] } {
  if (!rawValue || !containsExpression(rawValue)) return { confidence: "confirmed", expressions: [] };
  const scan = scanExpressions(rawValue);
  return { confidence: classifyExpressionConfidence(scan.expressions), expressions: scan.expressions };
}

const CONFIDENCE_RANK: Record<EvidenceConfidence, number> = {
  confirmed: 0,
  "partially-resolved": 1,
  dynamic: 2,
  unsupported: 3,
};

// The overall confidence for a construct with several independently-dynamic
// fields (if/runs-on/uses/...) is the least certain of them.
function combineConfidence(...values: EvidenceConfidence[]): EvidenceConfidence {
  return values.reduce((worst, v) => (CONFIDENCE_RANK[v] > CONFIDENCE_RANK[worst] ? v : worst), "confirmed" as EvidenceConfidence);
}

function parseTriggers(ctx: ParseContext, doc: Document, plain: Record<string, unknown>, wfId: string): {
  triggers: WorkflowTrigger[];
  nodes: WorkflowNode[];
} {
  const triggers: WorkflowTrigger[] = [];
  const nodes: WorkflowNode[] = [];
  const root = doc.contents as YAMLMap | null;
  const onPair = getPair(root, "on");
  const onValue = plain.on;

  function pushTrigger(eventName: string, config: unknown, pair: Pair | undefined) {
    const trigId = ids.triggerId(wfId, eventName);
    const evidence = pair ? evidenceFromPair(ctx, pair) : evidenceFromPair(ctx, onPair);
    if (!KNOWN_TRIGGERS.has(eventName)) {
      ctx.warnings.push({
        code: "WORKFLOW_UNSUPPORTED_TRIGGER",
        severity: "warning",
        message: `Trigger "${eventName}" is not one of the well-known GitHub Actions events; captured through the generic fallback.`,
        sourcePath: ctx.sourcePath,
        evidence: evidence[0],
        remediation: "Verify the event name is spelled correctly, or extend the parser's known-trigger list.",
      });
    }
    const cfg = (config ?? {}) as Record<string, unknown>;
    const trigger: WorkflowTrigger = {
      id: trigId,
      name: eventName,
      branches: toArray(cfg.branches).length ? toArray(cfg.branches) : undefined,
      branchesIgnore: toArray(cfg["branches-ignore"]).length ? toArray(cfg["branches-ignore"]) : undefined,
      tags: toArray(cfg.tags).length ? toArray(cfg.tags) : undefined,
      tagsIgnore: toArray(cfg["tags-ignore"]).length ? toArray(cfg["tags-ignore"]) : undefined,
      paths: toArray(cfg.paths).length ? toArray(cfg.paths) : undefined,
      pathsIgnore: toArray(cfg["paths-ignore"]).length ? toArray(cfg["paths-ignore"]) : undefined,
      types: toArray(cfg.types).length ? toArray(cfg.types) : undefined,
      cron: Array.isArray(config)
        ? (config as Array<{ cron?: string }>).map((s) => s.cron).filter((c): c is string => Boolean(c))
        : undefined,
      inputs: cfg.inputs && typeof cfg.inputs === "object" ? Object.keys(cfg.inputs as object) : undefined,
      referencedWorkflow: typeof cfg.workflows === "string" ? cfg.workflows : undefined,
      evidence,
    };
    triggers.push(trigger);
    nodes.push({
      id: trigId,
      type: "trigger",
      label: eventName,
      evidence,
      confidence: "confirmed",
    });
  }

  if (typeof onValue === "string") {
    pushTrigger(onValue, {}, onPair);
  } else if (Array.isArray(onValue)) {
    for (const eventName of onValue) pushTrigger(String(eventName), {}, onPair);
  } else if (onValue && typeof onValue === "object") {
    const onMap = onPair?.value as YAMLMap | undefined;
    for (const [eventName, cfg] of Object.entries(onValue as Record<string, unknown>)) {
      pushTrigger(eventName, cfg, getPair(onMap, eventName));
    }
  } else {
    ctx.warnings.push({
      code: "WORKFLOW_UNSUPPORTED_TRIGGER",
      severity: "warning",
      message: "No `on:` trigger block was found in this workflow file.",
      sourcePath: ctx.sourcePath,
    });
  }

  return { triggers, nodes };
}

interface StepParseResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

function parseSteps(
  ctx: ParseContext,
  jobIdValue: string,
  jobMap: YAMLMap | undefined,
  stepsPlain: Array<Record<string, unknown>>,
): StepParseResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const stepsSeq = jobMap ? (getPair(jobMap, "steps")?.value as { items?: unknown[] } | undefined) : undefined;
  const rawItems = isSeq(stepsSeq as never) ? (stepsSeq as { items: unknown[] }).items : [];

  stepsPlain.forEach((step, index) => {
    const rawNode = rawItems[index] as { range?: [number, number, number] } | undefined;
    const evidence = evidenceFromNode(ctx, rawNode);
    const stepIdValue = ids.stepId(jobIdValue, index, typeof step.id === "string" ? step.id : undefined);
    const label = (typeof step.name === "string" && step.name) || (typeof step.uses === "string" && step.uses) ||
      (typeof step.run === "string" && step.run.split("\n")[0]?.slice(0, 60)) || `step ${index}`;

    const ifRaw = typeof step.if === "string" ? step.if : undefined;
    const { confidence } = confidenceForRawValue(ifRaw);

    nodes.push({
      id: stepIdValue,
      type: "step",
      label,
      evidence,
      confidence,
      metadata: {
        index,
        id: step.id,
        uses: step.uses,
        run: step.run,
        shell: step.shell,
        workingDirectory: step["working-directory"],
        if: step.if,
        env: step.env,
        continueOnError: step["continue-on-error"],
        timeoutMinutes: step["timeout-minutes"],
      },
    });

    edges.push({
      id: ids.edgeId("contains", jobIdValue, stepIdValue),
      type: "contains",
      from: jobIdValue,
      to: stepIdValue,
      evidence,
      confidence: "confirmed",
    });

    if (typeof step.uses === "string" && /actions\/(upload|download)-artifact/.test(step.uses)) {
      const artifactName =
        step.with && typeof step.with === "object" && typeof (step.with as Record<string, unknown>).name === "string"
          ? ((step.with as Record<string, unknown>).name as string)
          : `artifact-${index}`;
      const artifactNodeId = `artifact:${jobIdValue}:${artifactName.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
      const isUpload = step.uses.includes("upload-artifact");
      if (!nodes.some((n) => n.id === artifactNodeId)) {
        nodes.push({
          id: artifactNodeId,
          type: "artifact",
          label: artifactName,
          evidence,
          confidence,
          metadata: { direction: isUpload ? "upload" : "download" },
        });
      }
      edges.push({
        id: ids.edgeId(isUpload ? "produces" : "consumes", isUpload ? stepIdValue : artifactNodeId, isUpload ? artifactNodeId : stepIdValue),
        type: isUpload ? "produces" : "consumes",
        from: isUpload ? stepIdValue : artifactNodeId,
        to: isUpload ? artifactNodeId : stepIdValue,
        evidence,
        confidence,
      });
    }
  });

  return { nodes, edges };
}

export function parseWorkflowText(text: string, sourcePath: string): ParsedWorkflow {
  const warnings: WorkflowWarning[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, keepSourceTokens: true });
  const ctx: ParseContext = { sourcePath, lineCounter, warnings };

  if (doc.errors.length > 0) {
    throw new Error(`${sourcePath}: ${doc.errors[0]?.message ?? "invalid YAML"}`);
  }

  const plain = (doc.toJS() ?? {}) as Record<string, unknown>;
  const fileBaseName = sourcePath.split("/").pop() ?? sourcePath;
  const name = typeof plain.name === "string" && plain.name.trim().length > 0
    ? plain.name
    : fileBaseName.replace(/\.ya?ml$/, "");
  const wfId = ids.workflowId(name);
  const root = doc.contents as YAMLMap | null;

  const { triggers, nodes: triggerNodes } = parseTriggers(ctx, doc, plain, wfId);

  const nodes: WorkflowNode[] = [...triggerNodes];
  const edges: WorkflowEdge[] = [];

  const jobsPlain = (plain.jobs ?? {}) as Record<string, Record<string, unknown>>;
  const jobsPair = getPair(root, "jobs");
  const jobsMap = jobsPair?.value as YAMLMap | undefined;
  const jobKeys = Object.keys(jobsPlain);
  let hasMatrixJobs = false;
  let hasReusableWorkflows = false;
  let stepCount = 0;

  for (const jobKey of jobKeys) {
    const jobPlain = jobsPlain[jobKey] ?? {};
    const jobPair = getPair(jobsMap, jobKey);
    const jobEvidence = evidenceFromPair(ctx, jobPair);
    const jobIdValue = ids.jobId(wfId, jobKey);
    const jobMap = jobPair?.value as YAMLMap | undefined;

    const ifRaw = typeof jobPlain.if === "string" ? jobPlain.if : undefined;
    const { confidence: ifConfidence } = confidenceForRawValue(ifRaw);
    const runsOnRaw = typeof jobPlain["runs-on"] === "string" ? (jobPlain["runs-on"] as string) : undefined;
    const { confidence: runsOnConfidence } = confidenceForRawValue(runsOnRaw);
    const usesRaw = typeof jobPlain.uses === "string" ? jobPlain.uses : undefined;
    const { confidence: usesRawConfidence } = confidenceForRawValue(usesRaw);
    const jobConfidence = combineConfidence(ifConfidence, runsOnConfidence, usesRawConfidence);
    const isApprovalLike = /approv/i.test(jobKey) || /approv/i.test(String(jobPlain.name ?? ""));
    const hasMatrix = Boolean(
      jobPlain.strategy && typeof jobPlain.strategy === "object" && (jobPlain.strategy as Record<string, unknown>).matrix,
    );
    if (hasMatrix) hasMatrixJobs = true;

    let jobType: WorkflowNodeType = "job";
    if (isApprovalLike) jobType = "approval";

    nodes.push({
      id: jobIdValue,
      type: jobType,
      label: typeof jobPlain.name === "string" ? jobPlain.name : jobKey,
      evidence: jobEvidence,
      confidence: jobConfidence,
      metadata: {
        jobKey,
        if: jobPlain.if,
        runsOn: jobPlain["runs-on"],
        strategy: jobPlain.strategy,
        matrix: hasMatrix ? (jobPlain.strategy as Record<string, unknown>).matrix : undefined,
        environment: jobPlain.environment,
        permissions: jobPlain.permissions,
        container: jobPlain.container,
        services: jobPlain.services,
        timeoutMinutes: jobPlain["timeout-minutes"],
        continueOnError: jobPlain["continue-on-error"],
        outputs: jobPlain.outputs,
        uses: jobPlain.uses,
      },
    });

    // needs -> explicit dependency edges
    const needs = toArray(jobPlain.needs);
    for (const neededKey of needs) {
      if (containsExpression(neededKey)) {
        warnings.push({
          code: "WORKFLOW_DYNAMIC_EXPRESSION",
          severity: "warning",
          message: `Job "${jobKey}" declares a \`needs\` entry that is a dynamic expression (${neededKey}); the dependency edge cannot be statically resolved.`,
          sourcePath,
          evidence: jobEvidence[0],
          remediation: "The raw expression is preserved on the job node; no needs edge is fabricated.",
        });
        continue;
      }
      const neededId = ids.jobId(wfId, neededKey);
      if (!jobKeys.includes(neededKey)) {
        warnings.push({
          code: "WORKFLOW_UNKNOWN_NEEDS",
          severity: "error",
          message: `Job "${jobKey}" declares \`needs: ${neededKey}\`, but no job with that id exists in this workflow.`,
          sourcePath,
          evidence: jobEvidence[0],
          remediation: `Add a job named "${neededKey}", or fix the typo in "${jobKey}"'s needs list.`,
        });
        continue;
      }
      const edgeType: WorkflowEdgeType = ifRaw ? "conditional" : "needs";
      edges.push({
        id: ids.edgeId(edgeType, neededId, jobIdValue),
        type: edgeType,
        from: neededId,
        to: jobIdValue,
        label: ifRaw ? "needs (conditional)" : "needs",
        evidence: jobEvidence,
        confidence: ifConfidence,
        metadata: ifRaw ? { condition: ifRaw } : undefined,
      });
    }

    // no needs -> triggered directly by the workflow's own triggers
    if (needs.length === 0) {
      for (const trigger of triggers) {
        const edgeType: WorkflowEdgeType = ifRaw ? "conditional" : "starts";
        edges.push({
          id: ids.edgeId(edgeType, trigger.id, jobIdValue),
          type: edgeType,
          from: trigger.id,
          to: jobIdValue,
          label: ifRaw ? "starts (conditional)" : undefined,
          evidence: jobEvidence,
          confidence: ifConfidence,
          metadata: ifRaw ? { condition: ifRaw } : undefined,
        });
      }
    }

    // reusable workflow call
    if (usesRaw) {
      hasReusableWorkflows = true;
      const { confidence: usesConfidence } = confidenceForRawValue(usesRaw);
      const reusableId = ids.reusableWorkflowId(wfId, jobKey);
      if (usesConfidence === "dynamic") {
        warnings.push({
          code: "WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED",
          severity: "warning",
          message: `Job "${jobKey}" calls a reusable workflow through a dynamic expression: ${usesRaw}`,
          sourcePath,
          evidence: jobEvidence[0],
          remediation: "The referenced workflow cannot be statically resolved; the raw expression is preserved.",
        });
      }
      nodes.push({
        id: reusableId,
        type: "reusable-workflow",
        label: usesRaw,
        evidence: jobEvidence,
        confidence: usesConfidence,
        metadata: { uses: usesRaw, isLocal: usesRaw.startsWith("./") },
      });
      edges.push({
        id: ids.edgeId("calls", jobIdValue, reusableId),
        type: "calls",
        from: jobIdValue,
        to: reusableId,
        evidence: jobEvidence,
        confidence: usesConfidence,
      });
    }

    // environment -> deploys-to edge
    const envValue = jobPlain.environment;
    if (envValue) {
      const envName = typeof envValue === "string" ? envValue : String((envValue as Record<string, unknown>).name ?? "environment");
      const envEvidence = evidenceFromPair(ctx, getPair(jobMap, "environment"));
      const envId = ids.environmentId(wfId, envName);
      if (!nodes.some((n) => n.id === envId)) {
        nodes.push({ id: envId, type: "environment", label: envName, evidence: envEvidence, confidence: "confirmed" });
      }
      edges.push({
        id: ids.edgeId("deploys-to", jobIdValue, envId),
        type: "deploys-to",
        from: jobIdValue,
        to: envId,
        evidence: envEvidence,
        confidence: "confirmed",
      });
    }

    // steps
    const stepsPlain = Array.isArray(jobPlain.steps) ? (jobPlain.steps as Array<Record<string, unknown>>) : [];
    stepCount += stepsPlain.length;
    const stepResult = parseSteps(ctx, jobIdValue, jobMap, stepsPlain);
    nodes.push(...stepResult.nodes);
    edges.push(...stepResult.edges);
  }

  // structural sanity: duplicate IDs must never happen given deterministic
  // construction above, but a corrupt/hand-edited fixture could still collide.
  const seenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      warnings.push({
        code: "WORKFLOW_DUPLICATE_NODE_ID",
        severity: "error",
        message: `Duplicate node id "${node.id}" produced while parsing.`,
        sourcePath,
      });
    }
    seenNodeIds.add(node.id);
  }
  const seenEdgeIds = new Set<string>();
  for (const edge of edges) {
    if (seenEdgeIds.has(edge.id)) {
      warnings.push({
        code: "WORKFLOW_DUPLICATE_EDGE_ID",
        severity: "error",
        message: `Duplicate edge id "${edge.id}" produced while parsing.`,
        sourcePath,
      });
    }
    seenEdgeIds.add(edge.id);
  }

  const graph: WorkflowGraph = {
    id: wfId,
    name,
    sourcePath,
    triggers,
    nodes,
    edges,
    metadata: {
      runName: typeof plain["run-name"] === "string" ? plain["run-name"] : undefined,
      permissions: plain.permissions,
      env: plain.env && typeof plain.env === "object" ? (plain.env as Record<string, string>) : undefined,
      concurrency: plain.concurrency,
      jobCount: jobKeys.length,
      stepCount,
      hasMatrixJobs,
      hasReusableWorkflows,
    },
    evidence: docWideEvidence(ctx, doc),
  };

  return { graph, warnings };
}

export function parseWorkflowFile(repoRoot: string, relPath: string): ParsedWorkflow {
  const absPath = resolveWorkflowPath(repoRoot, relPath);
  const text = readFileSync(absPath, "utf8");
  return parseWorkflowText(text, relPath);
}
