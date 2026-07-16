import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWorkflowText } from "../parse-workflow.js";
import type { ParsedWorkflow, WorkflowEdge, WorkflowNode } from "../types.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function parseFixture(name: string, sourcePath = `.github/workflows/${name}`): ParsedWorkflow {
  return parseWorkflowText(loadFixture(name), sourcePath);
}

function findNode(nodes: WorkflowNode[], id: string): WorkflowNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`expected node "${id}" not found among: ${nodes.map((n) => n.id).join(", ")}`);
  return node;
}

function findEdge(edges: WorkflowEdge[], predicate: (e: WorkflowEdge) => boolean): WorkflowEdge {
  const edge = edges.find(predicate);
  if (!edge) throw new Error(`expected edge not found among: ${edges.map((e) => e.id).join(", ")}`);
  return edge;
}

describe("parseWorkflowText: single-job.yml", () => {
  const { graph, warnings } = parseFixture("single-job.yml");

  it("extracts workflow name and deterministic workflow id", () => {
    expect(graph.name).toBe("Single Job");
    expect(graph.id).toBe("workflow:Single-Job");
  });

  it("extracts the push trigger with branch filters and evidence", () => {
    expect(graph.triggers).toHaveLength(1);
    expect(graph.triggers[0]?.name).toBe("push");
    expect(graph.triggers[0]?.branches).toEqual(["main"]);
    expect(graph.triggers[0]?.evidence[0]?.path).toBe(".github/workflows/single-job.yml");
    expect(graph.triggers[0]?.evidence[0]?.lines).toMatch(/^\d+-\d+$/);
  });

  it("extracts the build job and its two steps", () => {
    const job = findNode(graph.nodes, "job:workflow:Single-Job:build");
    expect(job.type).toBe("job");
    expect(job.label).toBe("build");
    expect(job.confidence).toBe("confirmed");

    const steps = graph.nodes.filter((n) => n.type === "step");
    expect(steps).toHaveLength(2);
    expect(steps[0]?.metadata?.uses).toBe("actions/checkout@v4");
    expect(steps[1]?.metadata?.run).toBe("npm run build");
  });

  it("connects the trigger to the job via a starts edge, and the job to its steps via contains edges", () => {
    const startsEdge = findEdge(graph.edges, (e) => e.type === "starts");
    expect(startsEdge.from).toBe("trigger:push@workflow:Single-Job");
    expect(startsEdge.to).toBe("job:workflow:Single-Job:build");

    const containsEdges = graph.edges.filter((e) => e.type === "contains");
    expect(containsEdges).toHaveLength(2);
  });

  it("produces no warnings for a well-formed single-job workflow", () => {
    expect(warnings).toEqual([]);
  });
});

describe("parseWorkflowText: linear-chain.yml", () => {
  const { graph, warnings } = parseFixture("linear-chain.yml");

  it("builds a needs chain lint -> test -> build", () => {
    const lintToTest = findEdge(
      graph.edges,
      (e) => e.type === "needs" && e.from === "job:workflow:Linear-Chain:lint" && e.to === "job:workflow:Linear-Chain:test",
    );
    const testToBuild = findEdge(
      graph.edges,
      (e) => e.type === "needs" && e.from === "job:workflow:Linear-Chain:test" && e.to === "job:workflow:Linear-Chain:build",
    );
    expect(lintToTest.confidence).toBe("confirmed");
    expect(testToBuild.confidence).toBe("confirmed");
  });

  it("only the first job in the chain is started directly by the trigger", () => {
    const startsEdges = graph.edges.filter((e) => e.type === "starts");
    expect(startsEdges).toHaveLength(1);
    expect(startsEdges[0]?.to).toBe("job:workflow:Linear-Chain:lint");
  });

  it("does not infer sequential dependencies from file order alone", () => {
    const needsEdges = graph.edges.filter((e) => e.type === "needs");
    expect(needsEdges).toHaveLength(2);
  });

  it("produces no warnings", () => {
    expect(warnings).toEqual([]);
  });
});

