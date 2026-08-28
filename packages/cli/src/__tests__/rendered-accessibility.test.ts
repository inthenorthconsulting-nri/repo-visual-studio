import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateHtmlFile, type ValidationReport } from "@rvs/validator";
import { buildExplorerArtifact, buildExplorerModel, type ExplorerSourceInput } from "@rvs/visual-explorer";
import {
  buildChangeReviewArtifact,
  buildReviewAssembly,
  type ChangeReviewSourceInput,
  type ReviewSourceEdge,
  type ReviewSourceNode,
} from "@rvs/visual-change-review";

// Proof 30/31 support and §64: the rendered accessibility checks the project
// already owns, run over the two interactive artifacts through the same
// entry point the packaged CLI calls.
//
// Before this milestone `rvs validate` looked only at deck.html, and
// @rvs/validator finds work by looking for `.scene` elements -- so these two
// surfaces were invisible to it and reported nothing at all. Both artifacts
// now declare the scene contract on their body, which is what makes the
// assertions below possible. When it was first turned on the explorer failed
// immediately, at 13.6px against a 14px floor, which is the reason the check
// is worth having rather than a formality.
//
// A real browser is involved, so these are slower than the rest of the suite.
// They are still semantic assertions, not image snapshots: what is asserted
// is the check outcome, never a pixel.

const DIR = mkdtempSync(join(tmpdir(), "rvs-a11y-"));

const explorerSource = (): ExplorerSourceInput => ({
  nodes: ["pkg-alpha", "alpha-api", "alpha-core", "alpha-store"].map((id, i) => ({
    id,
    node_type: i === 0 ? "package" : "component",
    label: id.toUpperCase(),
    source_entity_id: id,
    resolution_status: "resolved" as const,
    confidence: "confirmed" as const,
    evidence_refs: [{ path: `src/${id}.ts`, lines: "1-20" }],
  })),
  edges: [
    { id: "c1", edge_type: "contains", from_node_id: "pkg-alpha", to_node_id: "alpha-api", resolution_status: "resolved" as const },
    { id: "e1", edge_type: "depends_on", from_node_id: "alpha-api", to_node_id: "alpha-core", resolution_status: "resolved" as const },
    { id: "e2", edge_type: "depends_on", from_node_id: "alpha-core", to_node_id: "alpha-store", resolution_status: "resolved" as const },
  ],
  focal_entity_ids: ["alpha-api"],
  severities: [{ entity_id: "alpha-store", severity: "blocking" }],
});

const reviewNode = (id: string, over: Partial<ReviewSourceNode> = {}): ReviewSourceNode => ({
  id,
  node_type: "component",
  label: id.toUpperCase(),
  source_entity_id: id,
  resolution_status: "resolved",
  confidence: "confirmed",
  evidence_refs: [{ path: `src/${id}.ts`, lines: "1-40" }],
  ...over,
});

const reviewEdge = (from: string, to: string): ReviewSourceEdge => ({
  id: `e-${from}-${to}`,
  edge_type: "depends_on",
  from_node_id: from,
  to_node_id: to,
  resolution_status: "resolved",
  detail: `${from} depends on ${to}`,
});

/** One entity removed under a blocking finding, one added: every change state on one page. */
const reviewSource = (): ChangeReviewSourceInput => ({
  before: {
    snapshot_id: "snap-a",
    nodes: [reviewNode("api", { node_type: "runtime_entrypoint" }), reviewNode("orders"), reviewNode("billing")],
    edges: [reviewEdge("api", "orders"), reviewEdge("api", "billing")],
  },
  after: {
    snapshot_id: "snap-b",
    nodes: [reviewNode("api", { node_type: "runtime_entrypoint" }), reviewNode("orders"), reviewNode("payments")],
    edges: [reviewEdge("api", "orders"), reviewEdge("api", "payments")],
  },
  compatibility: { status: "compatible", reasons: [] },
  findings: [
    {
      id: "gf-1",
      severity: "blocking",
      statement: "billing was removed without a linked decision.",
      affected_entity_ids: ["billing"],
      human_review_required: true,
      evidence_refs: [{ source_artifact: "governance", path: "src/billing.ts", lines: "1-40" }],
    },
  ],
});

