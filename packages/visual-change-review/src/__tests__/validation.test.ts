import { describe, expect, it } from "vitest";
import type { FidelityReceipt } from "@rvs/visual-intelligence";
import { CHANGE_REVIEW_SCHEMA_VERSION, type ChangeReviewModel, type ReviewChange } from "../contracts.js";
import { validateChangeReview } from "../validation.js";
import { buildChangeReviewArtifact } from "../artifact.js";
import { buildReviewAssembly } from "../source.js";
import { blockingFinding, causalChain, componentRemoved, everythingChanged } from "./fixtures.js";

// Every public validation code, reached by an input a caller can produce.
//
// The rule this file enforces is the one §30 states: no predeclared code. A
// code nobody can reach is a promise of a check that does not exist, and a
// reviewer who sees a clean run counts on every declared check having run.

const RECEIPT: FidelityReceipt = {
  id: "receipt:test",
  schema_version: 1,
  source_node_count: 4,
  rendered_node_count: 4,
  source_edge_count: 3,
  rendered_edge_count: 3,
  preserved_entity_ids: ["api", "billing"],
  collapsed_groups: [],
  hidden_entity_ids: [],
  preserved_paths: [],
  preserved_findings: [],
  preserved_decisions: [],
  preserved_unresolved_entities: [],
  truncation: { truncated: false, limits_hit: [] },
  split_views: [],
  reason_codes: [],
  source_digest: "0".repeat(64),
  rendered_digest: "0".repeat(64),
};

function change(over: Partial<ReviewChange> = {}): ReviewChange {
  return {
    id: "chg-1",
    change_type: "removed",
    entity_id: "billing",
    entity_type: "component",
    before_entity_id: "billing",
    summary: "Removed.",
    evidence_refs: [],
    capability_ids: [],
    product_ids: [],
    decision_ids: [],
    governance_finding_ids: [],
    impact_path_ids: [],
    blast_radius: "unresolved",
    resolution_status: "resolved",
    review_required: false,
    ...over,
  };
}

function model(over: Partial<ChangeReviewModel> = {}): ChangeReviewModel {
  return {
    id: "review:test",
    schema_version: CHANGE_REVIEW_SCHEMA_VERSION,
    from_snapshot_id: "snap-a",
    to_snapshot_id: "snap-b",
    compatibility: { status: "compatible", reasons: [] },
    before_entity_ids: ["api", "billing"],
    after_entity_ids: ["api"],
    changes: [change()],
    governance_findings: [],
    decision_impacts: [],
    confirmed_paths: [],
    unresolved_impacts: [],
    review_required_ids: [],
    visual_spec: undefined as never,
    fidelity_receipt: RECEIPT,
    generation_metadata: {
      schema_version: CHANGE_REVIEW_SCHEMA_VERSION,
      producer: "test",
      source_artifact_ids: [],
      input_digest: "d",
      unavailable_domains: [],
    },
    ...over,
  };
}

const codes = (input: Parameters<typeof validateChangeReview>[0]) =>
  validateChangeReview(input).map((f) => f.code);

const BASE = { before_ids: ["api", "billing"], after_ids: ["api"] };