describe("parseWorkflowText: fan-out-fan-in.yml", () => {
  const { graph } = parseFixture("fan-out-fan-in.yml");

  it("fans out from prepare to three parallel jobs", () => {
    const fanOut = graph.edges.filter((e) => e.type === "needs" && e.from === "job:workflow:Fan-Out-Fan-In:prepare");
    expect(fanOut.map((e) => e.to).sort()).toEqual(
      [
        "job:workflow:Fan-Out-Fan-In:unit-tests",
        "job:workflow:Fan-Out-Fan-In:integration-tests",
        "job:workflow:Fan-Out-Fan-In:lint",
      ].sort(),
    );
  });

  it("fans in to publish from all three parallel jobs", () => {
    const fanIn = graph.edges.filter((e) => e.type === "needs" && e.to === "job:workflow:Fan-Out-Fan-In:publish");
    expect(fanIn).toHaveLength(3);
  });
});

describe("parseWorkflowText: conditional-job.yml", () => {
  const { graph } = parseFixture("conditional-job.yml");

  it("marks a needs edge as conditional and preserves the raw if condition", () => {
    const edge = findEdge(
      graph.edges,
      (e) => e.from === "job:workflow:Conditional-Job:build" && e.to === "job:workflow:Conditional-Job:deploy",
    );
    expect(edge.type).toBe("conditional");
    expect(edge.metadata?.condition).toBe("github.ref == 'refs/heads/main'");
  });

  it("marks a trigger-start edge as conditional when the job has no needs but has an if", () => {
    const edge = findEdge(graph.edges, (e) => e.to === "job:workflow:Conditional-Job:notify");
    expect(edge.type).toBe("conditional");
    expect(edge.metadata?.condition).toBe("always()");
  });

  it("leaves the unconditional build job's start edge as a plain starts edge", () => {
    const edge = findEdge(graph.edges, (e) => e.to === "job:workflow:Conditional-Job:build");
    expect(edge.type).toBe("starts");
  });
});

describe("parseWorkflowText: matrix-job.yml", () => {
  const { graph, warnings } = parseFixture("matrix-job.yml");

  it("flags the workflow as having matrix jobs", () => {
    expect(graph.metadata.hasMatrixJobs).toBe(true);
  });

  it("marks the job's confidence dynamic when runs-on is a matrix expression", () => {
    const job = findNode(graph.nodes, "job:workflow:Matrix-Job:test");
    expect(job.confidence).toBe("dynamic");
    expect(job.metadata?.matrix).toEqual({ os: ["ubuntu-latest", "macos-latest"], node: [18, 20] });
  });

  it("preserves the raw runs-on expression without fabricating a resolved runner", () => {
    const job = findNode(graph.nodes, "job:workflow:Matrix-Job:test");
    expect(job.metadata?.runsOn).toBe("${{ matrix.os }}");
  });

  it("produces no warnings purely from matrix usage", () => {
    expect(warnings).toEqual([]);
  });
});

describe("parseWorkflowText: reusable-call.yml", () => {
  const { graph } = parseFixture("reusable-call.yml");

  it("creates a reusable-workflow node distinct from the calling job node", () => {
    const callingJob = findNode(graph.nodes, "job:workflow:Reusable-Call:call-shared-build");
    expect(callingJob.type).toBe("job");

    const reusable = findNode(graph.nodes, "reusable-workflow:workflow:Reusable-Call:call-shared-build");
    expect(reusable.type).toBe("reusable-workflow");
    expect(reusable.label).toBe("./.github/workflows/shared-build.yml");
    expect(reusable.metadata?.isLocal).toBe(true);
  });

  it("connects the job to the reusable workflow via a calls edge", () => {
    const edge = findEdge(graph.edges, (e) => e.type === "calls");
    expect(edge.from).toBe("job:workflow:Reusable-Call:call-shared-build");
    expect(edge.to).toBe("reusable-workflow:workflow:Reusable-Call:call-shared-build");
  });

  it("marks the workflow metadata as having reusable workflow calls", () => {
    expect(graph.metadata.hasReusableWorkflows).toBe(true);
  });
});

