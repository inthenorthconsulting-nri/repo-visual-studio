import { describe, expect, it } from "vitest";
import {
  buildRepairReceipt,
  buildVerificationReport,
  receiptConsoleSummary,
  receiptMarkdown,
} from "../receipts.js";
import { REPAIRS_BY_CODE, reachableVisualRepairs, repairsFor } from "../repairs.js";
import { buildReceiptId } from "../ids.js";
import { requireProfile, profileIdentity } from "../validation-profile.js";
import {
  INFRASTRUCTURE_REPAIR_ACTIONS,
  VISUAL_DELIVERY_SCHEMA_VERSION,
  VISUAL_REPAIR_ACTIONS,
  type VerifiedVisualArtifact,
  type VisualDeliveryCandidate,
  type VisualDeliveryFinding,
  type VisualVerificationResult,
} from "../contracts.js";

// The repair receipt.
//
// A rejected candidate is a measurement with a result, and the result is meant
// to be read. So the assertions here are mostly about what a receipt is not:
// not a stack trace, not a list of code changes to make, not a document whose
// content depends on the order findings happened to arrive in, and never a
// claim that something was repaired.

const PROFILE = requireProfile("visual-standard-v1");

const CANDIDATE: VisualDeliveryCandidate = {
  candidate_id: "vdc_0000000000000000000000",
  schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
  artifact_type: "architecture_explorer",
  source_path: ".rvs/cache/visual-delivery/runs/run-000007/architecture.html",
  target_path: "artifacts/visuals/architecture.html",
  visual_spec_id: "vspec_abc",
  source_digest: "a".repeat(64),
  artifact_digest: "b".repeat(64),
  validation_profile: PROFILE.id,
  created_at: "2026-01-01T00:00:00.000Z",
  generation: 7,
  run_id: "run-000007",
  metadata: {
    producer: "rvs graph open",
    fidelity_receipt_id: "fr_1",
    fidelity_receipt_digest: "d".repeat(64),
    source_snapshot_ids: ["snap-1"],
    upstream_artifact_ids: ["art-1"],
  },
};

function finding(over: Partial<VisualDeliveryFinding>): VisualDeliveryFinding {
  return {
    finding_id: "vdf_0",
    code: "rendered:contrast",
    severity: "blocking",
    validator: "@rvs/validator:validateHtmlFile",
    family: "contrast",
    subject_id: "architecture-explorer@dark",
    subject_type: "scene",
    message: "Text sits at 3.1:1 against its ground.",
    evidence_refs: [],
    supported_repairs: ["fix-contrast"],
    ...over,
  };
}

const FINDINGS: VisualDeliveryFinding[] = [
  finding({ finding_id: "f1", code: "rendered:contrast", family: "contrast", severity: "blocking" }),
  finding({
    finding_id: "f2",
    code: "VISUAL_COVERAGE_ENTITY_UNACCOUNTED",
    family: "reference",
    severity: "blocking",
    subject_id: "svc-payments",
    subject_type: "entity",
    validator: "@rvs/visual-composition:validateEntityCoverage",
    message: "Entity is neither drawn, collapsed, split nor named as hidden.",
    supported_repairs: ["restore-anchor", "resolve-reference"],
    evidence_refs: ["src/payments/index.ts#L1"],
  }),
  finding({
    finding_id: "f3",
    code: "rendered:min-font-size",
    family: "typography",
    severity: "warning",
    subject_id: "architecture-explorer@light",
    measured_value: "9px",
    required_value: "14px",
    supported_repairs: ["increase-font-size", "reduce-detail"],
  }),
];

function resultWith(findings: VisualDeliveryFinding[], status: VisualVerificationResult["status"] = "failed"): VisualVerificationResult {
  const blocking = findings.filter((f) => f.severity === "blocking").length;
  return {
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    status,
    candidate: CANDIDATE,
    profile: profileIdentity(PROFILE),
    verification_digest: "c".repeat(64),
    findings,
    validator_summary: {
      families: [],
      checks_run: 47,
      findings_blocking: blocking,
      findings_warning: findings.length - blocking,
    },
    ...(status === "incomplete" ? { incomplete_reason: "Browser verification is unavailable: no executable." } : {}),
  };
}