const explorerHtml = (): string =>
  buildExplorerArtifact({
    producer: "test",
    subject: "estate",
    model: buildExplorerModel(explorerSource()),
    audience: "engineering",
    detail_mode: "faithful",
    focal_entity_ids: ["alpha-api"],
  }).html;

const reviewHtml = (): string =>
  buildChangeReviewArtifact({
    producer: "test",
    subject: "estate",
    assembly: buildReviewAssembly(reviewSource()),
    audience: "engineering",
    detail_mode: "faithful",
  }).html;

// The same review with an upstream change set attached.
//
// `buildReviewAssembly` computes no diff -- `model.changes` arrives from
// `diffGraphs`, and without it the page says, in words, that the comparison
// found nothing material. That is a real state and worth checking, but it
// draws no entities, so anything asserting on geometry needs the drawn one.
const changedReviewHtml = (): string =>
  buildChangeReviewArtifact({
    producer: "test",
    subject: "estate",
    assembly: buildReviewAssembly({
      ...reviewSource(),
      graph_changes: {
        nodes_added: ["payments"],
        nodes_removed: ["billing"],
        edges_added: ["e-api-payments"],
        edges_removed: ["e-api-billing"],
      },
    }),
    audience: "engineering",
    detail_mode: "faithful",
  }).html;

// One artifact, measured under each polarity. The dark palette is not a
// second file: it lives behind `prefers-color-scheme: dark` in the same
// stylesheet, so the theme axis of §37's matrix is a browser preference here
// rather than a different build.
async function validated(
  name: string,
  html: string,
  colorScheme?: "light" | "dark",
): Promise<ValidationReport> {
  const path = join(DIR, `${name}.html`);
  writeFileSync(path, html);
  return validateHtmlFile(path, { minimumContrast: "AA", ...(colorScheme === undefined ? {} : { colorScheme }) });
}

const failures = (report: ValidationReport) =>
  report.scenes.flatMap((scene) => scene.checks.filter((c) => c.status === "fail").map((c) => `${c.rule}: ${c.message}`));

