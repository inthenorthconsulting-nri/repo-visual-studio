import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { renderWorkflowSvg } from "../render.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`../../../workflow-graph/src/__tests__/fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

function graphFor(name: string) {
  return parseWorkflowText(loadFixture(name), `.github/workflows/${name}`).graph;
}

describe("renderWorkflowSvg", () => {
  it("emits a well-formed, self-contained <svg> root with accessible title and desc", () => {
    const { svg } = renderWorkflowSvg(graphFor("linear-chain.yml"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<title>Linear Chain workflow diagram</title>");
    expect(svg).toMatch(/<desc>.*<\/desc>/s);
    expect(svg).toContain('role="img"');
  });

  it("contains no <script> tags and references no external assets", () => {
    const { svg } = renderWorkflowSvg(graphFor("environment-deploy.yml"));
    expect(svg).not.toContain("<script");
    // The only permitted "http://" occurrence is the required SVG XML namespace URI.
    const externalRefs = svg.match(/https?:\/\/(?!www\.w3\.org)/g);
    expect(externalRefs).toBeNull();
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<link");
  });

  it("renders visually distinct shape markup for different node types", () => {
    const { svg } = renderWorkflowSvg(graphFor("environment-deploy.yml"), { detailLevel: "full" });
    expect(svg).toContain('class="wf-node wf-node-trigger"');
    expect(svg).toContain('class="wf-node wf-node-job"');
    expect(svg).toContain('class="wf-node wf-node-environment"');
    // triggers are stadiums (rx = height/2 = 24), environments are hexagon polygons
    const triggerGroup = svg.match(/<g class="wf-node wf-node-trigger"[\s\S]*?<\/g>/)?.[0];
    expect(triggerGroup).toMatch(/<rect[^>]*rx="24"/);
    expect(svg).toContain("<polygon");
  });

  it("embeds evidence references as data attributes on nodes and edges", () => {
    const { svg } = renderWorkflowSvg(graphFor("linear-chain.yml"));
    expect(svg).toMatch(/data-node-id="job:workflow:Linear-Chain:lint"[^>]*data-evidence="\.github\/workflows\/linear-chain\.yml:/);
    expect(svg).toMatch(/data-edge-id="[^"]+"[^>]*data-evidence="\.github\/workflows\/linear-chain\.yml:/);
  });

  it("produces byte-identical output across repeated renders of the same graph (determinism)", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const first = renderWorkflowSvg(graph);
    const second = renderWorkflowSvg(graph);
    expect(first.svg).toBe(second.svg);
    expect(first.layout).toEqual(second.layout);
  });

  it("hides step nodes at the default jobs detail level but shows them at full", () => {
    const graph = graphFor("single-job.yml");
    const jobsLevel = renderWorkflowSvg(graph);
    const fullLevel = renderWorkflowSvg(graph, { detailLevel: "full" });
    expect(jobsLevel.svg).not.toContain("actions/checkout@v4");
    expect(fullLevel.svg).toContain("actions/checkout@v4");
  });

  it("respects focus_nodes to scope the diagram to a subset of the graph", () => {
    const graph = graphFor("fan-out-fan-in.yml");
    const { svg } = renderWorkflowSvg(graph, { focusNodeIds: ["job:workflow:Fan-Out-Fan-In:prepare"] });
    expect(svg).toContain('data-node-id="job:workflow:Fan-Out-Fan-In:prepare"');
    expect(svg).not.toContain('data-node-id="job:workflow:Fan-Out-Fan-In:publish"');
  });

  it("applies dashed styling to conditional needs edges and preserves their label", () => {
    const { svg } = renderWorkflowSvg(graphFor("conditional-job.yml"));
    expect(svg).toMatch(/wf-edge-conditional[^"]*"[\s\S]*?stroke-dasharray="6 4"/);
    expect(svg).toContain("needs (conditional)");
  });

  it("marks dynamic-confidence nodes with a distinguishing suffix and dashed shape", () => {
    const { svg } = renderWorkflowSvg(graphFor("matrix-job.yml"), { detailLevel: "full" });
    expect(svg).toContain("[dynamic]");
    expect(svg).toMatch(/data-confidence="dynamic"/);
  });

  it("only applies the highlight stroke to explicitly requested node ids", () => {
    const graph = graphFor("linear-chain.yml");
    const { svg } = renderWorkflowSvg(graph, { highlight: ["job:workflow:Linear-Chain:build"] });
    const buildNodeMatch = svg.match(/data-node-id="job:workflow:Linear-Chain:build"[\s\S]*?<\/g>/);
    const lintNodeMatch = svg.match(/data-node-id="job:workflow:Linear-Chain:lint"[\s\S]*?<\/g>/);
    expect(buildNodeMatch?.[0]).toContain('stroke="#f97316"');
    expect(lintNodeMatch?.[0]).not.toContain('stroke="#f97316"');
  });

  it("renders a legend only when multiple node types are present", () => {
    const multiType = renderWorkflowSvg(graphFor("environment-deploy.yml"));
    expect(multiType.svg).toContain("wf-legend");

    const text = ["name: Empty", "on: push", "jobs: {}", ""].join("\n");
    const { graph } = parseWorkflowText(text, ".github/workflows/empty.yml");
    const single = renderWorkflowSvg(graph);
    expect(single.svg).not.toContain("wf-legend");
  });

  it("escapes label text unsafe for XML/SVG", () => {
    const text = [
      'name: "Quote & <Tag> Test"',
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: 'Say \"hi\" <b>now</b>'",
      "        run: echo hi",
      "",
    ].join("\n");
    const { graph } = parseWorkflowText(text, ".github/workflows/quote-test.yml");
    const { svg } = renderWorkflowSvg(graph, { detailLevel: "full" });
    expect(svg).toContain("&quot;hi&quot;");
    expect(svg).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(svg).not.toContain('<b>now</b>');
  });

  it("returns a layout whose declared width/height cover every positioned node", () => {
    const { svg, layout } = renderWorkflowSvg(graphFor("fan-out-fan-in.yml"));
    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });
});
