import { describe, expect, it } from "vitest";
import { normalizeEnvironmentLabel, normalizeLabel, summarizeDynamicExpression } from "../label.js";

describe("normalizeLabel", () => {
  it("converts kebab-case to title case", () => {
    const label = normalizeLabel("review-and-approval");
    expect(label.displayLabel).toBe("Review and Approval");
    expect(label.sourceLabel).toBe("review-and-approval");
  });

  it("converts snake_case and strips a workflow file extension", () => {
    const label = normalizeLabel("rotate_credentials.yml");
    expect(label.displayLabel).toBe("Rotate Credentials");
  });

  it("splits camelCase", () => {
    const label = normalizeLabel("queryPdtManager");
    expect(label.displayLabel).toBe("Query Pdt Manager");
  });

  it("strips a leading path down to the final segment", () => {
    const label = normalizeLabel(".github/workflows/nightly-diagnostics.yml");
    expect(label.displayLabel).toBe("Nightly Diagnostics");
  });

  it("preserves short all-caps acronyms", () => {
    const label = normalizeLabel("IAM-role-sync");
    expect(label.displayLabel).toBe("IAM Role Sync");
  });

  it("keeps small connector words lowercase except at the start", () => {
    const label = normalizeLabel("query-and-pdt-management");
    expect(label.displayLabel).toBe("Query and Pdt Management");
  });

  it("truncates the short label to a bounded length", () => {
    const label = normalizeLabel("a-very-long-descriptive-workflow-family-name-indeed");
    expect(label.shortLabel.length).toBeLessThanOrEqual(28);
  });

  it("is a pure function of its input", () => {
    expect(normalizeLabel("onboarding-flow")).toEqual(normalizeLabel("onboarding-flow"));
  });
});

describe("summarizeDynamicExpression", () => {
  it("keeps the raw expression as sourceLabel and produces a human summary", () => {
    const label = summarizeDynamicExpression("${{ matrix.environment }}");
    expect(label.sourceLabel).toBe("${{ matrix.environment }}");
    expect(label.displayLabel).toContain("Dynamic value");
    expect(label.shortLabel).toBe("Dynamic value");
  });
});

describe("normalizeEnvironmentLabel", () => {
  it("reorders a trailing deployment-tier keyword to the front", () => {
    const label = normalizeEnvironmentLabel("admin-prod");
    expect(label.displayLabel).toBe("Production Admin");
    expect(label.basis).toBe("environment-heuristic");
  });

  it("reorders a leading deployment-tier keyword", () => {
    const label = normalizeEnvironmentLabel("staging-console");
    expect(label.displayLabel).toBe("Staging Console");
    expect(label.basis).toBe("environment-heuristic");
  });

  it("returns the bare tier label when there is no other segment", () => {
    const label = normalizeEnvironmentLabel("production");
    expect(label.displayLabel).toBe("Production");
  });

  it("falls back to plain normalizeLabel when no tier keyword is present", () => {
    const label = normalizeEnvironmentLabel("query-service");
    expect(label.displayLabel).toBe("Query Service");
    expect(label.basis).toBeUndefined();
  });
});
