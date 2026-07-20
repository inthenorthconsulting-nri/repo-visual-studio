import { describe, expect, it } from "vitest";
import { buildDecisionCoverage } from "../coverage.js";
import { buildCoverageMetricId } from "../ids.js";
import { decisionLink, evidenceRef } from "./decision-fixtures.js";

describe("buildDecisionCoverage: 'no way to even ask' is omitted, never reported as zero", () => {
  it("returns no metrics at all when every input is undefined", () => {
    const metrics = buildDecisionCoverage([], {}, []);
    expect(metrics).toEqual([]);
  });

  it("omits a dimension's metric entirely when its snapshot was never supplied", () => {
    const metrics = buildDecisionCoverage([], { architectureSnapshot: { id: "component:a" } }, []);
    expect(metrics.some((m) => m.dimension === "capabilities")).toBe(false);
    expect(metrics.some((m) => m.dimension === "products")).toBe(false);
    expect(metrics.some((m) => m.dimension === "portfolio_relationships")).toBe(false);
    expect(metrics.some((m) => m.dimension === "governance_exceptions")).toBe(false);
  });

  it("omits the governance_exceptions metric when governancePolicy is undefined", () => {
    const metrics = buildDecisionCoverage([], {}, []);
    expect(metrics.some((m) => m.dimension === "governance_exceptions")).toBe(false);
  });

  it("includes a metric with numerator 0 and denominator 0 when a snapshot IS supplied but contains no ids -- 'present but empty' is not the same as 'never supplied'", () => {
    const metrics = buildDecisionCoverage([], { architectureSnapshot: { note: "no ids here" } }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities");
    expect(metric).toBeDefined();
    expect(metric!.numerator).toBe(0);
    expect(metric!.denominator).toBe(0);
  });
});

describe("buildDecisionCoverage: numerator/denominator always emitted as a pair", () => {
  it("every returned metric has numeric numerator and denominator fields", () => {
    const metrics = buildDecisionCoverage(
      [],
      {
        architectureSnapshot: { id: "component:a" },
        capabilitySnapshot: { id: "cap:a" },
        productSnapshot: { id: "product:a" },
        portfolioSnapshot: { id: "portfolio:a" },
        governancePolicy: { exceptions: [{ policy_id: "p", rule_id: "r" }] },
      },
      [],
    );
    expect(metrics.length).toBe(5);
    for (const metric of metrics) {
      expect(typeof metric.numerator).toBe("number");
      expect(typeof metric.denominator).toBe("number");
    }
  });

  it("denominator counts every known entity id in the snapshot", () => {
    const snapshot = { components: [{ id: "component:a" }, { id: "component:b" }, { id: "component:c" }] };
    const metrics = buildDecisionCoverage([], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.denominator).toBe(3);
  });

  it("numerator counts resolved links whose target_id is a known entity id", () => {
    const snapshot = { components: [{ id: "component:a" }, { id: "component:b" }] };
    const link = decisionLink({ target_domain: "architecture", target_id: "component:a", resolution: "resolved" });
    const metrics = buildDecisionCoverage([link], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.numerator).toBe(1);
    expect(metric.denominator).toBe(2);
  });

  it("counts partially_resolved links toward the entity-dimension numerator", () => {
    const snapshot = { components: [{ id: "component:a" }] };
    const link = decisionLink({ target_domain: "architecture", target_id: "component:a", resolution: "partially_resolved" });
    const metrics = buildDecisionCoverage([link], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.numerator).toBe(1);
  });

  it("does not count unresolved, ambiguous, or incompatible links toward the numerator", () => {
    const snapshot = { components: [{ id: "component:a" }] };
    for (const resolution of ["unresolved", "ambiguous", "incompatible"] as const) {
      const link = decisionLink({ target_domain: "architecture", target_id: "component:a", resolution });
      const metrics = buildDecisionCoverage([link], { architectureSnapshot: snapshot }, []);
      const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
      expect(metric.numerator).toBe(0);
    }
  });

  it("does not count a resolved link whose target_id is not among the known entity ids", () => {
    const snapshot = { components: [{ id: "component:a" }] };
    const link = decisionLink({ target_domain: "architecture", target_id: "component:unknown", resolution: "resolved" });
    const metrics = buildDecisionCoverage([link], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.numerator).toBe(0);
  });

  it("does not count a resolved link targeting a different domain", () => {
    const snapshot = { components: [{ id: "component:a" }] };
    const link = decisionLink({ target_domain: "capability", target_id: "component:a", resolution: "resolved" });
    const metrics = buildDecisionCoverage([link], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.numerator).toBe(0);
  });

  it("counts a target id once even when multiple resolved links point at it", () => {
    const snapshot = { components: [{ id: "component:a" }] };
    const linkOne = decisionLink({ target_domain: "architecture", target_id: "component:a", resolution: "resolved" });
    const linkTwo = decisionLink({ target_domain: "architecture", target_id: "component:a", resolution: "resolved" });
    const metrics = buildDecisionCoverage([linkOne, linkTwo], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.numerator).toBe(1);
  });
});

describe("buildDecisionCoverage: governance_exceptions metric", () => {
  it("denominator is the count of extracted exceptions", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1" }, { policy_id: "p2", rule_id: "r2" }, "not-an-object"] };
    const metrics = buildDecisionCoverage([], { governancePolicy: policy }, []);
    const metric = metrics.find((m) => m.dimension === "governance_exceptions")!;
    expect(metric.denominator).toBe(2);
  });

  it("numerator counts only fully resolved excepts links targeting governance", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1" }] };
    const resolvedExcepts = decisionLink({ target_domain: "governance", link_type: "excepts", resolution: "resolved" });
    const metrics = buildDecisionCoverage([resolvedExcepts], { governancePolicy: policy }, []);
    const metric = metrics.find((m) => m.dimension === "governance_exceptions")!;
    expect(metric.numerator).toBe(1);
  });

  it("does NOT count a partially_resolved excepts link toward the governance numerator (stricter than entity dimensions)", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1" }] };
    const partial = decisionLink({ target_domain: "governance", link_type: "excepts", resolution: "partially_resolved" });
    const metrics = buildDecisionCoverage([partial], { governancePolicy: policy }, []);
    const metric = metrics.find((m) => m.dimension === "governance_exceptions")!;
    expect(metric.numerator).toBe(0);
  });

  it("does not count a resolved link with a link_type other than 'excepts'", () => {
    const policy = { exceptions: [{ policy_id: "p1", rule_id: "r1" }] };
    const link = decisionLink({ target_domain: "governance", link_type: "governs", resolution: "resolved" });
    const metrics = buildDecisionCoverage([link], { governancePolicy: policy }, []);
    const metric = metrics.find((m) => m.dimension === "governance_exceptions")!;
    expect(metric.numerator).toBe(0);
  });

  it("returns a governance_exceptions metric with numerator/denominator 0/0 when the policy has zero exceptions (present policy, no exceptions)", () => {
    const metrics = buildDecisionCoverage([], { governancePolicy: { exceptions: [] } }, []);
    const metric = metrics.find((m) => m.dimension === "governance_exceptions");
    expect(metric).toBeDefined();
    expect(metric!.numerator).toBe(0);
    expect(metric!.denominator).toBe(0);
  });
});

