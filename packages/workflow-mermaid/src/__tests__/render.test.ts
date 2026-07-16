import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { renderWorkflowMermaid } from "../render.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../../../workflow-graph/src/__tests__/fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function graphFor(name: string) {
  return parseWorkflowText(loadFixture(name), `.github/workflows/${name}`).graph;
}

describe("renderWorkflowMermaid", () => {
  it("emits a valid flowchart header with the requested direction", () => {
    const mmd = renderWorkflowMermaid(graphFor("linear-chain.yml"), { direction: "left-to-right" });
    expect(mmd.startsWith("flowchart LR")).toBe(true);
  });

  it("defaults to top-to-bottom direction", () => {
    const mmd = renderWorkflowMermaid(graphFor("linear-chain.yml"));
    expect(mmd.startsWith("flowchart TD")).toBe(true);
  });

  it("renders distinct shapes for triggers and jobs", () => {
    const mmd = renderWorkflowMermaid(graphFor("single-job.yml"));
    expect(mmd).toContain('(["push"])');
    expect(mmd).toMatch(/\["build"\]/);
  });

  it("escapes double quotes and angle brackets in labels", () => {
    const text = [
      'name: "Quote & <Tag> Test"',
      "on: push",
      "jobs:",
      '  build:',
      "    runs-on: ubuntu-latest",
      "    steps:",
      '      - name: \'Say "hi" <b>now</b>\'',
      "        run: echo hi",
      "",
    ].join("\n");
    const { graph } = parseWorkflowText(text, ".github/workflows/quote-test.yml");
    const mmd = renderWorkflowMermaid(graph, { detailLevel: "full" });
    expect(mmd).toContain("&quot;hi&quot;");
    expect(mmd).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(mmd).not.toContain('"hi"');
  });

  it("produces stable, sorted node and edge ordering across repeated renders", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const first = renderWorkflowMermaid(graph);
    const second = renderWorkflowMermaid(graph);
    expect(first).toBe(second);
  });

  it("marks a conditional needs edge with a dashed arrow and preserves its label", () => {
    const mmd = renderWorkflowMermaid(graphFor("conditional-job.yml"));
    expect(mmd).toMatch(/-\.->\|needs \(conditional\)\|/);
  });

  it("marks a dynamic-confidence job node and edge with a [dynamic] suffix and dynamic class", () => {
    const mmd = renderWorkflowMermaid(graphFor("matrix-job.yml"), { detailLevel: "full" });
    expect(mmd).toContain("[dynamic]");
    expect(mmd).toContain("class job_workflow_Matrix_Job_test job,dynamic");
  });

  it("emits a legend when multiple node types are present", () => {
    const mmd = renderWorkflowMermaid(graphFor("environment-deploy.yml"));
    expect(mmd).toContain("subgraph Legend");
    expect(mmd).toContain("Trigger");
    expect(mmd).toContain("Environment");
  });

  it("omits the legend when only one node type is present", () => {
    const text = ["name: Empty", "on: push", "jobs: {}", ""].join("\n");
    const { graph } = parseWorkflowText(text, ".github/workflows/empty.yml");
    const mmd = renderWorkflowMermaid(graph);
    expect(mmd).not.toContain("subgraph Legend");
  });

  it("preserves evidence via adjacent comments for every node and edge", () => {
    const mmd = renderWorkflowMermaid(graphFor("linear-chain.yml"));
    expect(mmd).toContain("%% node job:workflow:Linear-Chain:lint evidence=.github/workflows/linear-chain.yml:");
    expect(mmd).toMatch(/%% edge .* evidence=.github\/workflows\/linear-chain\.yml:/);
  });

  it("applies the highlight class only to explicitly requested node ids", () => {
    const graph = graphFor("linear-chain.yml");
    const mmd = renderWorkflowMermaid(graph, { highlight: ["job:workflow:Linear-Chain:build"] });
    expect(mmd).toContain("class job_workflow_Linear_Chain_build job,highlight");
    expect(mmd).not.toContain("class job_workflow_Linear_Chain_lint job,highlight");
  });

  it("respects focus_nodes to scope the diagram to a subset of the graph", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const mmd = renderWorkflowMermaid(graph, { focusNodeIds: ["job:workflow:Fan-Out-Fan-In:prepare"] });
    expect(mmd).toContain('["prepare"]');
    expect(mmd).not.toContain('["publish"]');
  });

  it("hides step nodes at the default jobs detail level but shows them at full", () => {
    const graph = graphFor("single-job.yml");
    const jobsLevel = renderWorkflowMermaid(graph);
    const fullLevel = renderWorkflowMermaid(graph, { detailLevel: "full" });
    expect(jobsLevel).not.toContain("actions/checkout@v4");
    expect(fullLevel).toContain("actions/checkout@v4");
  });
});