describe("the interactive artifacts face the project's own rendered checks", () => {
  it("finds the explorer, rather than reporting an empty page", async () => {
    // The failure mode this guards is the silent one. A checker that finds no
    // scenes reports zero failures, which reads exactly like a clean run.
    const report = await validated("explorer-light", explorerHtml());
    expect(report.summary.scenes).toBe(1);
    expect(report.scenes[0].scene_id).toBe("architecture-explorer");
  }, 60_000);

  it("finds the change-review viewer", async () => {
    const report = await validated("review-light", reviewHtml());
    expect(report.summary.scenes).toBe(1);
    expect(report.scenes[0].scene_id).toBe("architecture-change-review");
  }, 60_000);

  it("passes contrast and minimum type on both surfaces in both polarities", async () => {
    for (const [name, html] of [
      ["explorer", explorerHtml()],
      ["review", reviewHtml()],
    ] as const) {
      for (const polarity of ["light", "dark"] as const) {
        const report = await validated(`${name}-${polarity}`, html, polarity);
        expect(report.summary.scenes, `${name} ${polarity}`).toBe(1);
        expect(failures(report), `${name} ${polarity}`).toEqual([]);
      }
    }
  }, 120_000);

  it("asks for no evidence footer these surfaces do not have", async () => {
    // §26: the scene type is deliberately not one of the evidence-bearing
    // ones. These artifacts do carry evidence -- in the inspector and in the
    // fidelity receipt -- but not as a deck's `.citations` footer, and a
    // warning for a missing element that was never the right shape would be
    // noise a reviewer learns to ignore.
    const report = await validated("explorer-evidence", explorerHtml());
    expect(report.scenes[0].checks.filter((c) => c.status === "warn")).toEqual([]);
  }, 60_000);

  it("does not measure a scrolling document against a fixed slide frame", async () => {
    // No `.scene-inner`, so no overflow check. These pages scroll by design;
    // failing them for it would be the checker being wrong, not the page.
    const report = await validated("explorer-overflow", explorerHtml());
    expect(report.scenes[0].checks.map((c) => c.rule)).not.toContain("overflow");
  }, 60_000);

  // The other half of that fact. A surface exempt from the frame rule is not
  // a surface exempt from layout: what these pages can still get wrong is
  // drawing two entities in the same place, and that is measured here.
  it("measures entity geometry on both surfaces, and finds them drawn apart", async () => {
    for (const [name, html] of [
      ["explorer", explorerHtml()],
      ["review", changedReviewHtml()],
    ] as const) {
      const report = await validated(`${name}-overlap`, html);
      const check = report.scenes[0].checks.find((c) => c.rule === "node-overlap");
      expect(check?.status, name).toBe("pass");
      // Not the vacuous pass. The message carries the count it measured, so a
      // page that stopped drawing entities entirely cannot pass by having
      // nothing to check.
      expect(check?.message, name).toMatch(/^[1-9]\d* entity boxes drawn without overlap$/);
    }
  }, 120_000);

  it("fails a drawing whose entity boxes sit on top of each other", async () => {
    // The rule proved against a page that really does overlap, rather than
    // against the absence of one. Two boxes, same coordinates, one id apiece.
    const overlapping = [
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Overlapping</title>',
      "<style>.scene{background:#ffffff;color:#111111}</style></head>",
      '<body class="scene" data-scene-id="overlapping" data-scene-type="architecture">',
      '<svg width="400" height="200" viewBox="0 0 400 200" data-rvs-stage="1">',
      '<g id="v-n-a" data-rvs-node="a"><rect x="20" y="20" width="160" height="60" fill="#eeeeee"></rect></g>',
      '<g id="v-n-b" data-rvs-node="b"><rect x="100" y="40" width="160" height="60" fill="#dddddd"></rect></g>',
      "</svg></body></html>",
    ].join("");

    const report = await validated("overlapping", overlapping);
    const check = report.scenes[0].checks.find((c) => c.rule === "node-overlap");
    expect(check?.status).toBe("fail");
    expect(check?.message).toBe("1 overlapping entity box pair(s): v-n-a / v-n-b");
  }, 60_000);

  it("does not call two views of one page a collision", async () => {
    // A multi-view composition stacks drawings that share the viewport. Two
    // separate `<svg>` roots overlapping on screen is the page laying itself
    // out, not two entities in the same place -- so identical geometry in two
    // roots has to pass.
    const stacked = [
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stacked views</title>',
      "<style>.scene{background:#ffffff;color:#111111}svg{position:absolute;left:0;top:0}</style></head>",
      '<body class="scene" data-scene-id="stacked" data-scene-type="architecture">',
      '<svg width="400" height="200" viewBox="0 0 400 200" data-rvs-stage="1">',
      '<g id="v1-n-a" data-rvs-node="a"><rect x="20" y="20" width="160" height="60" fill="#eeeeee"></rect></g>',
      "</svg>",
      '<svg width="400" height="200" viewBox="0 0 400 200" data-rvs-stage="1">',
      '<g id="v2-n-a" data-rvs-node="a"><rect x="20" y="20" width="160" height="60" fill="#dddddd"></rect></g>',
      "</svg></body></html>",
    ].join("");

    const report = await validated("stacked", stacked);
    const check = report.scenes[0].checks.find((c) => c.rule === "node-overlap");
    expect(check?.status).toBe("pass");
    expect(check?.message).toBe("2 entity boxes drawn without overlap");
  }, 60_000);
});
