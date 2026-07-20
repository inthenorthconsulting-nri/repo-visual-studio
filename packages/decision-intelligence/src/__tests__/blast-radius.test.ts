import { describe, expect, it } from "vitest";
import { assessDecisionBlastRadius, type BlastRadiusInputs } from "../blast-radius.js";
import { buildBlastRadiusAssessmentId } from "../ids.js";
import { architectureDecision, decisionDependency, decisionLink, decisionSource, decisionSourceIssue } from "./decision-fixtures.js";

function baseInputs(overrides: Partial<BlastRadiusInputs> = {}): BlastRadiusInputs {
  return {
    decisions: [],
    links: [],
    dependencies: [],
    sourceIssues: [],
    linksAvailable: true,
    dependenciesAvailable: true,
    ...overrides,
  };
}

describe("assessDecisionBlastRadius: structural-availability gate is checked BEFORE any neighbor lookup", () => {
  it("returns 'unresolved' when neither links nor dependency resolution ran, even when matching neighbor data exists in the raw inputs", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const link = decisionLink({ decision_id: decision.id, target_domain: "portfolio", resolution: "resolved" });
    const dependency = decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:test-2" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [link], dependencies: [dependency], linksAvailable: false, dependenciesAvailable: false }));
    expect(assessment.level).toBe("unresolved");
    expect(assessment.affected_entity_ids).toEqual([]);
    expect(assessment.evidence_refs).toEqual([]);
  });

  it("does NOT gate to 'unresolved' when only linksAvailable is true (partial availability is sufficient to proceed)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], linksAvailable: true, dependenciesAvailable: false }));
    expect(assessment.level).not.toBe("unresolved");
  });

  it("does NOT gate to 'unresolved' when only dependenciesAvailable is true (partial availability is sufficient to proceed)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], linksAvailable: false, dependenciesAvailable: true }));
    expect(assessment.level).not.toBe("unresolved");
  });
});

describe("assessDecisionBlastRadius: unparseable-document gate", () => {
  it("returns 'unresolved' with the decision's own evidence_refs when its document is unparseable, even though resolution ran and neighbor data exists", () => {
    const decision = architectureDecision({ id: "decision:test-1", source: decisionSource({ repo_relative_path: "docs/adr/d1.md" }) });
    const link = decisionLink({ decision_id: decision.id, target_domain: "portfolio", resolution: "resolved" });
    const sourceIssues = [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/d1.md"] })];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [link], sourceIssues }));
    expect(assessment.level).toBe("unresolved");
    expect(assessment.evidence_refs).toEqual(decision.evidence_refs);
    expect(assessment.affected_entity_ids).toEqual([]);
  });

  it("distinguishes the two 'unresolved' causes by evidence_refs: structural gate yields [], document-unparseable gate yields the decision's evidence_refs", () => {
    const structurallyGated = architectureDecision({ id: "decision:a" });
    const [structural] = assessDecisionBlastRadius(baseInputs({ decisions: [structurallyGated], linksAvailable: false, dependenciesAvailable: false }));
    expect(structural.evidence_refs).toEqual([]);

    const documentGated = architectureDecision({ id: "decision:b", source: decisionSource({ repo_relative_path: "docs/adr/b.md" }) });
    const [document] = assessDecisionBlastRadius(baseInputs({ decisions: [documentGated], sourceIssues: [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/b.md"] })] }));
    expect(document.evidence_refs).toEqual(documentGated.evidence_refs);
    expect(document.evidence_refs.length).toBeGreaterThan(0);
  });
});

describe("assessDecisionBlastRadius: 'asked, zero neighbors' is 'isolated', never collapsed with 'unresolved'", () => {
  it("returns 'isolated' when resolution ran and the decision genuinely has zero resolved links and zero dependency edges", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision] }));
    expect(assessment.level).toBe("isolated");
    expect(assessment.affected_entity_ids).toEqual([]);
  });

  it("returns 'isolated' when links exist for the decision but none are resolved or partially_resolved", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = (["unresolved", "ambiguous", "incompatible"] as const).map((resolution) => decisionLink({ decision_id: decision.id, resolution, target_domain: "portfolio" }));
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links }));
    expect(assessment.level).toBe("isolated");
  });

  it("ignores links belonging to a different decision (decision-scoped lookup)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const otherDecisionLink = decisionLink({ decision_id: "decision:other", resolution: "resolved", target_domain: "portfolio" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [otherDecisionLink] }));
    expect(assessment.level).toBe("isolated");
  });
});

