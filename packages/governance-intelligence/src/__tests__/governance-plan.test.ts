import { describe, expect, it } from "vitest";
import { buildGovernancePlan } from "../governance-plan.js";
import { buildGovernanceNarrative } from "../narrative.js";
import { architectureChangeSet, capabilityChangeSet, changeEntry, finding, portfolioChangeSet, report } from "./governance-fixtures.js";
import type { GovernanceSceneKind } from "../contracts.js";

const GENERATED_AT = "2026-07-10T00:00:00.000Z";

const CANONICAL_ORDER: GovernanceSceneKind[] = [
  "governance-hero",
  "snapshot-comparison",
  "change-summary",
  "architecture-change-map",
  "capability-regression",
  "product-change",
  "portfolio-change",
  "evidence-regression",
  "blast-radius",
  "policy-findings",
  "exceptions",
  "decision-required",
  "governance-validation",
];

function plan(overrides: Parameters<typeof report>[0] = {}) {
  const r = report(overrides);
  const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
  return buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
}

describe("buildGovernancePlan: canonical scene order", () => {
  it("always emits governance-hero, snapshot-comparison, and change-summary, in canonical order", () => {
    const p = plan();
    const kinds = p.scenes.map((scene) => scene.kind);
    expect(kinds).toEqual(["governance-hero", "snapshot-comparison", "change-summary"]);
  });

  it("sorts every present scene by the canonical GovernanceSceneKind order, then scene_id", () => {
    const p = plan({
      architecture_changes: architectureChangeSet([changeEntry({ type: "removed" })]),
      capability_changes: capabilityChangeSet([changeEntry({ type: "reclassified" })]),
      portfolio_changes: portfolioChangeSet([changeEntry({ type: "added" })]),
      findings: [finding({ result: "fail", severity: "blocking", excepted: false, human_review_required: true })],
    });
    const kinds = p.scenes.map((scene) => scene.kind);
    const ranks = kinds.map((kind) => CANONICAL_ORDER.indexOf(kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(kinds).toContain("architecture-change-map");
    expect(kinds).toContain("capability-regression");
    expect(kinds).toContain("portfolio-change");
    expect(kinds).toContain("policy-findings");
    expect(kinds).toContain("decision-required");
  });
});

describe("buildGovernancePlan: evidence-gated absence", () => {
  it("omits portfolio-change when report.portfolio_changes is undefined", () => {
    const p = plan();
    expect(p.scenes.some((scene) => scene.kind === "portfolio-change")).toBe(false);
  });

  it("omits exceptions when no finding is excepted", () => {
    const p = plan({ findings: [finding({ result: "pass", excepted: false })] });
    expect(p.scenes.some((scene) => scene.kind === "exceptions")).toBe(false);
  });

  it("includes exceptions when a finding is excepted", () => {
    const p = plan({ findings: [finding({ result: "excepted", excepted: true })] });
    expect(p.scenes.some((scene) => scene.kind === "exceptions")).toBe(true);
  });

  it("omits decision-required when no finding requires human review", () => {
    const p = plan({ findings: [finding({ result: "pass", human_review_required: false })] });
    expect(p.scenes.some((scene) => scene.kind === "decision-required")).toBe(false);
  });

  it("includes decision-required when a non-excepted finding requires human review", () => {
    const p = plan({ findings: [finding({ result: "fail", severity: "review_required", human_review_required: true, excepted: false })] });
    expect(p.scenes.some((scene) => scene.kind === "decision-required")).toBe(true);
  });

  it("omits architecture-change-map when there are no non-unchanged architecture changes", () => {
    const p = plan({ architecture_changes: architectureChangeSet([changeEntry({ type: "unchanged" })]) });
    expect(p.scenes.some((scene) => scene.kind === "architecture-change-map")).toBe(false);
  });
});

describe("buildGovernancePlan: determinism", () => {
  it("produces byte-identical output for the same report/narrative/generatedAt", () => {
    const r = report({ architecture_changes: architectureChangeSet([changeEntry({ type: "modified" })]) });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const first = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    const second = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("derives id via buildPlanId(report.id)", () => {
    const r = report({ id: "governance:report:foo:bar" });
    const narrative = buildGovernanceNarrative({ report: r, generatedAt: GENERATED_AT });
    const p = buildGovernancePlan({ report: r, narrative, generatedAt: GENERATED_AT });
    expect(p.id).toBe("governance:plan:governance-report-foo-bar");
  });
});
