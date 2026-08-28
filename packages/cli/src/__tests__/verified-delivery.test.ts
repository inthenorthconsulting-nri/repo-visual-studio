import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExplorerArtifact, buildExplorerModel } from "@rvs/visual-explorer";
import { buildChangeReviewArtifact, buildReviewAssembly } from "@rvs/visual-change-review";
import type { KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";
import { deliverVisualArtifact, requireProfile, upstreamFromChangeReview } from "@rvs/visual-delivery";
import type { VisualDeliveryOutcome } from "@rvs/visual-delivery";
import { runGraphBuildCommand } from "../commands/graph-build.js";
import { runGraphOpenCommand } from "../commands/graph-open.js";
import { collectChangeReviewSource, runGraphReviewCommand } from "../commands/graph-review.js";
import { archiveSnapshot, makeLogger, writeFullUpstreamFixtures, writeTwoSnapshots } from "./upstream-fixtures.js";

// Milestone 10.6 -- verified delivery, proved end to end.
//
// The claim being tested is narrow and total: a candidate replaces a verified
// artifact only after every check the profile requires has passed, and when
// one fails the file already on disk is still there, byte for byte.
//
// So almost nothing here is mocked. The repository is a real one built by
// `rvs graph build`, the artifact is the one `rvs graph open` really renders,
// the validators are the ones that own their rules, and the browser families
// run in a browser. A fabricated finding would prove that the plumbing carries
// a finding; it would not prove that the gate catches anything.

const EXPLORER = ".rvs/out/architecture-explorer.html";
const REVIEW = "artifacts/visuals/change-review.html";

function digestOfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("verified delivery: the explorer, end to end", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-verified-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  /** The artifact `rvs graph open` would render right now, without writing anything. */
  function render() {
    const nodes = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), "utf8"),
    ) as KnowledgeNode[];
    const edges = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/edges.json"), "utf8"),
    ) as KnowledgeEdge[];
    const model = buildExplorerModel({ nodes, edges, severities: [], decisions: [], focal_entity_ids: [] });
    return {
      model,
      artifact: buildExplorerArtifact({
        producer: "rvs graph open",
        subject: "Architecture",
        model,
        audience: "engineering",
        detail_mode: "balanced",
        focal_entity_ids: [],
        caption: "Interactive architecture explorer · engineering · balanced detail",
      }),
    };
  }

  /** Puts arbitrary candidate bytes through the same gate the command uses. */
  async function deliver(html: string): Promise<VisualDeliveryOutcome> {
    const { model, artifact } = render();
    return deliverVisualArtifact({
      repoRoot,
      artifact_type: "architecture_explorer",
      target_path: EXPLORER,
      html,
      profile: requireProfile("visual-interactive-v2"),
      spec: artifact.document.spec,
      coverage: artifact.document.coverage,
      critical_paths: model.paths.filter((p) => p.critical).map((p) => ({ id: p.id, node_ids: p.node_ids })),
      render_scale: artifact.document.primary.render.scale,
      source_digest: artifact.document.receipt.source_digest,
      metadata: {
        producer: "rvs graph open",
        fidelity_receipt_id: artifact.document.receipt.id,
        fidelity_receipt_digest: artifact.document.receipt.rendered_digest,
        source_snapshot_ids: [],
        upstream_artifact_ids: [...artifact.document.spec.generation_metadata.source_artifact_ids].sort(),
      },
      now: "2026-01-01T00:00:00.000Z",
    });
  }

  it("promotes a valid first candidate, and the target holds exactly the candidate's bytes", async () => {
    const logger = makeLogger();
    await runGraphOpenCommand(repoRoot, { verified: true }, logger);

    expect(logger.errors).toEqual([]);
    expect(process.exitCode).not.toBe(1);

    const target = resolve(repoRoot, EXPLORER);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("<!doctype html>");
    const said = logger.infos.join("\n");
    expect(said).toContain("Promoted verified artifact");
    // Milestone 10 closure C1: the default explorer profile is now v2, and
    // the console output must name it, not the retired v1 id.
    expect(said).toContain("visual-interactive-v2");
    expect(said).not.toContain("visual-interactive-v1");
  }, 180_000);

  // The acceptance proof (Milestone 10.6 s82). Three candidates in sequence
  // against one target: a valid one, an invalid one, and a corrected one.
  // The middle stage is the whole point -- what must survive it is not "a
  // file" but the exact bytes of the artifact that passed.
  it("promotes V1, refuses V2 leaving V1's exact bytes, then promotes V3", async () => {
    const target = resolve(repoRoot, EXPLORER);

    // --- V1: valid. Promoted.
    const v1 = await deliver(render().artifact.html);
    expect(v1.result.status).toBe("passed");
    expect(v1.promotion).toBe("promoted");
    const v1Digest = digestOfFile(target);
    expect(v1Digest).toBe(v1.result.candidate.artifact_digest);
    expect(v1.last_known_good?.artifact_digest).toBe(v1Digest);

    // --- V2: a real defect, caught by a real browser.
    //
    // A second element carrying an id the explorer's own controls already use.
    // Nothing about this is synthetic beyond the edit: `#rvs-search` is a
    // control the page addresses by id, and after this edit `getElementById`
    // returns whichever one the parser reached first. This is the Milestone
    // 10.5 s63 defect, turned into a gate.
    const broken = render().artifact.html.replace("</body>", '<span id="rvs-search"></span></body>');
    expect(broken).not.toBe(render().artifact.html);
    const v2 = await deliver(broken);

    expect(v2.result.status).toBe("failed");
    expect(v2.promotion).toBe("not_promoted");
    expect(v2.result.findings.map((f) => f.code)).toContain("RENDERED_DUPLICATE_ELEMENT_ID");
    // Bytes, not equivalence. The target is the artifact V1 put there.
    expect(digestOfFile(target)).toBe(v1Digest);
    expect(v2.last_known_good?.artifact_digest).toBe(v1Digest);
    expect(v2.receipt?.target_preserved).toBe(true);
    expect(v2.receipt?.last_known_good_id).toBe(v1.last_known_good?.verified_artifact_id);
    expect(existsSync(resolve(repoRoot, v2.receipt_path!))).toBe(true);

    // --- V3: corrected, and materially different from V1.
    const path = resolve(repoRoot, ".rvs/cache/architecture-intelligence.json");
    const architecture = JSON.parse(readFileSync(path, "utf8"));
    architecture.components.push({ id: "component:reporting-service", label: { displayLabel: "Reporting Service" } });
    writeFileSync(path, JSON.stringify(architecture));
    await runGraphBuildCommand(repoRoot, {}, makeLogger());

    const v3 = await deliver(render().artifact.html);
    expect(v3.result.status).toBe("passed");
    expect(v3.promotion).toBe("promoted");
    expect(v3.result.candidate.artifact_digest).not.toBe(v1Digest);
    expect(digestOfFile(target)).toBe(v3.result.candidate.artifact_digest);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The change review, end to end (Milestone 10.6 s83).
//
// Same three stages against the review surface, and one extra question the
// explorer cannot ask: a change review carries governance severity, decision
// state, impact routes and evidence references that came from four upstream
// artifacts. Delivery must move those bytes and change none of them.
// ---------------------------------------------------------------------------
describe("verified delivery: the change review, end to end", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-verified-review-"));
    await writeTwoSnapshots(repoRoot);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  /** The review `rvs graph review` would render right now, without writing anything. */
  function review() {
    const collected = collectChangeReviewSource(repoRoot, "snapshot-before", "snapshot-after");
    const assembly = buildReviewAssembly(collected.source);
    const artifact = buildChangeReviewArtifact({
      producer: "rvs graph review",
      subject: "Architecture change review",
      assembly,
      audience: "engineering",
      detail_mode: "balanced",
      initial_lens: "architecture",
      motion: "compare",
      caption: `${collected.before.snapshotId} → ${collected.after.snapshotId} · engineering · balanced detail`,
      source_artifact_ids: collected.sourceArtifactIds,
    });
    return { collected, assembly, artifact };
  }

  async function deliverReview(html: string): Promise<VisualDeliveryOutcome> {
    const { collected, assembly, artifact } = review();
    return deliverVisualArtifact({
      repoRoot,
      artifact_type: "change_review",
      target_path: REVIEW,
      html,
      profile: requireProfile("visual-change-review-v2"),
      spec: artifact.document.spec,
      coverage: artifact.document.coverage,
      critical_paths: assembly.visual.paths.filter((p) => p.critical).map((p) => ({ id: p.id, node_ids: p.node_ids })),
      render_scale: artifact.document.primary.render.scale,
      source_digest: artifact.document.receipt.source_digest,
      upstream_findings: upstreamFromChangeReview(artifact.findings),
      metadata: {
        producer: "rvs graph review",
        fidelity_receipt_id: artifact.document.receipt.id,
        fidelity_receipt_digest: artifact.document.receipt.rendered_digest,
        source_snapshot_ids: [collected.before.snapshotId, collected.after.snapshotId].sort(),
        upstream_artifact_ids: [...artifact.document.spec.generation_metadata.source_artifact_ids].sort(),
        change_review_model_id: artifact.model.id,
      },
      now: "2026-01-01T00:00:00.000Z",
    });
  }

  it("promotes through the real command, under the change-review profile", async () => {
    const logger = makeLogger();
    await runGraphReviewCommand(repoRoot, { from: "snapshot-before", to: "snapshot-after", verified: true }, logger);

    expect(logger.errors).toEqual([]);
    expect(existsSync(resolve(repoRoot, REVIEW))).toBe(true);
    const said = logger.infos.join("\n");
    expect(said).toContain("visual-change-review-v2");
    expect(said).not.toContain("visual-change-review-v1");
    expect(said).toContain("Promoted verified artifact");
  }, 300_000);

  it("promotes V1, refuses V2 leaving V1's exact bytes, then promotes V3", async () => {
    const target = resolve(repoRoot, REVIEW);

    const v1 = await deliverReview(review().artifact.html);
    expect(v1.result.status).toBe("passed");
    expect(v1.promotion).toBe("promoted");
    const v1Digest = digestOfFile(target);
    expect(v1Digest).toBe(v1.result.candidate.artifact_digest);

    // The same defect as the explorer's, on the surface that has its own copy
    // of the control: `#rvs-lens` is the lens selector the review addresses by
    // id, and a second element carrying it makes `getElementById` return
    // whichever the parser reached first.
    const broken = review().artifact.html.replace("</body>", '<span id="rvs-lens"></span></body>');
    const v2 = await deliverReview(broken);

    expect(v2.result.status).toBe("failed");
    expect(v2.promotion).toBe("not_promoted");
    expect(v2.result.findings.map((f) => f.code)).toContain("RENDERED_DUPLICATE_ELEMENT_ID");
    expect(digestOfFile(target)).toBe(v1Digest);
    expect(v2.receipt?.target_preserved).toBe(true);
    expect(v2.receipt?.last_known_good_id).toBe(v1.verified?.verified_artifact_id);

    // V3: a third snapshot, so the review genuinely says something different.
    const path = resolve(repoRoot, ".rvs/cache/architecture-intelligence.json");
    const architecture = JSON.parse(readFileSync(path, "utf8"));
    architecture.components.push({
      id: "component:notification-service",
      label: { displayLabel: "Notification Service" },
    });
    writeFileSync(path, JSON.stringify(architecture));
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
    archiveSnapshot(repoRoot, "snapshot-after");

    const v3 = await deliverReview(review().artifact.html);
    expect(v3.result.status).toBe("passed");
    expect(v3.promotion).toBe("promoted");
    expect(v3.result.candidate.artifact_digest).not.toBe(v1Digest);
    expect(digestOfFile(target)).toBe(v3.result.candidate.artifact_digest);
  }, 420_000);

  // s40. The gate reads the review; it does not get to edit it.
  it("delivers governance, decision and evidence lineage unchanged", async () => {
    const { assembly, artifact } = review();
    const outcome = await deliverReview(artifact.html);
    expect(outcome.promotion).toBe("promoted");

    const delivered = readFileSync(resolve(repoRoot, REVIEW), "utf8");
    const island = JSON.parse(
      delivered.split('<script type="application/json" id="rvs-review">')[1].split("</script>")[0],
    ) as {
      changes: Array<{ id: string; entity: string; findings: string[]; decisions: string[]; evidence: string[] }>;
    };

    const source = new Map(assembly.changes.map((change) => [change.id, change]));
    expect(island.changes.length).toBe(assembly.changes.length);
    for (const change of island.changes) {
      const original = source.get(change.id);
      expect(original, change.id).toBeDefined();
      expect(change.entity).toBe(original!.entity_id);
      expect(change.findings).toEqual(original!.governance_finding_ids);
      expect(change.decisions).toEqual(original!.decision_ids);
    }

    // And the candidate's own record points back at what produced it, by id
    // rather than by copy.
    expect(outcome.result.candidate.metadata.change_review_model_id).toBe(artifact.model.id);
    expect(outcome.result.candidate.metadata.source_snapshot_ids).toEqual(
      [assembly.from_snapshot_id, assembly.to_snapshot_id].sort(),
    );
    expect(outcome.result.candidate.metadata.fidelity_receipt_id).toBe(artifact.document.receipt.id);
  }, 300_000);

  // Milestone 10 closure -- rendered color independence, proved through the
  // real production path.
  //
  // `component:reporting-service` is the real "added" node this fixture's
  // second snapshot introduces (see writeTwoSnapshots): a real change,
  // resolved by the real `resolveVisualState`, drawn by the real renderer
  // into a real `data-rvs-marker="+"` attribute and a real "+" glyph. The
  // mutation below removes exactly what a `renderStateBadge`/`changeMarker`
  // regression removes -- the non-colour channel and nothing else, the fill
  // colour untouched -- which is the one thing B1 could ever have broken
  // again. Everything else about the candidate, including its own colour
  // styling for "added", stays real and untouched.
  it("refuses a change-review candidate whose added node kept its colour but lost its marker", async () => {
    const target = resolve(repoRoot, REVIEW);

    const v1 = await deliverReview(review().artifact.html);
    expect(v1.result.status).toBe("passed");
    expect(v1.promotion).toBe("promoted");
    expect(v1.result.findings.map((f) => f.code)).not.toContain("RENDERED_COLOR_ONLY_STATE");
    const v1Digest = digestOfFile(target);

    const { artifact } = review();
    const html = artifact.html;
    const nodeMarker = 'data-rvs-node="component:reporting-service"';
    expect(html).toContain(nodeMarker);
    expect(html).toContain('data-rvs-marker="+"');
    expect(html).toMatch(/<text[^>]*aria-hidden="true">\+<\/text>/);

    // Scope the mutation to exactly this node's own `<g>...</g>` -- other
    // "added" nodes in the same review share the same "+" marker text and
    // glyph, so a global string replace would strip only the first one it
    // finds and leave the others (and this test's own guard below) intact.
    // A node's `<g>` (renderNode, packages/visual-grammar/src/render.ts)
    // never nests another `<g>`, so the next "</g>" after this node's own
    // opening tag is genuinely this node's close.
    const nodeIdIndex = html.indexOf(nodeMarker);
    expect(nodeIdIndex).toBeGreaterThan(-1);
    const gStart = html.lastIndexOf("<g", nodeIdIndex);
    expect(gStart).toBeGreaterThan(-1);
    const gEnd = html.indexOf("</g>", nodeIdIndex) + "</g>".length;
    expect(gEnd).toBeGreaterThan(gStart);
    const nodeChunk = html.slice(gStart, gEnd);
    expect(nodeChunk).toContain('data-rvs-marker="+"');
    expect(nodeChunk).toMatch(/<text[^>]*aria-hidden="true">\+<\/text>/);

    const mutatedChunk = nodeChunk
      .replace('data-rvs-marker="+"', 'data-rvs-marker=""')
      .replace(/<text[^>]*aria-hidden="true">\+<\/text>/, "");
    expect(mutatedChunk).not.toBe(nodeChunk);
    expect(mutatedChunk).not.toContain('data-rvs-marker="+"');

    const colorOnly = html.slice(0, gStart) + mutatedChunk + html.slice(gEnd);
    expect(colorOnly).not.toBe(html);

    const outcome = await deliverReview(colorOnly);

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const accessibility = outcome.result.findings.filter((f) => f.family === "accessibility");
    expect(accessibility.map((f) => f.code)).toContain("RENDERED_COLOR_ONLY_STATE");
    const finding = accessibility.find((f) => f.code === "RENDERED_COLOR_ONLY_STATE")!;
    expect(finding.validator).toBe("@rvs/validator:validateColorIndependenceHtmlFile");
    expect(finding.subject_id).toBe("component:reporting-service");
    expect(finding.severity).toBe("blocking");
    expect(finding.required_value).toContain("marker");
    expect(finding.required_value).toContain("added");

    // Milestone 10 closure C2: the repair this receipt recommends must
    // actually restore the lost visual cue. `add-accessible-name` names a
    // screen-reader property and does nothing for a sighted colourblind
    // reader; `fix-contrast` is a different invariant entirely. Regression
    // guard against either ever being re-mapped back onto this code.
    expect(finding.supported_repairs).toContain("add-non-color-state-cue");
    expect(finding.supported_repairs).not.toContain("add-accessible-name");
    expect(finding.supported_repairs).not.toContain("fix-contrast");

    // Target preserved byte-for-byte -- the decisive proof (spec s25, s47).
    expect(digestOfFile(target)).toBe(v1Digest);
    expect(outcome.receipt?.target_preserved).toBe(true);
    expect(outcome.receipt?.last_known_good_id).toBe(v1.verified?.verified_artifact_id);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// The failure proofs (Milestone 10.6 s84-s87).
//
// Each case below breaks one real thing in an artifact a real renderer
// produced, and lets the validator that owns that rule find it. No finding is
// constructed; the assertions are on codes the validators emitted.
// ---------------------------------------------------------------------------
describe("verified delivery: what the gate catches", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-verified-fail-"));
    writeFullUpstreamFixtures(repoRoot);
    await runGraphBuildCommand(repoRoot, {}, makeLogger());
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function explorer() {
    const nodes = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/nodes.json"), "utf8"),
    ) as KnowledgeNode[];
    const edges = JSON.parse(
      readFileSync(resolve(repoRoot, ".rvs/cache/knowledge-graph/edges.json"), "utf8"),
    ) as KnowledgeEdge[];
    const model = buildExplorerModel({ nodes, edges, severities: [], decisions: [], focal_entity_ids: [] });
    return {
      model,
      artifact: buildExplorerArtifact({
        producer: "rvs graph open",
        subject: "Architecture",
        model,
        audience: "engineering",
        detail_mode: "balanced",
        focal_entity_ids: [],
        caption: "Interactive architecture explorer · engineering · balanced detail",
      }),
    };
  }

  interface Override {
    html?: string;
    critical_paths?: ReadonlyArray<{ id: string; node_ids: readonly string[] }>;
    launchOptions?: { executablePath: string };
    profile?: string;
  }

  async function deliver(over: Override = {}): Promise<VisualDeliveryOutcome> {
    const { model, artifact } = explorer();
    return deliverVisualArtifact({
      repoRoot,
      artifact_type: "architecture_explorer",
      target_path: EXPLORER,
      html: over.html ?? artifact.html,
      profile: requireProfile(over.profile ?? "visual-interactive-v2"),
      spec: artifact.document.spec,
      coverage: artifact.document.coverage,
      critical_paths:
        over.critical_paths ?? model.paths.filter((p) => p.critical).map((p) => ({ id: p.id, node_ids: p.node_ids })),
      render_scale: artifact.document.primary.render.scale,
      source_digest: artifact.document.receipt.source_digest,
      metadata: {
        producer: "rvs graph open",
        fidelity_receipt_id: artifact.document.receipt.id,
        fidelity_receipt_digest: artifact.document.receipt.rendered_digest,
        source_snapshot_ids: [],
        upstream_artifact_ids: [...artifact.document.spec.generation_metadata.source_artifact_ids].sort(),
      },
      now: "2026-01-01T00:00:00.000Z",
      ...(over.launchOptions === undefined ? {} : { launchOptions: over.launchOptions }),
    });
  }

  /** Promotes the real artifact, so every case below has a last known good to protect. */
  async function seed(): Promise<string> {
    const first = await deliver();
    expect(first.promotion).toBe("promoted");
    return digestOfFile(resolve(repoRoot, EXPLORER));
  }

  // s86. A theme regression, measured where a reader would meet it: the page
  // is rendered and its smallest text is measured on screen.
  it("refuses a candidate whose text renders below the legible floor", async () => {
    const good = await seed();
    const { artifact } = explorer();
    const shrunk = artifact.html.replace("</head>", "<style>body,p,span,li{font-size:7px}</style></head>");

    const outcome = await deliver({ html: shrunk });

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const accessibility = outcome.result.findings.filter((f) => f.family === "accessibility");
    expect(accessibility.map((f) => f.code)).toContain("rendered:min-font-size");
    const finding = accessibility.find((f) => f.code === "rendered:min-font-size")!;
    expect(finding.validator).toBe("@rvs/validator:validateHtmlFile");
    // One scene per colour scheme, so the subject names the scheme that failed.
    expect(finding.subject_id).toMatch(/^architecture-explorer@(light|dark)$/);
    expect(finding.required_value).toBe("14px");
    expect(finding.supported_repairs).toContain("increase-font-size");
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);

  // s85. A critical route the drawing did not keep. The route is declared by
  // upstream, the loss is found by @rvs/visual-intelligence's fidelity check,
  // and this layer only carries the answer.
  it("refuses a candidate that lost a critical path", async () => {
    const good = await seed();

    const outcome = await deliver({
      critical_paths: [{ id: "path:checkout", node_ids: ["entity:checkout-service", "entity:ledger"] }],
      profile: "visual-standard-v1",
    });

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const fidelity = outcome.result.findings.filter((f) => f.family === "fidelity");
    expect(fidelity.map((f) => f.code)).toContain("VISUAL_FIDELITY_CRITICAL_PATH_LOST");
    expect(fidelity[0].validator).toBe("@rvs/visual-intelligence:validateVisualCommunicationSpec");
    expect(fidelity[0].supported_repairs).toContain("restore-anchor");
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);

  // s87. Overflow, measured in a browser.
  //
  // The explorer and the review both declare `.scene` without a
  // `.scene-inner`, which is what tells the overflow rule that these pages
  // scroll on purpose -- so the surface that can overflow is a fixed-frame
  // scene, and that is what this candidate is.
  it("refuses a candidate whose content overflows its frame", async () => {
    const good = await seed();
    const overflowing = [
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Overflowing scene</title>",
      "<style>.scene{background:#ffffff;color:#111111}.scene-inner{height:200px;overflow:hidden}p{font-size:16px}</style>",
      "</head><body class=\"scene\" data-scene-id=\"architecture-explorer\" data-scene-type=\"architecture\">",
      "<div class=\"scene-inner\">",
      Array.from({ length: 40 }, (_, i) => `<p>Line ${i} of a component list that does not fit its frame.</p>`).join(""),
      "</div></body></html>",
    ].join("");

    const outcome = await deliver({ html: overflowing });

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const layout = outcome.result.findings.filter((f) => f.family === "layout");
    expect(layout.map((f) => f.code)).toContain("rendered:overflow");
    expect(layout[0].subject_id).toMatch(/^architecture-explorer@(light|dark)$/);
    expect(layout[0].message).toMatch(/overflows by \d+px/);
    expect(layout[0].supported_repairs).toEqual(
      expect.arrayContaining(["increase-spacing", "split-view", "reduce-detail"]),
    );
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);

  // s28 / s87. Overlap, the other half of the layout family.
  //
  // The frame rule above only speaks to fixed-frame scenes. This one speaks to
  // the surfaces the milestone actually delivers, which scroll: what they can
  // still get wrong is drawing two entities in the same place. The candidate
  // is the real explorer with every entity box pinned to one coordinate, so
  // what fails is measured geometry on a real drawing rather than a fixture
  // built to fail.
  it("refuses a candidate that draws its entity boxes on top of each other", async () => {
    const good = await seed();
    const { artifact } = explorer();
    const stacked = artifact.html.replace(
      "</head>",
      "<style>[data-rvs-node] rect{x:20px;y:20px;width:160px;height:60px}</style></head>",
    );

    const outcome = await deliver({ html: stacked });

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const layout = outcome.result.findings.filter((f) => f.family === "layout");
    expect(layout.map((f) => f.code)).toContain("rendered:node-overlap");
    const finding = layout.find((f) => f.code === "rendered:node-overlap")!;
    expect(finding.validator).toBe("@rvs/validator:validateHtmlFile");
    expect(finding.subject_id).toMatch(/^architecture-explorer@(light|dark)$/);
    expect(finding.message).toMatch(/^\d+ overlapping entity box pair\(s\): /);
    expect(finding.required_value).toBe("entity boxes drawn without overlap");
    expect(finding.supported_repairs).toEqual(
      expect.arrayContaining(["increase-spacing", "move-label", "reroute", "split-view"]),
    );
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);

  // s31 / s87. A control a keyboard user cannot name.
  it("refuses a candidate carrying a control with no accessible name", async () => {
    const good = await seed();
    const { artifact } = explorer();
    const unnamed = artifact.html.replace("</body>", '<button type="button" class="rvs-chip"></button></body>');

    const outcome = await deliver({ html: unnamed });

    expect(outcome.result.status).toBe("failed");
    expect(outcome.promotion).toBe("not_promoted");
    const interaction = outcome.result.findings.filter((f) => f.family === "interaction");
    expect(interaction.map((f) => f.code)).toContain("RENDERED_CONTROL_UNNAMED");
    expect(interaction[0].validator).toBe("@rvs/validator:validateInteractionHtmlFile");
    expect(interaction[0].supported_repairs).toContain("add-accessible-name");
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);

  // s76 / s80. Infrastructure failure is not a visual failure, and neither of
  // them is a promotion.
  it("calls verification incomplete when no browser can start, and keeps the target", async () => {
    const good = await seed();

    const outcome = await deliver({ launchOptions: { executablePath: join(repoRoot, "no-such-browser") } });

    expect(outcome.result.status).toBe("incomplete");
    expect(outcome.promotion).toBe("not_promoted");
    expect(outcome.result.incomplete_reason).toContain("Browser verification is unavailable");
    expect(outcome.result.findings.map((f) => f.code)).toContain("VISUAL_VERIFICATION_BROWSER_UNAVAILABLE");

    // The families that need a browser did not run; the ones that do not, did.
    const byFamily = new Map(outcome.result.validator_summary.families.map((f) => [f.family, f.status]));
    expect(byFamily.get("layout")).toBe("not_run");
    expect(byFamily.get("interaction")).toBe("not_run");
    expect(byFamily.get("schema")).toBe("passed");
    expect(byFamily.get("fidelity")).toBe("passed");

    // Nothing about the drawing was found wanting, and nothing was replaced.
    expect(outcome.receipt?.verification_status).toBe("incomplete");
    expect(outcome.receipt?.target_preserved).toBe(true);
    expect(digestOfFile(resolve(repoRoot, EXPLORER))).toBe(good);
  }, 300_000);
});