describe("assessDecisionBlastRadius: level derivation", () => {
  it("'portfolio_wide' when a resolved link targets the portfolio domain", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const link = decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "portfolio" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [link] }));
    expect(assessment.level).toBe("portfolio_wide");
  });

  it("'portfolio_wide' takes precedence over 'cross_layer' when portfolio is one of two+ touched domains", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "portfolio" }), decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture" })];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links }));
    expect(assessment.level).toBe("portfolio_wide");
  });

  it("'cross_layer' when resolved links touch 2+ non-portfolio domains", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture" }), decisionLink({ decision_id: decision.id, resolution: "partially_resolved", target_domain: "capability" })];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links }));
    expect(assessment.level).toBe("cross_layer");
  });

  it("'cross_component' when multiple distinct target_ids are resolved within a single domain", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = [
      decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "arch:component:a" }),
      decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "arch:component:b" }),
    ];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links }));
    expect(assessment.level).toBe("cross_component");
  });

  it("'cross_component' when a single dependency edge exists, even with zero links", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const dependency = decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:test-2" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], dependencies: [dependency] }));
    expect(assessment.level).toBe("cross_component");
  });

  it("'local' when exactly one resolved link with a single target_id in a single domain, and no dependencies", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const link = decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "arch:component:a" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [link] }));
    expect(assessment.level).toBe("local");
  });

  it("covers all six DecisionBlastRadiusLevel values by name across the suite: unresolved, isolated, local, cross_component, cross_layer, portfolio_wide", () => {
    const levels = new Set<string>();
    const decision = architectureDecision({ id: "decision:levels" });

    levels.add(assessDecisionBlastRadius(baseInputs({ decisions: [decision], linksAvailable: false, dependenciesAvailable: false }))[0].level);
    levels.add(assessDecisionBlastRadius(baseInputs({ decisions: [decision] }))[0].level);
    levels.add(assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "x" })] }))[0].level);
    levels.add(assessDecisionBlastRadius(baseInputs({ decisions: [decision], dependencies: [decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:other" })] }))[0].level);
    levels.add(
      assessDecisionBlastRadius(
        baseInputs({ decisions: [decision], links: [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture" }), decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "capability" })] }),
      )[0].level,
    );
    levels.add(assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "portfolio" })] }))[0].level);

    expect(levels).toEqual(new Set(["unresolved", "isolated", "local", "cross_component", "cross_layer", "portfolio_wide"]));
  });
});

describe("assessDecisionBlastRadius: affected_entity_ids and evidence_refs assembly", () => {
  it("dedupes and sorts affected_entity_ids across resolved link targets and dependency neighbors", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = [decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "decision:zeta" })];
    const dependencies = [decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:alpha" }), decisionDependency({ to_decision_id: decision.id, from_decision_id: "decision:zeta" })];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links, dependencies }));
    expect(assessment.affected_entity_ids).toEqual(["decision:alpha", "decision:zeta"]);
  });

  it("collects dependency neighbors from both from_decision_id and to_decision_id directions", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const dependencies = [decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:downstream" }), decisionDependency({ from_decision_id: "decision:upstream", to_decision_id: decision.id })];
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], dependencies }));
    expect(assessment.affected_entity_ids).toEqual(["decision:downstream", "decision:upstream"]);
  });

  it("combines resolved-link evidence_refs with the evidence_refs of dependencies touching the decision", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const link = decisionLink({ decision_id: decision.id, resolution: "resolved", target_domain: "architecture", target_id: "x", evidence_refs: [{ path: "docs/link.md", source_artifact: "decision" }] });
    const dependency = decisionDependency({ from_decision_id: decision.id, to_decision_id: "decision:other", evidence_refs: [{ path: "docs/dep.md", source_artifact: "decision" }] });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision], links: [link], dependencies: [dependency] }));
    expect(assessment.evidence_refs).toEqual([...link.evidence_refs, ...dependency.evidence_refs]);
  });
});

describe("assessDecisionBlastRadius: identity and ordering", () => {
  it("derives id via buildBlastRadiusAssessmentId(decision.id)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const [assessment] = assessDecisionBlastRadius(baseInputs({ decisions: [decision] }));
    expect(assessment.id).toBe(buildBlastRadiusAssessmentId(decision.id));
    expect(assessment.decision_id).toBe(decision.id);
  });

  it("sorts the returned assessments by id regardless of input decision order", () => {
    const a = architectureDecision({ id: "decision:aaa" });
    const b = architectureDecision({ id: "decision:bbb" });
    const c = architectureDecision({ id: "decision:ccc" });
    const assessments = assessDecisionBlastRadius(baseInputs({ decisions: [c, a, b] }));
    const ids = assessments.map((a2) => a2.id);
    const sorted = [...ids].sort((x, y) => x.localeCompare(y));
    expect(ids).toEqual(sorted);
  });
});
