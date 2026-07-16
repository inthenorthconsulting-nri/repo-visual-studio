import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWorkflowText } from "../parse-workflow.js";
import { validateGraphStructure } from "../validate-structure.js";
import type { WorkflowGraph } from "../types.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function baseGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    id: "workflow:Test",
    name: "Test",
    sourcePath: ".github/workflows/test.yml",
    triggers: [{ id: "trigger:push@workflow:Test", name: "push", evidence: [{ path: ".github/workflows/test.yml", lines: "1-1" }] }],
    nodes: [],
    edges: [],
    metadata: { jobCount: 0, stepCount: 0, hasMatrixJobs: false, hasReusableWorkflows: false },
    evidence: [{ path: ".github/workflows/test.yml", lines: "1-1" }],
    ...overrides,
  };
}

describe("validateGraphStructure: hand-built graphs", () => {
  it("flags duplicate node ids", () => {
    const graph = baseGraph({
      nodes: [
        { id: "job:a", type: "job", label: "a", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
        { id: "job:a", type: "job", label: "a-dup", evidence: [{ path: "x.yml", lines: "2-2" }], confidence: "confirmed" },
      ],
    });
    const issues = validateGraphStructure(graph);
    expect(issues.some((i) => i.code === "WORKFLOW_DUPLICATE_NODE_ID")).toBe(true);
  });

  it("flags duplicate edge ids", () => {
    const graph = baseGraph({
      nodes: [
        { id: "job:a", type: "job", label: "a", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
        { id: "job:b", type: "job", label: "b", evidence: [{ path: "x.yml", lines: "2-2" }], confidence: "confirmed" },
      ],
      edges: [
        { id: "edge:a->b:needs", type: "needs", from: "job:a", to: "job:b", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
        { id: "edge:a->b:needs", type: "needs", from: "job:a", to: "job:b", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
      ],
    });
    const issues = validateGraphStructure(graph);
    expect(issues.some((i) => i.code === "WORKFLOW_DUPLICATE_EDGE_ID")).toBe(true);
  });

  it("flags dangling edges that reference a nonexistent node instead of silently dropping them", () => {
    const graph = baseGraph({
      nodes: [{ id: "job:a", type: "job", label: "a", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" }],
      edges: [
        { id: "edge:a->ghost:needs", type: "needs", from: "job:a", to: "job:ghost", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
      ],
    });
    const issues = validateGraphStructure(graph);
    const dangling = issues.find((i) => i.code === "WORKFLOW_DANGLING_EDGE");
    expect(dangling).toBeDefined();
    expect(dangling?.severity).toBe("error");
  });

  it("flags nodes and edges missing evidence, and fails in a way that would block CI (error severity)", () => {
    const graph = baseGraph({
      nodes: [{ id: "job:a", type: "job", label: "a", evidence: [], confidence: "confirmed" }],
    });
    const issues = validateGraphStructure(graph);
    const missing = issues.find((i) => i.code === "WORKFLOW_MISSING_EVIDENCE");
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("error");
  });

  it("warns when a workflow has no triggers", () => {
    const graph = baseGraph({ triggers: [] });
    const issues = validateGraphStructure(graph);
    const warning = issues.find((i) => i.code === "WORKFLOW_UNSUPPORTED_TRIGGER");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
  });

  it("is silent (no false positives) on a clean, well-formed graph", () => {
    const graph = baseGraph({
      nodes: [
        { id: "job:a", type: "job", label: "a", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
        { id: "job:b", type: "job", label: "b", evidence: [{ path: "x.yml", lines: "2-2" }], confidence: "confirmed" },
      ],
      edges: [
        { id: "edge:a->b:needs", type: "needs", from: "job:a", to: "job:b", evidence: [{ path: "x.yml", lines: "1-1" }], confidence: "confirmed" },
      ],
    });
    expect(validateGraphStructure(graph)).toEqual([]);
  });
});

describe("validateGraphStructure: matrix-job.yml", () => {
  it("emits a WORKFLOW_MATRIX_COLLAPSED warning for a job with a matrix strategy", () => {
    const { graph } = parseWorkflowText(loadFixture("matrix-job.yml"), ".github/workflows/matrix-job.yml");
    const issues = validateGraphStructure(graph);
    const collapsed = issues.find((i) => i.code === "WORKFLOW_MATRIX_COLLAPSED");
    expect(collapsed).toBeDefined();
    expect(collapsed?.severity).toBe("warning");
  });

  it("does not emit WORKFLOW_MATRIX_COLLAPSED for jobs without a matrix strategy", () => {
    const { graph } = parseWorkflowText(loadFixture("single-job.yml"), ".github/workflows/single-job.yml");
    const issues = validateGraphStructure(graph);
    expect(issues.some((i) => i.code === "WORKFLOW_MATRIX_COLLAPSED")).toBe(false);
  });
});

describe("validateGraphStructure: large-workflow.yml", () => {
  it("emits a WORKFLOW_TOO_LARGE warning once non-step nodes exceed the splitting threshold", () => {
    const { graph } = parseWorkflowText(loadFixture("large-workflow.yml"), ".github/workflows/large-workflow.yml");
    const issues = validateGraphStructure(graph);
    const tooLarge = issues.find((i) => i.code === "WORKFLOW_TOO_LARGE");
    expect(tooLarge).toBeDefined();
    expect(tooLarge?.severity).toBe("warning");
    expect(tooLarge?.remediation).toBeTruthy();
  });
});

describe("validateGraphStructure: real fixtures produce no structural errors", () => {
  it.each(["single-job.yml", "linear-chain.yml", "fan-out-fan-in.yml", "conditional-job.yml", "matrix-job.yml"])(
    "%s has no dangling edges, duplicate ids, or missing evidence",
    (name) => {
      const { graph } = parseWorkflowText(loadFixture(name), `.github/workflows/${name}`);
      const issues = validateGraphStructure(graph);
      const blocking = issues.filter((i) =>
        ["WORKFLOW_DUPLICATE_NODE_ID", "WORKFLOW_DUPLICATE_EDGE_ID", "WORKFLOW_DANGLING_EDGE", "WORKFLOW_MISSING_EVIDENCE"].includes(
          i.code,
        ),
      );
      expect(blocking).toEqual([]);
    },
  );
});
