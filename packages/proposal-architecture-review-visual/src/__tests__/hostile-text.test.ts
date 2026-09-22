// Hostile caller-controlled text (Milestone 11.3.3.2B-T). Graph surfaces are
// checked through the real composed render path (composeVisualDocument ->
// grammar renderer) using the repository's own tags-only inspection method.
// Proposed Delta is structured data with no renderer in this package; its
// boundary is verbatim, untransformed pass-through, and HTML/export rendering
// of it is deferred.

import { describe, expect, it } from "vitest";
import type { AddEntityOperation, ModifyAttributesOperation, ModifyRelationOperation, RemoveEntityOperation } from "@rvs/change-workbench";
import { buildProposalArchitectureVisualReview, composeProposalArchitectureReviewDocument } from "../compose.js";
import { BASELINE_NODE_A, BASELINE_NODE_B, buildFixtureModel, kEdge, kNode } from "./fixtures.js";

const HOSTILE = [
  `</text><script>alert(1)</script><text>`,
  `" onload="alert(1)`,
  `' onmouseover='alert(1)`,
  `<img src=x onerror=alert(1)>`,
  `javascript:alert(1)`,
  `a & b < c > d "q" 'r'`,
];

const tagsOf = (svg: string) => [...svg.matchAll(/<[^>]*>/g)].map((m) => m[0]).join("\n");

function expectInert(svg: string, where: string) {
  const tags = tagsOf(svg);
  expect(tags, where).not.toMatch(/<script/i);
  expect(tags, where).not.toMatch(/<\s*(iframe|foreignObject|use|image|animate|set|a)\b/i);
  expect(tags, where).not.toMatch(/\son[a-z]+\s*=/i);
  expect(tags, where).not.toMatch(/\s(?:xlink:)?href\s*=/i);
  expect(tags, where).not.toMatch(/javascript:/i);
  expect(svg.split("<").length, where).toBe(svg.split(">").length);
}

function hostileModel(payload: string) {
  const overlay = {
    repository_id: "repo-1",
    base_snapshot_digest: "digest-1",
    nodes: [kNode({ id: "node-a", label: payload }), kNode({ id: "node-b", label: `also ${payload}` })],
    edges: [kEdge({ id: "e1", from_node_id: "node-a", to_node_id: "node-b", edge_type: "depends_on", detail: payload })],
    node_provenance: { "node-a": "modified", "node-b": "proposed" } as const,
    edge_provenance: { "node-a:depends_on:node-b": "proposed" } as const,
  };
  return buildFixtureModel({
    observed_baseline: {
      nodes: [{ ...BASELINE_NODE_A, label: payload }, { ...BASELINE_NODE_B, label: `also ${payload}` }],
      edges: [kEdge({ id: "edge-ab", from_node_id: "node-a", to_node_id: "node-b", detail: payload })],
    },
    projected_state: { status: "built", result: { status: "ok", overlay, issues: [] } } as never,
  });
}

const OPTIONS = { producer: "test", audience: "engineering", detail_mode: "faithful", format: "slide" } as const;

describe("escapes hostile caller-controlled graph labels through composed rendering", () => {
  for (const payload of HOSTILE) {
    it(`renders an inert Observed Baseline and Projected State for ${JSON.stringify(payload)}`, () => {
      const review = buildProposalArchitectureVisualReview(hostileModel(payload));
      const docs = composeProposalArchitectureReviewDocument(review, OPTIONS);
      expectInert(docs.observed_baseline.primary.render.svg, "observed baseline");
      if (docs.projected_state.status !== "built") throw new Error("expected built projection");
      const projected = docs.projected_state.document;
      expectInert(projected.primary.render.svg, "projected state");
      for (const detail of [...docs.observed_baseline.details, ...projected.details]) expectInert(detail.render.svg, "detail view");
    });
  }

  it("keeps hostile text as escaped literal text rather than stripping it", () => {
    const review = buildProposalArchitectureVisualReview(hostileModel(`<Root> & "quoted"`));
    const docs = composeProposalArchitectureReviewDocument(review, OPTIONS);
    expect(docs.observed_baseline.primary.render.svg).toContain("&lt;Root&gt;");
    expect(docs.observed_baseline.primary.render.svg).toContain("&amp;");
  });

  it("carries provenance marker labels into rendered output inertly", () => {
    const review = buildProposalArchitectureVisualReview(hostileModel(HOSTILE[0]));
    const docs = composeProposalArchitectureReviewDocument(review, { ...OPTIONS, interactive: true });
    if (docs.projected_state.status !== "built") throw new Error("expected built projection");
    expectInert(docs.projected_state.document.primary.render.svg, "interactive projected state");
  });
});

describe("Proposed Delta passes hostile caller-authored operation data through verbatim as structured data", () => {
  it("does not transform, drop, or execute hostile operation values", () => {
    const payload = HOSTILE[0];
    const operations = [
      { kind: "add_entity", ref: "proposed-x", node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "x", label: payload, repository_id: "repo-1" } as unknown as AddEntityOperation,
      { kind: "remove_entity", ref: "node-c", detail: payload } as unknown as RemoveEntityOperation,
      { kind: "modify_attributes", ref: "node-a", attributes: { label: payload } } as unknown as ModifyAttributesOperation,
      { kind: "modify_relation", from_ref: "node-a", to_ref: "node-b", edge_type: "depends_on", attributes: { detail: payload } } as unknown as ModifyRelationOperation,
    ];
    const review = buildProposalArchitectureVisualReview(buildFixtureModel({ proposed_delta: { operations } }));
    expect(review.proposed_delta.operations).toHaveLength(4);
    const serialized = JSON.stringify(review.proposed_delta.operations);
    expect(serialized).toContain(JSON.stringify(payload).slice(1, -1));
    expect((review.proposed_delta.operations[0] as { label?: string }).label).toBe(payload);
    expect("svg" in (review.proposed_delta as object)).toBe(false);
  });
});