describe("parseWorkflowText: environment-deploy.yml", () => {
  const { graph } = parseFixture("environment-deploy.yml");

  it("creates an environment node and a deploys-to edge from the deploying job", () => {
    const envNode = findNode(graph.nodes, "environment:production@workflow:Environment-Deploy");
    expect(envNode.type).toBe("environment");

    const edge = findEdge(graph.edges, (e) => e.type === "deploys-to");
    expect(edge.from).toBe("job:workflow:Environment-Deploy:deploy-production");
    expect(edge.to).toBe(envNode.id);
  });
});

describe("parseWorkflowText: manual-approval.yml", () => {
  const { graph } = parseFixture("manual-approval.yml");

  it("classifies a job whose id contains 'approv' as an approval node", () => {
    const approvalJob = findNode(graph.nodes, "job:workflow:Manual-Approval:approve-release");
    expect(approvalJob.type).toBe("approval");
  });

  it("does not classify unrelated jobs as approval nodes", () => {
    const buildJob = findNode(graph.nodes, "job:workflow:Manual-Approval:build");
    const releaseJob = findNode(graph.nodes, "job:workflow:Manual-Approval:release");
    expect(buildJob.type).toBe("job");
    expect(releaseJob.type).toBe("job");
  });
});

describe("parseWorkflowText: scheduled-trigger.yml", () => {
  const { graph } = parseFixture("scheduled-trigger.yml");

  it("captures the cron expression on the schedule trigger", () => {
    expect(graph.triggers).toHaveLength(1);
    expect(graph.triggers[0]?.name).toBe("schedule");
    expect(graph.triggers[0]?.cron).toEqual(["0 6 * * 1"]);
  });
});

