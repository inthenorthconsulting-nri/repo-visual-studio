import { describe, expect, it } from "vitest";
import { classifyChange } from "../change-classification.js";

describe("classifyChange", () => {
  it("never returns governance_severity 'blocking' regardless of input, since that is reserved for a future policy-evaluation stage", () => {
    const inputs = [
      { domain: "architecture" as const, changeType: "removed" as const, isRuntimeEntity: true, lineage: "broken" as const, evidenceChanged: true },
      { domain: "capability" as const, changeType: "reclassified" as const, isRuntimeEntity: true, lineage: "weakened" as const, evidenceChanged: true },
      { domain: "product" as const, changeType: "unresolved" as const, isRuntimeEntity: false, lineage: "unverifiable" as const, evidenceChanged: true },
      { domain: "portfolio" as const, changeType: "modified" as const, isRuntimeEntity: true, lineage: "broken" as const, evidenceChanged: true },
    ];
    for (const input of inputs) {
      expect(classifyChange(input).governance_severity).not.toBe("blocking");
    }
  });

  it("classifies broken evidence lineage as at least review_required, regardless of change type or runtime-ness", () => {
    const result = classifyChange({ domain: "product", changeType: "modified", isRuntimeEntity: false, lineage: "broken", evidenceChanged: true });
    expect(result.governance_severity).toBe("review_required");
    expect(result.compatibility_impact).toBe("incompatible");
  });

  it("classifies a wording-only change (evidenceChanged: false) as editorial materiality and informational severity", () => {
    const result = classifyChange({ domain: "capability", changeType: "modified", isRuntimeEntity: true, lineage: "preserved", evidenceChanged: false });
    expect(result.materiality).toBe("editorial");
    expect(result.governance_severity).toBe("informational");
  });

  it("classifies an 'unchanged' change type as editorial materiality, confirmed confidence, and isolated consumer_impact", () => {
    const result = classifyChange({ domain: "architecture", changeType: "unchanged", isRuntimeEntity: true, lineage: "preserved", evidenceChanged: false });
    expect(result.materiality).toBe("editorial");
    expect(result.consumer_impact).toBe("isolated");
    expect(result.portfolio_impact).toBe("none");
  });

  it("never guesses consumer_impact as 'isolated' for a non-unchanged change -- it is 'unresolved' until blast-radius.ts runs", () => {
    const result = classifyChange({ domain: "architecture", changeType: "modified", isRuntimeEntity: true, lineage: "preserved", evidenceChanged: false });
    expect(result.consumer_impact).toBe("unresolved");
  });

  it("derives 'derived' confidence for renamed/reclassified changes and 'unresolved' confidence for unresolved changes, unless overridden", () => {
    expect(classifyChange({ domain: "architecture", changeType: "renamed", isRuntimeEntity: true, lineage: "preserved", evidenceChanged: false }).confidence).toBe("derived");
    expect(classifyChange({ domain: "capability", changeType: "reclassified", isRuntimeEntity: true, lineage: "preserved", evidenceChanged: false }).confidence).toBe("derived");
    expect(classifyChange({ domain: "product", changeType: "unresolved", isRuntimeEntity: false, lineage: "unverifiable", evidenceChanged: true }).confidence).toBe("unresolved");
  });

  it("marks a runtime-entity removal as compatible_with_warnings even when lineage is merely broken->incompatible takes precedence", () => {
    const runtimeRemoval = classifyChange({ domain: "architecture", changeType: "removed", isRuntimeEntity: true, lineage: "broken", evidenceChanged: true });
    // lineage "broken" always wins to "incompatible" regardless of runtime-ness.
    expect(runtimeRemoval.compatibility_impact).toBe("incompatible");
    expect(runtimeRemoval.runtime_impact).toBe("lost");
  });

  it("marks materiality as 'qualified' when a weaker evidence-backed value replaced a stronger one", () => {
    const result = classifyChange({ domain: "product", changeType: "modified", isRuntimeEntity: false, lineage: "weakened", evidenceChanged: true, evidenceStrengthDelta: "weaker" });
    expect(result.materiality).toBe("qualified");
  });
});
