import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildVisualCommunicationSpec,
  emptyVisualGraphModel,
  type VisualCommunicationSpec,
  type VisualNode,
} from "@rvs/visual-intelligence";
import type { EntityCoverage } from "@rvs/visual-composition";
import { deliverVisualArtifact, deliveryConsoleLines, deliveryRootPath } from "../deliver.js";
import { readVerifiedHistory } from "../history.js";
import { requireProfile } from "../validation-profile.js";
import { RECEIPT_FILE, RECEIPT_MARKDOWN_FILE, VERIFICATION_REPORT_FILE } from "../receipts.js";
import type { VisualDeliveryOutcome } from "../contracts.js";

// The delivery decision, end to end within this package.
//
// The property under test is a single sentence: after any run, the target
// holds either the bytes of a candidate that passed, or exactly the bytes it
// held before. Everything else here -- receipts, reports, cleanup, console
// lines -- exists to explain which of those two happened.
//
// The profile is `visual-standard-v1`, whose families need no browser, so
// these runs are fast and offline. The browser-backed profiles are proved
// against real rendered artifacts in @rvs/cli's end-to-end suite; duplicating
// that here would test Playwright rather than this module.

const PROFILE = requireProfile("visual-standard-v1");
const TARGET = "artifacts/visuals/architecture.html";

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "rvs-delivery-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function node(id: string): VisualNode {
  return {
    id,
    source_entity_id: id,
    label: id,
    kind: "component",
    emphasis: "normal",
    resolution: "resolved",
    confidence: "confirmed",
    evidence_refs: [],
  };
}

function specFor(ids: string[]): VisualCommunicationSpec {
  return buildVisualCommunicationSpec({
    producer: "delivery-test",
    subject: "fixture",
    semantic_intent: "architecture",
    model: { ...emptyVisualGraphModel(), nodes: ids.map(node) },
    audience: "engineering",
    detail_mode: "faithful",
    format: "interactive",
  }).spec;
}

function coverageFor(spec: VisualCommunicationSpec, unaccounted: string[] = []): EntityCoverage {
  return {
    source_entity_ids: [...spec.source_entity_ids],
    primary_entity_ids: spec.source_entity_ids.filter((id) => !unaccounted.includes(id)),
    detail_entity_ids: [],
    collapsed_entity_ids: [],
    hidden_entity_ids: [],
    unaccounted_entity_ids: [...unaccounted],
  };
}

interface DeliverOptions {
  html?: string;
  /** Entities the drawing silently dropped. A real, validator-detected fidelity loss. */
  unaccounted?: string[];
  ids?: string[];
  now?: string;
  run_retention?: number;
}

async function deliver(options: DeliverOptions = {}): Promise<VisualDeliveryOutcome> {
  const spec = specFor(options.ids ?? ["svc-api", "svc-payments"]);
  return deliverVisualArtifact({
    repoRoot,
    artifact_type: "architecture_explorer",
    target_path: TARGET,
    html: options.html ?? "<!doctype html><html><head><title>V</title></head><body></body></html>",
    profile: PROFILE,
    spec,
    coverage: coverageFor(spec, options.unaccounted ?? []),
    critical_paths: [],
    render_scale: 1,
    source_digest: "a".repeat(64),
    metadata: {
      producer: "delivery-test",
      fidelity_receipt_id: "fr_1",
      fidelity_receipt_digest: "b".repeat(64),
      source_snapshot_ids: [],
      upstream_artifact_ids: [],
    },
    now: options.now ?? "2026-01-01T00:00:00.000Z",
    ...(options.run_retention === undefined ? {} : { run_retention: options.run_retention }),
  });
}