const LAST_KNOWN_GOOD: VerifiedVisualArtifact = {
  verified_artifact_id: "vva_previous",
  schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
  artifact_digest: "e".repeat(64),
  visual_spec_id: "vspec_abc",
  source_digest: "a".repeat(64),
  verification_digest: "f".repeat(64),
  verified_at: "2025-12-31T00:00:00.000Z",
  candidate_id: "vdc_previous",
  generation: 6,
  target_path: "artifacts/visuals/architecture.html",
  artifact_type: "architecture_explorer",
  profile_id: PROFILE.id,
  profile_version: PROFILE.version,
  validator_summary: { families: [], checks_run: 47, findings_blocking: 0, findings_warning: 0 },
};

function receiptFor(findings: VisualDeliveryFinding[]) {
  return buildRepairReceipt({
    repoRoot: "/repo",
    result: resultWith(findings),
    candidate: CANDIDATE,
    target_preserved: true,
    target_digest: LAST_KNOWN_GOOD.artifact_digest,
    last_known_good: LAST_KNOWN_GOOD,
  });
}

describe("the repair receipt", () => {
  it("names the candidate, what is still at the target, and what was preserved", () => {
    const receipt = receiptFor(FINDINGS);
    expect(receipt).toMatchObject({
      candidate_id: CANDIDATE.candidate_id,
      verification_status: "failed",
      target_preserved: true,
      last_known_good_id: "vva_previous",
      candidate_digest: CANDIDATE.artifact_digest,
      target_digest: LAST_KNOWN_GOOD.artifact_digest,
      candidate_path: CANDIDATE.source_path,
      profile_id: PROFILE.id,
    });
  });

  it("traces the candidate back to what produced it, by reference rather than by copy", () => {
    const receipt = receiptFor(FINDINGS);
    expect(receipt.generation_metadata).toMatchObject({
      producer: "rvs graph open",
      fidelity_receipt_id: "fr_1",
      source_snapshot_ids: ["snap-1"],
      generation: 7,
      run_id: "run-000007",
    });
    // Referenced, not embedded: no upstream artifact is copied into a receipt.
    expect(JSON.stringify(receipt)).not.toContain("<!doctype");
  });

  it("reports findings in the one deterministic order, whatever order they arrived in", () => {
    const expected = receiptFor(FINDINGS);
    const permutations = [
      [2, 1, 0],
      [1, 0, 2],
      [0, 2, 1],
      [2, 0, 1],
      [1, 2, 0],
    ];
    for (const order of permutations) {
      const shuffled = receiptFor(order.map((index) => FINDINGS[index]));
      expect(shuffled.findings.map((f) => f.finding_id)).toEqual(expected.findings.map((f) => f.finding_id));
      expect(shuffled.receipt_id).toBe(expected.receipt_id);
      expect(receiptMarkdown(shuffled)).toBe(receiptMarkdown(expected));
    }
  });

  it("is identified by the candidate it rejected and the findings it rejected it for", () => {
    const receipt = receiptFor(FINDINGS);
    expect(receipt.receipt_id).toBe(buildReceiptId(CANDIDATE.candidate_id, ["f1", "f2", "f3"]));
    expect(receipt.receipt_id).toMatch(/^vrr_[0-9a-f]{24}$/);
  });

  it("reuses the validators' own finding codes rather than minting a parallel vocabulary", () => {
    for (const raised of receiptFor(FINDINGS).findings) {
      expect(FINDINGS.map((f) => f.code)).toContain(raised.code);
      expect(raised.validator).toMatch(/^@rvs\//);
    }
  });

  it("carries the measured and required values the validator reported, and invents neither", () => {
    const receipt = receiptFor(FINDINGS);
    const typography = receipt.findings.find((f) => f.code === "rendered:min-font-size");
    expect(typography).toMatchObject({ measured_value: "9px", required_value: "14px" });
    const contrast = receipt.findings.find((f) => f.code === "rendered:contrast");
    expect(contrast?.measured_value).toBeUndefined();
  });

  it("says nothing was repaired", () => {
    const markdown = receiptMarkdown(receiptFor(FINDINGS));
    expect(markdown).toContain("Nothing in this receipt has been applied");
    expect(markdown).not.toMatch(/\bfixed\b/i);
  });
});

describe("the console summary", () => {
  it("gives the count, the worst findings and the fate of the target, and not the JSON", () => {
    const lines = receiptConsoleSummary(receiptFor(FINDINGS));
    expect(lines[0]).toBe("Candidate rejected — 2 blocking findings under visual-standard-v1.");
    expect(lines.join("\n")).toContain("rendered:contrast");
    expect(lines.join("\n")).toContain("Repairs that could satisfy it: fix-contrast.");
    expect(lines.join("\n")).not.toContain("{");
  });

  it("lists only the worst few, and says how many it did not list", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      finding({ finding_id: `f${index}`, subject_id: `scene-${index}` }),
    );
    const lines = receiptConsoleSummary(receiptFor(many), 3);
    expect(lines[0]).toContain("9 blocking findings");
    expect(lines.at(-1)).toBe("    … and 6 more in the receipt.");
  });

  it("calls an unmeasured candidate incomplete rather than rejected", () => {
    const receipt = buildRepairReceipt({
      repoRoot: "/repo",
      result: resultWith([finding({ finding_id: "f1", code: "VISUAL_VERIFICATION_BROWSER_UNAVAILABLE", family: "layout", subject_type: "runtime", supported_repairs: ["install-browser-runtime"] })], "incomplete"),
      candidate: CANDIDATE,
      target_preserved: true,
      target_digest: LAST_KNOWN_GOOD.artifact_digest,
      last_known_good: LAST_KNOWN_GOOD,
    });

    expect(receiptConsoleSummary(receipt)[0]).toContain("Verification incomplete");
    expect(receiptMarkdown(receipt)).toContain("# Verification incomplete");
    expect(receiptMarkdown(receipt)).toContain("install-browser-runtime");
  });

  it("uses no word that claims an organisational decision", () => {
    const text = [...receiptConsoleSummary(receiptFor(FINDINGS)), receiptMarkdown(receiptFor(FINDINGS))].join("\n");
    for (const forbidden of ["approved", "certified", "safe architecture", "merge-ready", "production ready", "sign-off"]) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

describe("the markdown receipt", () => {
  const markdown = receiptMarkdown(receiptFor(FINDINGS));

  it("separates what blocks from what does not", () => {
    expect(markdown).toContain("## Blocking");
    expect(markdown).toContain("## Warnings");
  });

  it("states what is at the target and that it was untouched", () => {
    expect(markdown).toContain("byte-for-byte what it was");
    expect(markdown).toContain("vva_previous");
  });

  it("keeps the evidence references upstream recorded", () => {
    expect(markdown).toContain("src/payments/index.ts#L1");
  });

  it("says plainly when nothing has ever been verified at the target", () => {
    const first = buildRepairReceipt({
      repoRoot: "/repo",
      result: resultWith(FINDINGS),
      candidate: CANDIDATE,
      target_preserved: true,
      target_digest: null,
      last_known_good: null,
    });
    expect(receiptMarkdown(first)).toContain("none has ever been verified at this target");
    expect(receiptMarkdown(first)).toContain("_no artifact at the target_");
  });
});

describe("the verification report", () => {
  it("records what was run, what it concluded, and what happened to the target", () => {
    const report = buildVerificationReport({
      result: resultWith(FINDINGS),
      generated_at: "2026-01-01T00:00:00.000Z",
      target_path: CANDIDATE.target_path,
      digest_before: LAST_KNOWN_GOOD.artifact_digest,
      digest_after: LAST_KNOWN_GOOD.artifact_digest,
      promotion_status: "not_promoted",
      promotion_reason: "Verification status is \"failed\".",
      last_known_good: LAST_KNOWN_GOOD,
    });

    expect(report).toMatchObject({
      status: "failed",
      verification_digest: "c".repeat(64),
      promotion_status: "not_promoted",
      target: {
        path: CANDIDATE.target_path,
        digest_before: LAST_KNOWN_GOOD.artifact_digest,
        digest_after: LAST_KNOWN_GOOD.artifact_digest,
      },
    });
    expect(report.candidate.candidate_id).toBe(CANDIDATE.candidate_id);
    expect(report.profile.id).toBe(PROFILE.id);
    expect(report.last_known_good?.verified_artifact_id).toBe("vva_previous");
    expect(report.findings.map((f) => f.finding_id)).toEqual(["f2", "f1", "f3"]);
  });

  it("says why a verification was incomplete, when it was", () => {
    const report = buildVerificationReport({
      result: resultWith([], "incomplete"),
      generated_at: "2026-01-01T00:00:00.000Z",
      target_path: CANDIDATE.target_path,
      digest_before: null,
      digest_after: null,
      promotion_status: "not_promoted",
      promotion_reason: "Verification is incomplete.",
      last_known_good: null,
    });
    expect(report.incomplete_reason).toContain("Browser verification is unavailable");
  });
});

describe("repair categories", () => {
  it("offers only the published categories, and never invents one", () => {
    const published = new Set<string>([...VISUAL_REPAIR_ACTIONS, ...INFRASTRUCTURE_REPAIR_ACTIONS]);
    for (const [code, actions] of Object.entries(REPAIRS_BY_CODE)) {
      for (const action of actions) expect(published.has(action), `${code} -> ${action}`).toBe(true);
    }
  });

  it("offers nothing at all for a code it has no category for", () => {
    expect(repairsFor("SOMETHING_NOBODY_PUBLISHED")).toEqual([]);
    // Deliberate, not an oversight: a non-deterministic tab order has no
    // category among the ten, and a wrong one would be worse than none.
    expect(repairsFor("VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC")).toEqual([]);
  });

  it("returns a fresh array, so a receipt cannot edit the table", () => {
    const actions = repairsFor("rendered:contrast");
    actions.push("reroute");
    expect(repairsFor("rendered:contrast")).toEqual(["fix-contrast"]);
  });

  it("keeps every one of the eleven visual categories reachable from some real code", () => {
    expect(reachableVisualRepairs()).toEqual([...VISUAL_REPAIR_ACTIONS].sort());
  });

  it("never re-maps a rendered color-only-state finding onto a category that would not restore the cue (Milestone 10 closure C2)", () => {
    expect(repairsFor("RENDERED_COLOR_ONLY_STATE")).toEqual(["add-non-color-state-cue"]);
    expect(repairsFor("RENDERED_COLOR_ONLY_STATE")).not.toContain("add-accessible-name");
    expect(repairsFor("RENDERED_COLOR_ONLY_STATE")).not.toContain("fix-contrast");
  });

  it("carries no mapping for a retired accessibility code no live caller can emit", () => {
    for (const code of [
      "VISUAL_A11Y_NAME_MISSING",
      "VISUAL_A11Y_COLOR_ONLY_STATE",
      "VISUAL_A11Y_FOCUS_NOT_VISIBLE",
      "VISUAL_A11Y_TAB_ORDER_NONDETERMINISTIC",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(REPAIRS_BY_CODE, code), code).toBe(false);
    }
  });

  it("never offers a visual repair for an infrastructure failure", () => {
    for (const code of ["VISUAL_VERIFICATION_BROWSER_UNAVAILABLE", "VISUAL_VERIFICATION_TIMEOUT"]) {
      for (const action of repairsFor(code)) {
        expect((INFRASTRUCTURE_REPAIR_ACTIONS as readonly string[]).includes(action), `${code} -> ${action}`).toBe(true);
      }
    }
  });
});
