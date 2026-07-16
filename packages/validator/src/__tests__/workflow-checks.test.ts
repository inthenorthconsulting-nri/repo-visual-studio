import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWorkflowText, selectSceneSubgraph } from "@rvs/workflow-graph";
import { renderWorkflowMermaid } from "@rvs/workflow-mermaid";
import { estimateLabelWidth, renderWorkflowSvg, NODE_TYPE_HEIGHTS } from "@rvs/workflow-svg";
import { describe, expect, it } from "vitest";
import {
  checkWorkflowLayoutOverlap,
  checkWorkflowLayoutTextOverflow,
  checkWorkflowRendererDivergence,
  checkWorkflowStepDetailCollapsed,
  runWorkflowChecks,
} from "../workflow-checks.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../../../workflow-graph/src/__tests__/fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function graphFor(name: string) {
  return parseWorkflowText(loadFixture(name), `.github/workflows/${name}`).graph;
}

describe("checkWorkflowStepDetailCollapsed", () => {
  it("warns when steps exist but detail_level hides them", () => {
    const graph = graphFor("single-job.yml");
    const warnings = checkWorkflowStepDetailCollapsed(graph, "jobs");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("WORKFLOW_STEP_DETAIL_COLLAPSED");
  });

  it("is silent at full detail level", () => {
    const graph = graphFor("single-job.yml");
    expect(checkWorkflowStepDetailCollapsed(graph, "full")).toEqual([]);
  });

  it("is silent for a graph with no step nodes even at a collapsed level", () => {
    const graph = graphFor("single-job.yml");
    const noSteps = { ...graph, nodes: graph.nodes.filter((n) => n.type !== "step") };
    expect(checkWorkflowStepDetailCollapsed(noSteps, "jobs")).toEqual([]);
  });
});

describe("checkWorkflowLayoutOverlap", () => {
  it("is silent on a well-formed layout", () => {
    const graph = graphFor("linear-chain.yml");
    const { layout } = renderWorkflowSvg(graph);
    expect(checkWorkflowLayoutOverlap(layout, graph.sourcePath)).toEqual([]);
  });

  it("flags two nodes whose bounding boxes intersect", () => {
    const layout = {
      width: 200,
      height: 200,
      nodes: [
        { id: "a", x: 0, y: 0, width: 100, height: 50, layer: 0 },
        { id: "b", x: 50, y: 25, width: 100, height: 50, layer: 0 },
      ],
      edges: [],
    };
    const warnings = checkWorkflowLayoutOverlap(layout, ".github/workflows/x.yml");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("WORKFLOW_LAYOUT_OVERLAP");
  });
});

describe("checkWorkflowLayoutTextOverflow", () => {
  it("flags a node whose label had to be truncated to fit its box", () => {
    const longLabel =
      "This is a very long step name that will absolutely not fit inside the maximum node width no matter how it is measured";
    const node = {
      id: "step:x",
      type: "step" as const,
      label: longLabel,
      evidence: [{ path: ".github/workflows/x.yml", lines: "1-1" }],
      confidence: "confirmed" as const,
    };
    const layout = {
      width: 300,
      height: 100,
      nodes: [{ id: "step:x", x: 0, y: 0, width: estimateLabelWidth(longLabel), height: NODE_TYPE_HEIGHTS.step, layer: 0 }],
      edges: [],
    };
    const warnings = checkWorkflowLayoutTextOverflow([node], layout);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("WORKFLOW_LAYOUT_TEXT_OVERFLOW");
  });

  it("is silent for a short label that fits", () => {
    const node = {
      id: "job:x",
      type: "job" as const,
      label: "build",
      evidence: [{ path: ".github/workflows/x.yml", lines: "1-1" }],
      confidence: "confirmed" as const,
    };
    const layout = {
      width: 300,
      height: 100,
      nodes: [{ id: "job:x", x: 0, y: 0, width: estimateLabelWidth("build"), height: NODE_TYPE_HEIGHTS.job, layer: 0 }],
      edges: [],
    };
    expect(checkWorkflowLayoutTextOverflow([node], layout)).toEqual([]);
  });
});

describe("checkWorkflowRendererDivergence", () => {
  it("is silent when Mermaid and SVG are rendered from the same selectSceneSubgraph call (the normal case)", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const mermaid = renderWorkflowMermaid(graph, { detailLevel: "full" });
    const { svg } = renderWorkflowSvg(graph, { detailLevel: "full" });
    expect(checkWorkflowRendererDivergence(mermaid, svg, graph.sourcePath)).toEqual([]);
  });

  it("flags a mismatch when one renderer's output covers a different node set", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const mermaid = renderWorkflowMermaid(graph, { detailLevel: "full" });
    const { svg } = renderWorkflowSvg(graph, { focusNodeIds: [graph.nodes[0].id] });
    const warnings = checkWorkflowRendererDivergence(mermaid, svg, graph.sourcePath);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("WORKFLOW_RENDERER_DIVERGENCE");
  });
});

describe("runWorkflowChecks", () => {
  it("aggregates checks across a real rendered fixture with no findings", () => {
    const graph = graphFor("environment-deploy.yml");
    const detailLevel = "jobs" as const;
    const { nodes: selectedNodes } = selectSceneSubgraph(graph, detailLevel);
    const mermaid = renderWorkflowMermaid(graph, { detailLevel });
    const { svg, layout } = renderWorkflowSvg(graph, { detailLevel });

    const warnings = runWorkflowChecks({ graph, detailLevel, selectedNodes, layout, mermaid, svg });
    expect(warnings.filter((w) => w.code === "WORKFLOW_LAYOUT_OVERLAP")).toEqual([]);
    expect(warnings.filter((w) => w.code === "WORKFLOW_RENDERER_DIVERGENCE")).toEqual([]);
  });
});