function targetDigest(): string | null {
  const path = resolve(repoRoot, TARGET);
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeTarget(html: string): void {
  const path = resolve(repoRoot, TARGET);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

function runDirectories(): string[] {
  const runs = resolve(repoRoot, deliveryRootPath(repoRoot), "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs).sort();
}

describe("a candidate that passes", () => {
  it("is promoted, and the target holds the candidate's exact bytes", async () => {
    const outcome = await deliver({ html: "<!doctype html><title>first</title>" });

    expect(outcome.result.status).toBe("passed");
    expect(outcome.promotion).toBe("promoted");
    expect(outcome.target_digest_before).toBeNull();
    expect(outcome.target_digest_after).toBe(outcome.result.candidate.artifact_digest);
    expect(targetDigest()).toBe(outcome.result.candidate.artifact_digest);
    expect(readFileSync(resolve(repoRoot, TARGET), "utf8")).toBe("<!doctype html><title>first</title>");
  });

  it("records the verified artifact only after the bytes are at the target", async () => {
    const outcome = await deliver();
    const history = readVerifiedHistory(repoRoot, TARGET);

    expect(history.current?.verified_artifact_id).toBe(outcome.verified?.verified_artifact_id);
    expect(history.current?.artifact_digest).toBe(targetDigest());
    expect(history.current?.profile_id).toBe(PROFILE.id);
    expect(history.current?.profile_version).toBe(PROFILE.version);
    expect(history.previous).toEqual([]);
  });

  it("replaces an earlier verified artifact and remembers the one it replaced", async () => {
    const first = await deliver({ html: "<!doctype html><title>first</title>" });
    const second = await deliver({ html: "<!doctype html><title>second</title>" });

    expect(second.promotion).toBe("promoted");
    expect(second.target_digest_before).toBe(first.result.candidate.artifact_digest);
    expect(targetDigest()).toBe(second.result.candidate.artifact_digest);

    const history = readVerifiedHistory(repoRoot, TARGET);
    expect(history.current?.verified_artifact_id).toBe(second.verified?.verified_artifact_id);
    expect(history.previous.map((entry) => entry.verified_artifact_id)).toEqual([
      first.verified?.verified_artifact_id,
    ]);
  });

  it("leaves no staged copy behind, because the target is now the copy", async () => {
    const outcome = await deliver();
    expect(existsSync(resolve(repoRoot, outcome.result.candidate.source_path))).toBe(false);
    // The run's evidence stays: the report is what says why this passed.
    expect(existsSync(resolve(repoRoot, outcome.report_path))).toBe(true);
    expect(outcome.receipt).toBeNull();
    expect(outcome.receipt_path).toBeNull();
  });

  it("calls the preview verified, and points at a file that exists", async () => {
    const outcome = await deliver();
    expect(outcome.preview.status).toBe("verified");
    expect(outcome.preview.status_label).toBe("Verified");
    expect(outcome.preview.url).toMatch(/^file:\/\//);
    expect(outcome.preview.url).toContain("architecture.html");
  });
});

describe("a candidate that fails", () => {
  // The failure is a real one: an entity the drawing neither shows, collapses,
  // splits nor declares hidden. `validateEntityCoverage` raises it; nothing
  // here fabricates a finding to force the branch.
  const LOST = { unaccounted: ["svc-payments"] };

  it("does not reach the target, and leaves the last known good byte-for-byte", async () => {
    const good = await deliver({ html: "<!doctype html><title>good</title>" });
    const goodDigest = targetDigest();

    const bad = await deliver({ ...LOST, html: "<!doctype html><title>bad</title>" });

    expect(bad.result.status).toBe("failed");
    expect(bad.result.findings.map((f) => f.code)).toContain("VISUAL_COVERAGE_ENTITY_UNACCOUNTED");
    expect(bad.promotion).toBe("not_promoted");
    expect(targetDigest()).toBe(goodDigest);
    expect(bad.target_digest_before).toBe(goodDigest);
    expect(bad.target_digest_after).toBe(goodDigest);
    expect(bad.last_known_good?.verified_artifact_id).toBe(good.verified?.verified_artifact_id);
    expect(readVerifiedHistory(repoRoot, TARGET).current?.artifact_digest).toBe(goodDigest);
  });

  it("writes the receipt, in both the machine form and the readable one", async () => {
    const bad = await deliver(LOST);

    expect(bad.receipt_path).toContain(RECEIPT_FILE);
    expect(bad.receipt_markdown_path).toContain(RECEIPT_MARKDOWN_FILE);
    expect(bad.report_path).toContain(VERIFICATION_REPORT_FILE);

    const json = JSON.parse(readFileSync(resolve(repoRoot, bad.receipt_path!), "utf8"));
    expect(json.receipt_id).toBe(bad.receipt?.receipt_id);
    expect(json.target_preserved).toBe(true);
    expect(readFileSync(resolve(repoRoot, bad.receipt_markdown_path!), "utf8")).toContain(
      "VISUAL_COVERAGE_ENTITY_UNACCOUNTED",
    );
  });

  it("keeps the rejected candidate on disk, so the reader can open what failed", async () => {
    const bad = await deliver(LOST);
    const staged = resolve(repoRoot, bad.result.candidate.source_path);
    expect(existsSync(staged)).toBe(true);
    // Kept, but only after the diagnostics that explain it are already written.
    expect(existsSync(resolve(repoRoot, bad.receipt_path!))).toBe(true);
  });

  it("tells the reader they are looking at the older artifact, not their edit", async () => {
    await deliver();
    const bad = await deliver(LOST);
    expect(bad.preview.status).toBe("last-known-good-retained");
    expect(bad.preview.status_label).toBe("Last known good retained");
  });

  it("writes nothing at all when the first candidate ever is the one that fails", async () => {
    const bad = await deliver(LOST);
    expect(bad.promotion).toBe("not_promoted");
    expect(existsSync(resolve(repoRoot, TARGET))).toBe(false);
    expect(bad.last_known_good).toBeNull();
    expect(bad.preview.status).toBe("candidate-rejected");
    expect(bad.preview.url).toBeNull();
  });
});

describe("an artifact already at the target that nobody verified", () => {
  it("is reported as present without a verification record, and is not destroyed by a failure", async () => {
    writeTarget("<!doctype html><title>hand-written</title>");
    const before = targetDigest();

    const bad = await deliver({ unaccounted: ["svc-payments"] });

    expect(bad.promotion).toBe("not_promoted");
    expect(bad.last_known_good).toBeNull();
    expect(targetDigest()).toBe(before);
    expect(deliveryConsoleLines(bad).join("\n")).toContain("An unverified artifact was already at");
  });

  it("is replaced by the first candidate that passes, which becomes the first verified artifact", async () => {
    writeTarget("<!doctype html><title>hand-written</title>");
    const outcome = await deliver({ html: "<!doctype html><title>verified</title>" });

    expect(outcome.promotion).toBe("promoted");
    expect(targetDigest()).toBe(outcome.result.candidate.artifact_digest);
    expect(readVerifiedHistory(repoRoot, TARGET).previous).toEqual([]);
  });
});

describe("generations", () => {
  it("never lets a candidate replace a verified artifact newer than itself", async () => {
    // Both runs are in flight at once, which is what watch mode does when a
    // second edit lands before the first candidate has finished. Whichever
    // finishes first, the newer generation is what the target must end up
    // holding -- an older candidate finishing late must not undo it.
    const [a, b] = await Promise.all([
      deliver({ html: "<!doctype html><title>A</title>" }),
      deliver({ html: "<!doctype html><title>B</title>" }),
    ]);

    expect(a.result.candidate.generation).toBeLessThan(b.result.candidate.generation);
    expect(b.promotion).toBe("promoted");
    expect(targetDigest()).toBe(b.result.candidate.artifact_digest);
    expect(readFileSync(resolve(repoRoot, TARGET), "utf8")).toBe("<!doctype html><title>B</title>");

    if (a.promotion === "not_promoted") {
      expect(a.promotion_reason).toContain(`generation ${a.result.candidate.generation}`);
      expect(a.receipt?.target_preserved).toBe(true);
    }
    expect(readVerifiedHistory(repoRoot, TARGET).current?.artifact_digest).toBe(
      b.result.candidate.artifact_digest,
    );
  });

  it("gives every run its own generation and its own directory", async () => {
    const first = await deliver({ html: "<!doctype html><title>1</title>" });
    const second = await deliver({ html: "<!doctype html><title>2</title>" });

    expect(second.result.candidate.generation).toBe(first.result.candidate.generation + 1);
    expect(second.result.candidate.run_id).not.toBe(first.result.candidate.run_id);
  });

  it("keeps a bounded number of finished runs and always keeps the current one", async () => {
    for (let index = 0; index < 5; index += 1) {
      await deliver({ html: `<!doctype html><title>${index}</title>`, run_retention: 2 });
    }
    const runs = runDirectories();
    expect(runs.length).toBeLessThanOrEqual(3);
    expect(runs).toContain("run-000005");
  });
});

describe("determinism", () => {
  it("gives the same identity, the same digest and the same receipt across five runs", async () => {
    const outcomes: VisualDeliveryOutcome[] = [];
    for (let index = 0; index < 5; index += 1) {
      outcomes.push(await deliver({ unaccounted: ["svc-payments"], now: `2026-01-0${index + 1}T00:00:00.000Z` }));
    }

    const first = outcomes[0];
    for (const outcome of outcomes.slice(1)) {
      expect(outcome.result.candidate.candidate_id).toBe(first.result.candidate.candidate_id);
      expect(outcome.result.verification_digest).toBe(first.result.verification_digest);
      expect(outcome.receipt?.receipt_id).toBe(first.receipt?.receipt_id);
      expect(outcome.receipt?.findings).toEqual(first.receipt?.findings);
      expect(outcome.promotion).toBe("not_promoted");
    }
    // The wall clock differed on every run and changed none of it.
    expect(new Set(outcomes.map((o) => o.result.candidate.created_at)).size).toBe(5);
  });

  it("promotes byte-identical output for byte-identical input", async () => {
    const first = await deliver({ html: "<!doctype html><title>same</title>" });
    const second = await deliver({ html: "<!doctype html><title>same</title>" });

    expect(second.result.candidate.artifact_digest).toBe(first.result.candidate.artifact_digest);
    expect(second.verified?.verified_artifact_id).toBe(first.verified?.verified_artifact_id);
    expect(targetDigest()).toBe(first.result.candidate.artifact_digest);
  });
});

describe("the console lines", () => {
  it("say what was generated, what ran, what happened and where to look", async () => {
    const lines = deliveryConsoleLines(await deliver());
    expect(lines[0]).toMatch(/^Generated candidate vdc_[0-9a-f]{24} \(generation 1\)\.$/);
    expect(lines[1]).toMatch(/^Ran \d+ checks across \d+ validator families under visual-standard-v1\.$/);
    expect(lines[2]).toBe(`Promoted verified artifact to ${TARGET}.`);
    expect(lines.join("\n")).toContain("Preview: Verified — file://");
    expect(lines.join("\n")).not.toContain("{");
  });

  it("name the preserved artifact when a candidate is rejected", async () => {
    const good = await deliver();
    const lines = deliveryConsoleLines(await deliver({ unaccounted: ["svc-payments"] }));

    expect(lines.join("\n")).toContain("1 blocking finding; candidate not promoted.");
    expect(lines.join("\n")).toContain(
      `Last known good preserved: ${TARGET} (${good.verified?.verified_artifact_id}).`,
    );
    expect(lines.join("\n")).toContain(`Receipt: ${deliveryRootPath(repoRoot)}`);
  });
});

describe("containment", () => {
  it("refuses a target outside the repository before anything is staged", async () => {
    const outside = join(tmpdir(), "rvs-delivery-outside", "architecture.html");

    await expect(
      deliverVisualArtifact({
        repoRoot,
        artifact_type: "architecture_explorer",
        target_path: outside,
        html: "<!doctype html>",
        profile: PROFILE,
        spec: specFor(["svc-api"]),
        coverage: coverageFor(specFor(["svc-api"])),
        critical_paths: [],
        render_scale: 1,
        source_digest: "a".repeat(64),
        metadata: {
          producer: "delivery-test",
          fidelity_receipt_id: "fr_1",
          fidelity_receipt_digest: "b".repeat(64),
          source_snapshot_ids: [],
          upstream_artifact_ids: [],
        },
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/outside/i);

    expect(existsSync(outside)).toBe(false);
  });

  it("stages every candidate under the delivery root and nowhere else", async () => {
    const outcome = await deliver({ unaccounted: ["svc-payments"] });
    expect(outcome.result.candidate.source_path.startsWith(".rvs/cache/visual-delivery/runs/")).toBe(true);
    expect(outcome.receipt_path?.startsWith(".rvs/cache/visual-delivery/runs/")).toBe(true);
    expect(outcome.report_path.startsWith(".rvs/cache/visual-delivery/runs/")).toBe(true);
  });
});
