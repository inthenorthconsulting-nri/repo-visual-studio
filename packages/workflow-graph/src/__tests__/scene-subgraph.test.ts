import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWorkflowText } from "../parse-workflow.js";
import { selectSceneSubgraph } from "../scene-subgraph.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

describe("selectSceneSubgraph: jobs detail level", () => {
  it("hides step nodes and contains edges, keeps trigger/job nodes and needs/starts edges", () => {
    const { graph } = parseWorkflowText(loadFixture("linear-chain.yml"), ".github/workflows/linear-chain.yml");
    const { nodes, edges } = selectSceneSubgraph(graph, "jobs");
    expect(nodes.every((n) => n.type !== "step")).toBe(true);
    expect(nodes.some((n) => n.type === "job")).toBe(true);
    expect(nodes.some((n) => n.type === "trigger")).toBe(true);
    expect(edges.every((e) => e.type !== "contains")).toBe(true);
    expect(edges.some((e) => e.type === "needs")).toBe(true);
  });

  it("summary produces the same node/edge set as jobs (both are job-level rollups)", () => {
    const { graph } = parseWorkflowText(loadFixture("fan-out-fan-in.yml"), ".github/workflows/fan-out-fan-in.yml");
    const jobs = selectSceneSubgraph(graph, "jobs");
    const summary = selectSceneSubgraph(graph, "summary");
    expect(jobs.nodes.map((n) => n.id).sort()).toEqual(summary.nodes.map((n) => n.id).sort());
    expect(jobs.edges.map((e) => e.id).sort()).toEqual(summary.edges.map((e) => e.id).sort());
  });
});

describe("selectSceneSubgraph: full detail level", () => {
  it("returns every node and edge in the graph, unfiltered", () => {
    const { graph } = parseWorkflowText(loadFixture("single-job.yml"), ".github/workflows/single-job.yml");
    const { nodes, edges } = selectSceneSubgraph(graph, "full");
    expect(nodes).toHaveLength(graph.nodes.length);
    expect(edges).toHaveLength(graph.edges.length);
  });
});

describe("selectSceneSubgraph: jobs-and-key-steps detail level", () => {
  it("includes only the first and last step of a job with no artifact steps", () => {
    const { graph } = parseWorkflowText(loadFixture("single-job.yml"), ".github/workflows/single-job.yml");
    // single-job.yml's build job has exactly 2 steps, so both are "first and last".
    const { nodes } = selectSceneSubgraph(graph, "jobs-and-key-steps");
    const steps = nodes.filter((n) => n.type === "step");
    expect(steps).toHaveLength(2);
  });

  it("always includes an artifact-adjacent step even in the middle of a longer job", () => {
    const text = [
      "name: Middle Artifact",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo one",
      "      - uses: actions/upload-artifact@v4",
      "        with:",
      "          name: dist",
      "      - run: echo two",
      "      - run: echo three",
      "",
    ].join("\n");
    const { graph } = parseWorkflowText(text, ".github/workflows/middle-artifact.yml");
    const { nodes } = selectSceneSubgraph(graph, "jobs-and-key-steps");
    const stepLabels = nodes.filter((n) => n.type === "step").map((n) => n.label);
    expect(stepLabels).toContain("actions/upload-artifact@v4");
    expect(stepLabels).toContain("echo one");
    expect(stepLabels).toContain("echo three");
    expect(stepLabels).not.toContain("echo two");
    expect(nodes.some((n) => n.type === "artifact")).toBe(true);
  });
});

describe("selectSceneSubgraph: focus_nodes scoping", () => {
  it("restricts an already-filtered subgraph to only the requested node ids and edges between them", () => {
    const { graph } = parseWorkflowText(loadFixture("fan-out-fan-in.yml"), ".github/workflows/fan-out-fan-in.yml");
    const prepare = "job:workflow:Fan-Out-Fan-In:prepare";
    const unitTests = "job:workflow:Fan-Out-Fan-In:unit-tests";
    const { nodes, edges } = selectSceneSubgraph(graph, "jobs", [prepare, unitTests]);
    expect(nodes.map((n) => n.id).sort()).toEqual([prepare, unitTests].sort());
    expect(edges.every((e) => [prepare, unitTests].includes(e.from) && [prepare, unitTests].includes(e.to))).toBe(true);
  });
});