describe("validation codes", () => {
  it("is quiet on a well-formed review", () => {
    expect(codes({ model: model(), ...BASE })).toEqual([]);
  });

  it("CHANGE_REVIEW_BASELINE_MISSING", () => {
    expect(codes({ model: model({ before_entity_ids: [] }), ...BASE })).toContain(
      "CHANGE_REVIEW_BASELINE_MISSING",
    );
  });

  it("CHANGE_REVIEW_TARGET_MISSING", () => {
    expect(codes({ model: model({ after_entity_ids: [] }), ...BASE })).toContain("CHANGE_REVIEW_TARGET_MISSING");
  });

  it("CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS", () => {
    const found = codes({
      model: model({ compatibility: { status: "incompatible", reasons: ["Different repositories."] } }),
      ...BASE,
    });
    expect(found).toContain("CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS");
  });

  it("CHANGE_REVIEW_DANGLING_CHANGE", () => {
    expect(codes({ model: model({ changes: [change({ entity_id: "ghost", before_entity_id: undefined })] }), ...BASE }))
      .toContain("CHANGE_REVIEW_DANGLING_CHANGE");
  });

  it("CHANGE_REVIEW_BEFORE_ENTITY_MISSING as an error when a declared counterpart is absent", () => {
    const found = validateChangeReview({
      model: model({ changes: [change({ entity_id: "api", before_entity_id: "ghost" })] }),
      ...BASE,
    });
    const entry = found.find((f) => f.code === "CHANGE_REVIEW_BEFORE_ENTITY_MISSING");
    expect(entry?.severity).toBe("error");
  });

  it("CHANGE_REVIEW_BEFORE_ENTITY_MISSING as a warning when the type implies a side the snapshot lacks", () => {
    const found = validateChangeReview({
      model: model({
        changes: [change({ change_type: "modified", entity_id: "shipping", before_entity_id: undefined, after_entity_id: undefined })],
      }),
      before_ids: ["api"],
      after_ids: ["api", "shipping"],
    });
    const entry = found.find((f) => f.code === "CHANGE_REVIEW_BEFORE_ENTITY_MISSING");
    expect(entry?.severity).toBe("warning");
  });

  it("CHANGE_REVIEW_AFTER_ENTITY_MISSING", () => {
    const found = validateChangeReview({
      model: model({ changes: [change({ entity_id: "api", after_entity_id: "ghost" })] }),
      ...BASE,
    });
    expect(found.find((f) => f.code === "CHANGE_REVIEW_AFTER_ENTITY_MISSING")?.severity).toBe("error");
  });

  it("CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE from a change carrying an unknown type", () => {
    expect(
      codes({ model: model({ changes: [change({ change_type: "deprecated" as never })] }), ...BASE }),
    ).toContain("CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE");
  });

  it("CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE from an upstream type with no member here", () => {
    const found = validateChangeReview({
      model: model(),
      ...BASE,
      unsupported_change_types: [{ id: "gov-9", type: "vendored" }],
    });
    const entry = found.find((f) => f.code === "CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE");
    expect(entry?.severity).toBe("warning");
    expect(entry?.message).toContain("rather than mapped onto a neighbouring type");
  });

  it("CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING", () => {
    expect(
      codes({ model: model({ changes: [change({ governance_finding_ids: ["gf-absent"] })] }), ...BASE }),
    ).toContain("CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING");
  });

  it("CHANGE_REVIEW_DECISION_REFERENCE_MISSING", () => {
    expect(codes({ model: model({ changes: [change({ decision_ids: ["adr-absent"] })] }), ...BASE })).toContain(
      "CHANGE_REVIEW_DECISION_REFERENCE_MISSING",
    );
  });

  it("CHANGE_REVIEW_NONDETERMINISTIC_ORDER from a duplicate id", () => {
    expect(codes({ model: model(), ...BASE, duplicate_change_ids: ["chg-1"] })).toContain(
      "CHANGE_REVIEW_NONDETERMINISTIC_ORDER",
    );
  });

  it("CHANGE_REVIEW_NONDETERMINISTIC_ORDER from an unsorted list", () => {
    expect(codes({ model: model({ before_entity_ids: ["billing", "api"] }), ...BASE })).toContain(
      "CHANGE_REVIEW_NONDETERMINISTIC_ORDER",
    );
  });

  it("CHANGE_REVIEW_FIDELITY_LOSS", () => {
    const found = validateChangeReview({
      model: model({
        fidelity_receipt: { ...RECEIPT, rendered_node_count: 2, hidden_entity_ids: ["billing", "store"] },
      }),
      ...BASE,
    });
    const entry = found.find((f) => f.code === "CHANGE_REVIEW_FIDELITY_LOSS");
    expect(entry?.severity).toBe("info");
  });

  it("CHANGE_REVIEW_REAL_ANCHOR_LOST", () => {
    expect(codes({ model: model(), ...BASE, rendered_entity_ids: [] })).toContain(
      "CHANGE_REVIEW_REAL_ANCHOR_LOST",
    );
  });

  it("never fires the real-anchor code on a review that drew its changes", () => {
    expect(codes({ model: model(), ...BASE, rendered_entity_ids: ["billing"] })).toEqual([]);
  });

  it("repairs nothing it reports", () => {
    const subject = model({ changes: [change({ entity_id: "ghost", before_entity_id: undefined })] });
    const before = JSON.stringify(subject);
    validateChangeReview({ model: subject, ...BASE });
    expect(JSON.stringify(subject)).toBe(before);
  });

  it("returns findings in a stable order", () => {
    const input = {
      model: model({ before_entity_ids: [], after_entity_ids: [], changes: [change({ entity_id: "ghost" })] }),
      ...BASE,
    };
    const runs = Array.from({ length: 5 }, () => JSON.stringify(validateChangeReview(input)));
    expect(new Set(runs).size).toBe(1);
  });
});

describe("validation over real assemblies", () => {
  const built = (input: Parameters<typeof buildReviewAssembly>[0], detail: "faithful" | "balanced" | "simplified") =>
    buildChangeReviewArtifact({
      producer: "test",
      subject: "Test",
      assembly: buildReviewAssembly(input),
      audience: "engineering",
      detail_mode: detail,
    });

  it("finds nothing wrong with any of the ordinary fixtures", () => {
    for (const [name, fixture] of [
      ["component removed", componentRemoved()],
      ["governance blocking finding", blockingFinding()],
      ["multiple causally related changes", causalChain()],
    ] as const) {
      const errors = built(fixture, "faithful").findings.filter((f) => f.severity === "error");
      expect(errors.map((f) => f.code), `${name}`).toEqual([]);
    }
  });

  it("keeps a real changed entity on screen even when every entity changed and the budget is smallest", () => {
    const artifact = built(everythingChanged(), "simplified");
    expect(artifact.findings.map((f) => f.code)).not.toContain("CHANGE_REVIEW_REAL_ANCHOR_LOST");
  });
});