describe("buildDecisionCoverage: id derivation, evidence, and ordering", () => {
  it("derives metric id via buildCoverageMetricId(dimension)", () => {
    const metrics = buildDecisionCoverage([], { architectureSnapshot: { id: "component:a" } }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.id).toBe(buildCoverageMetricId("architecture_entities"));
  });

  it("passes the supplied evidence refs through verbatim on every metric", () => {
    const refs = [evidenceRef({ path: "docs/coverage.md" })];
    const metrics = buildDecisionCoverage(
      [],
      { architectureSnapshot: { id: "component:a" }, governancePolicy: { exceptions: [] } },
      refs,
    );
    for (const metric of metrics) {
      expect(metric.evidence_refs).toEqual(refs);
    }
  });

  it("returns metrics sorted by id (alphabetical by dimension)", () => {
    const metrics = buildDecisionCoverage(
      [],
      {
        portfolioSnapshot: { id: "portfolio:a" },
        architectureSnapshot: { id: "component:a" },
        governancePolicy: { exceptions: [] },
        productSnapshot: { id: "product:a" },
        capabilitySnapshot: { id: "cap:a" },
      },
      [],
    );
    expect(metrics.map((m) => m.dimension)).toEqual(["architecture_entities", "capabilities", "governance_exceptions", "portfolio_relationships", "products"]);
  });

  it("collects entity ids nested arbitrarily deep inside the upstream snapshot shape", () => {
    const snapshot = { domains: [{ id: "domain:x", components: [{ id: "component:nested-a" }, { id: "component:nested-b" }] }] };
    const metrics = buildDecisionCoverage([], { architectureSnapshot: snapshot }, []);
    const metric = metrics.find((m) => m.dimension === "architecture_entities")!;
    expect(metric.denominator).toBe(3);
  });

  it("is deterministic: identical input produces byte-identical output", () => {
    const inputs = {
      architectureSnapshot: { id: "component:a" },
      governancePolicy: { exceptions: [{ policy_id: "p", rule_id: "r" }] },
    };
    const links = [decisionLink({ target_domain: "architecture", target_id: "component:a", resolution: "resolved" })];
    const first = buildDecisionCoverage(links, inputs, []);
    const second = buildDecisionCoverage(links, inputs, []);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