describe("parseWorkflowText: multiple-triggers.yml", () => {
  const { graph } = parseFixture("multiple-triggers.yml");

  it("captures all declared triggers distinctly", () => {
    expect(graph.triggers.map((t) => t.name).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
  });

  it("captures workflow_dispatch inputs", () => {
    const dispatch = graph.triggers.find((t) => t.name === "workflow_dispatch");
    expect(dispatch?.inputs).toEqual(["environment"]);
  });

  it("starts the single job from every trigger", () => {
    const startsEdges = graph.edges.filter((e) => e.type === "starts");
    expect(startsEdges).toHaveLength(3);
  });
});

describe("parseWorkflowText: invalid-needs.yml", () => {
  const { graph, warnings } = parseFixture("invalid-needs.yml");

  it("emits an error-severity WORKFLOW_UNKNOWN_NEEDS warning for a nonexistent job reference", () => {
    const warning = warnings.find((w) => w.code === "WORKFLOW_UNKNOWN_NEEDS");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("error");
    expect(warning?.message).toContain("buidl");
  });

  it("does not fabricate an edge for the unresolved needs reference", () => {
    const dangling = graph.edges.find((e) => e.to === "job:workflow:Invalid-Needs:broken-needs");
    expect(dangling).toBeUndefined();
  });
});

describe("parseWorkflowText: dynamic-expressions.yml", () => {
  const { graph, warnings } = parseFixture("dynamic-expressions.yml");

  it("preserves a dynamic needs expression and emits WORKFLOW_DYNAMIC_EXPRESSION without fabricating an edge", () => {
    const warning = warnings.find((w) => w.code === "WORKFLOW_DYNAMIC_EXPRESSION" && w.message.includes("dynamic-needs"));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    const fabricated = graph.edges.find((e) => e.to === "job:workflow:Dynamic-Expressions:dynamic-needs");
    expect(fabricated).toBeUndefined();
  });

  it("marks a job with a dynamic runs-on expression as dynamic confidence without resolving it", () => {
    const job = findNode(graph.nodes, "job:workflow:Dynamic-Expressions:dynamic-runner");
    expect(job.confidence).toBe("dynamic");
    expect(job.metadata?.runsOn).toBe("${{ matrix.runner }}");
  });

  it("emits WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED for a dynamic reusable workflow reference", () => {
    const warning = warnings.find((w) => w.code === "WORKFLOW_REUSABLE_REFERENCE_UNRESOLVED");
    expect(warning).toBeDefined();
    const reusable = graph.nodes.find((n) => n.type === "reusable-workflow");
    expect(reusable?.label).toBe("./.github/workflows/${{ inputs.workflow_name }}.yml");
    expect(reusable?.confidence).toBe("dynamic");
  });
});

describe("parseWorkflowText: unusual-keys.yml", () => {
  const { graph } = parseFixture("unusual-keys.yml");

  it("handles quoted job/step keys and array-form on: identically to unquoted forms", () => {
    expect(graph.triggers.map((t) => t.name).sort()).toEqual(["pull_request", "push"]);
    const job = findNode(graph.nodes, "job:workflow:Unusual-but-Valid-Keys:build-and-test");
    expect(job.label).toBe("build-and-test");
  });

  it("captures run-name, permissions, concurrency, and env at the workflow level", () => {
    expect(graph.metadata.runName).toBe("Run for ${{ github.actor }}");
    expect(graph.metadata.permissions).toEqual({ contents: "read", "pull-requests": "write" });
    expect(graph.metadata.env).toEqual({ NODE_ENV: "production" });
    expect(graph.metadata.concurrency).toEqual({ group: "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true });
  });

  it("assigns a step id combining its index and its declared id key", () => {
    const step = findNode(graph.nodes, "step:job:workflow:Unusual-but-Valid-Keys:build-and-test:1:run-tests");
    expect(step.label).toBe("Run tests");
    expect(step.metadata?.workingDirectory).toBe("./app");
    expect(step.metadata?.continueOnError).toBe(true);
  });
});

describe("parseWorkflowText: .yaml extension", () => {
  it("parses a workflow file using the .yaml extension identically to .yml", () => {
    const { graph, warnings } = parseFixture("yaml-extension.yaml", ".github/workflows/yaml-extension.yaml");
    expect(graph.name).toBe("Yaml Extension Case");
    expect(warnings).toEqual([]);
  });
});

describe("parseWorkflowText: evidence and determinism", () => {
  it("produces byte-identical graphs across repeated parses of the same text", () => {
    const text = loadFixture("linear-chain.yml");
    const first = parseWorkflowText(text, ".github/workflows/linear-chain.yml");
    const second = parseWorkflowText(text, ".github/workflows/linear-chain.yml");
    expect(JSON.stringify(first.graph)).toBe(JSON.stringify(second.graph));
    expect(JSON.stringify(first.warnings)).toBe(JSON.stringify(second.warnings));
  });

  it("gives every node and edge a repo-relative evidence path", () => {
    const { graph } = parseFixture("fan-out-fan-in.yml");
    for (const node of graph.nodes) {
      expect(node.evidence.length).toBeGreaterThan(0);
      for (const ev of node.evidence) {
        expect(ev.path).toBe(".github/workflows/fan-out-fan-in.yml");
        expect(ev.path.startsWith("/")).toBe(false);
      }
    }
    for (const edge of graph.edges) {
      expect(edge.evidence.length).toBeGreaterThan(0);
    }
  });

  it("throws a descriptive error on malformed YAML instead of silently producing a partial graph", () => {
    expect(() => parseWorkflowText("jobs:\n  build:\n  - not: valid: mapping\n", "bad.yml")).toThrow(/bad\.yml/);
  });
});
