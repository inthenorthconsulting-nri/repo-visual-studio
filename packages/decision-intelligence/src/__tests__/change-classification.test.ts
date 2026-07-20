import { describe, expect, it } from "vitest";
import { classifyDecisionChange } from "../change-classification.js";
import type { ArchitectureDecision } from "../contracts.js";
import { architectureDecision } from "./decision-fixtures.js";

describe("classifyDecisionChange: change_type-driven classifications", () => {
  it("'unresolved' change_type always classifies as 'unresolved', regardless of source/target presence", () => {
    const decision = architectureDecision();
    expect(classifyDecisionChange("unresolved", decision, decision)).toBe("unresolved");
    expect(classifyDecisionChange("unresolved", undefined, undefined)).toBe("unresolved");
    expect(classifyDecisionChange("unresolved", decision, undefined)).toBe("unresolved");
  });

  it("'added' change_type always classifies as 'material'", () => {
    const decision = architectureDecision();
    expect(classifyDecisionChange("added", undefined, decision)).toBe("material");
  });

  it("'removed' change_type always classifies as 'material'", () => {
    const decision = architectureDecision();
    expect(classifyDecisionChange("removed", decision, undefined)).toBe("material");
  });

  it("'unchanged' change_type always classifies as 'editorial'", () => {
    const decision = architectureDecision();
    expect(classifyDecisionChange("unchanged", decision, decision)).toBe("editorial");
  });

  it("'modified' with a missing source or target defensively classifies as 'unresolved'", () => {
    const decision = architectureDecision();
    expect(classifyDecisionChange("modified", undefined, decision)).toBe("unresolved");
    expect(classifyDecisionChange("modified", decision, undefined)).toBe("unresolved");
    expect(classifyDecisionChange("modified", undefined, undefined)).toBe("unresolved");
  });
});

describe("classifyDecisionChange: 'modified' field-diff classification", () => {
  it("classifies as 'editorial' when no tracked field actually differs (e.g. only id differs, as in a rename)", () => {
    const source = architectureDecision({ id: "decision:from" });
    const target = { ...source, id: "decision:to" } as ArchitectureDecision;
    expect(classifyDecisionChange("modified", source, target)).toBe("editorial");
  });

  for (const field of ["decision_status", "implementation_status", "scope", "supersedes", "superseded_by"] as const) {
    it(`classifies as 'material' when only "${field}" changes`, () => {
      const source = architectureDecision();
      const newValue = field === "decision_status" ? "rejected" : field === "implementation_status" ? "regressed" : field === "scope" ? "portfolio" : ["decision:other"];
      const target = { ...source, [field]: newValue } as ArchitectureDecision;
      expect(classifyDecisionChange("modified", source, target)).toBe("material");
    });
  }

  it("classifies as 'governance_relevant' when only governance_status changes", () => {
    const source = architectureDecision({ governance_status: "aligned" });
    const target = { ...source, governance_status: "review_required" } as ArchitectureDecision;
    expect(classifyDecisionChange("modified", source, target)).toBe("governance_relevant");
  });

  it("'material' takes priority over 'governance_relevant' when both a material field and governance_status change together", () => {
    const source = architectureDecision({ decision_status: "accepted", governance_status: "aligned" });
    const target = { ...source, decision_status: "rejected", governance_status: "conflicting" } as ArchitectureDecision;
    expect(classifyDecisionChange("modified", source, target)).toBe("material");
  });

  it("'governance_relevant' takes priority over 'metadata' when both governance_status and a metadata field change together", () => {
    const source = architectureDecision({ governance_status: "aligned", authors: ["Alice"] });
    const target = { ...source, governance_status: "conflicting", authors: ["Bob"] } as ArchitectureDecision;
    expect(classifyDecisionChange("modified", source, target)).toBe("governance_relevant");
  });

  for (const [field, newValue] of [
    ["authors", ["Bob"]],
    ["date", "2026-02-02"],
    ["evidence_refs", [{ path: "docs/other.md", source_artifact: "decision" }]],
  ] as const) {
    it(`classifies as 'metadata' when only "${field}" changes`, () => {
      const source = architectureDecision();
      const target = { ...source, [field]: newValue } as ArchitectureDecision;
      expect(classifyDecisionChange("modified", source, target)).toBe("metadata");
    });
  }

  it("'metadata' takes priority over 'editorial' when both a metadata field and a wording-only field change together", () => {
    const source = architectureDecision({ authors: ["Alice"], title: "Original title" });
    const target = { ...source, authors: ["Bob"], title: "Rewritten title" } as ArchitectureDecision;
    expect(classifyDecisionChange("modified", source, target)).toBe("metadata");
  });

  for (const field of ["title", "context", "decision_text"] as const) {
    it(`classifies as 'editorial' when only "${field}" (wording) changes`, () => {
      const source = architectureDecision({ [field]: "Original wording" } as Partial<ArchitectureDecision>);
      const target = { ...source, [field]: "Reworded, but same meaning" } as ArchitectureDecision;
      expect(classifyDecisionChange("modified", source, target)).toBe("editorial");
    });
  }
});

describe("classifyDecisionChange: a wording-only edit with unchanged normalized semantics is never 'material'", () => {
  it("a title rewording never classifies as 'material', even when the rewording is substantial", () => {
    const source = architectureDecision({ title: "Use PostgreSQL for the primary datastore" });
    const target = { ...source, title: "We will use PostgreSQL as our primary datastore going forward" } as ArchitectureDecision;
    const result = classifyDecisionChange("modified", source, target);
    expect(result).not.toBe("material");
    expect(result).toBe("editorial");
  });

  it("a context/decision_text rewording never classifies as 'material'", () => {
    const source = architectureDecision({ context: "Original context.", decision_text: "Original decision text." });
    const target = { ...source, context: "Rewritten context, same meaning.", decision_text: "Rewritten decision text, same meaning." } as ArchitectureDecision;
    const result = classifyDecisionChange("modified", source, target);
    expect(result).not.toBe("material");
    expect(result).toBe("editorial");
  });

  it("combining all three wording-only fields at once still never classifies as 'material'", () => {
    const source = architectureDecision({ title: "T1", context: "C1", decision_text: "D1" });
    const target = { ...source, title: "T2", context: "C2", decision_text: "D2" } as ArchitectureDecision;
    const result = classifyDecisionChange("modified", source, target);
    expect(result).not.toBe("material");
  });
});
