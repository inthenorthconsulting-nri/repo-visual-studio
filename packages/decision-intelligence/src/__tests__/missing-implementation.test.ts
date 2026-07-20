import { describe, expect, it } from "vitest";
import { detectMissingImplementation } from "../missing-implementation.js";
import { buildMissingImplementationFindingId } from "../ids.js";
import type { DecisionImplementationState, MissingImplementationStatus } from "../contracts.js";
import { decisionImplementationState, evidenceRef } from "./decision-fixtures.js";

const MAPPED_STATUSES: Array<[DecisionImplementationState["status"], MissingImplementationStatus]> = [
  ["not_started", "implementation_missing"],
  ["partial", "partial"],
  ["regressed", "conflicting"],
  ["unverifiable", "unverifiable"],
];

describe("detectMissingImplementation: status mapping for every named status", () => {
  for (const [inputStatus, expectedStatus] of MAPPED_STATUSES) {
    it(`${inputStatus} -> ${expectedStatus}`, () => {
      const state = decisionImplementationState({ decision_id: "decision:a", status: inputStatus });
      const findings = detectMissingImplementation([state]);
      expect(findings).toHaveLength(1);
      expect(findings[0].status).toBe(expectedStatus);
      expect(findings[0].decision_id).toBe("decision:a");
      expect(findings[0].id).toBe(buildMissingImplementationFindingId("decision:a"));
    });
  }
});

describe("detectMissingImplementation: statuses that never produce a finding", () => {
  for (const status of ["implemented", "superseded", "not_applicable"] as const) {
    it(`${status}: produces no finding`, () => {
      const state = decisionImplementationState({ decision_id: "decision:a", status });
      const findings = detectMissingImplementation([state]);
      expect(findings).toEqual([]);
    });
  }
});

describe("detectMissingImplementation: never auto-fails / never carries a blocking verdict itself", () => {
  it("a finding object exposes only id/decision_id/status/detail/evidence_refs -- no severity or blocking field", () => {
    const state = decisionImplementationState({ decision_id: "decision:a", status: "not_started" });
    const [finding] = detectMissingImplementation([state]);
    expect(Object.keys(finding).sort()).toEqual(["decision_id", "detail", "evidence_refs", "id", "status"]);
  });

  it("a mix of blocking-looking statuses (regressed, not_started) alongside clean ones produces findings only for the non-clean ones, with no aggregate pass/fail verdict returned", () => {
    const states = [
      decisionImplementationState({ decision_id: "decision:regressed", status: "regressed" }),
      decisionImplementationState({ decision_id: "decision:clean", status: "implemented" }),
      decisionImplementationState({ decision_id: "decision:missing", status: "not_started" }),
    ];
    const findings = detectMissingImplementation(states);
    expect(findings.map((f) => f.decision_id).sort()).toEqual(["decision:missing", "decision:regressed"]);
  });
});

describe("detectMissingImplementation: detail and evidence passthrough", () => {
  it("passes the state's detail and evidence_refs through unchanged", () => {
    const refs = [evidenceRef({ path: "docs/adr/0002.md" })];
    const state = decisionImplementationState({ decision_id: "decision:a", status: "partial", detail: "Partial rollout detail.", evidence_refs: refs });
    const [finding] = detectMissingImplementation([state]);
    expect(finding.detail).toBe("Partial rollout detail.");
    expect(finding.evidence_refs).toBe(refs);
  });
});

describe("detectMissingImplementation: sorting and multiple states", () => {
  it("sorts findings by id, not input order", () => {
    const states = [
      decisionImplementationState({ decision_id: "decision:zzz", status: "not_started" }),
      decisionImplementationState({ decision_id: "decision:aaa", status: "unverifiable" }),
    ];
    const findings = detectMissingImplementation(states);
    const ids = findings.map((f) => f.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("returns an empty array for an empty input", () => {
    expect(detectMissingImplementation([])).toEqual([]);
  });
});
