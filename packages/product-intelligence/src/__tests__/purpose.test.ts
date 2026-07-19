import { describe, expect, it } from "vitest";
import { synthesizeProductPurpose } from "../purpose.js";
import { makeArchitectureFixture, makeCapability, makeCapabilityDomain, makeEmptyCapabilityModel, stmt } from "./fixtures.js";

describe("synthesizeProductPurpose", () => {
  it("uses arch.purpose.problemStatement as the base sentence when it has a value", () => {
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt("Teams lack a governed way to synchronize widgets"), targetUsers: [], scopeBoundaries: [] } });
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), arch, []);
    expect(result.value.startsWith("Teams lack a governed way to synchronize widgets")).toBe(true);
  });

  it("falls back to arch.identity.oneLineDescription when problemStatement has no value", () => {
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt(""), targetUsers: [], scopeBoundaries: [] } });
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), arch, []);
    expect(result.value.startsWith(arch.identity.oneLineDescription.value)).toBe(true);
  });

  it("appends a 'by providing <domains>' clause listing only domains with at least one capability, capped at 3", () => {
    const populated1 = makeCapabilityDomain({ sourceLabel: "Governance", capabilities: [makeCapability()] });
    const populated2 = makeCapabilityDomain({ sourceLabel: "Widget Operations", capabilities: [makeCapability()] });
    const empty = makeCapabilityDomain({ sourceLabel: "Empty Domain", capabilities: [] });
    const model = makeEmptyCapabilityModel({ domains: [populated1, populated2, empty] });

    const result = synthesizeProductPurpose(model, makeArchitectureFixture(), []);
    expect(result.value).toContain("by providing Governance and Widget Operations");
    expect(result.value).not.toContain("Empty Domain");
  });

  it("omits the 'by providing' clause entirely when no domain has any capabilities", () => {
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), makeArchitectureFixture(), []);
    expect(result.value).not.toContain("by providing");
  });

  it("appends a 'for <users>' clause joining primary users with commas and 'and', omitted when there are none", () => {
    const withUsers = synthesizeProductPurpose(makeEmptyCapabilityModel(), makeArchitectureFixture(), ["Compliance Officer", "Platform Operator"]);
    expect(withUsers.value).toContain("for Compliance Officer and Platform Operator");

    const withoutUsers = synthesizeProductPurpose(makeEmptyCapabilityModel(), makeArchitectureFixture(), []);
    expect(withoutUsers.value).not.toContain(" for ");
  });

  it("joins 3+ users with an Oxford comma before 'and'", () => {
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), makeArchitectureFixture(), ["Compliance Officer", "Platform Operator", "Auditor"]);
    expect(result.value).toContain("for Compliance Officer, Platform Operator, and Auditor");
  });

  it("truncates the sentence to at most 40 words", () => {
    const longProblem = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt(longProblem), targetUsers: [], scopeBoundaries: [] } });
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), arch, []);
    expect(result.wordCount).toBeLessThanOrEqual(40);
  });

  it("reports withinBudget=true when the resulting word count is between 20 and 40 words", () => {
    const domains = Array.from({ length: 3 }, (_, i) => makeCapabilityDomain({ sourceLabel: `Domain Name Number ${i}`, capabilities: [makeCapability()] }));
    const model = makeEmptyCapabilityModel({ domains });
    const arch = makeArchitectureFixture({
      purpose: { problemStatement: stmt("Teams lack a governed and auditable way to operate widgets across many different environments reliably"), targetUsers: [], scopeBoundaries: [] },
    });
    const result = synthesizeProductPurpose(model, arch, ["Compliance Officer", "Platform Operator"]);
    expect(result.wordCount).toBeGreaterThanOrEqual(20);
    expect(result.withinBudget).toBe(true);
  });

  it("reports withinBudget=false when the resulting sentence is under 20 words", () => {
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt("Widgets are hard to manage"), targetUsers: [], scopeBoundaries: [] } });
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), arch, []);
    expect(result.wordCount).toBeLessThan(20);
    expect(result.withinBudget).toBe(false);
  });

  it("downgrades confidence from 'confirmed' to 'derived' once a domains clause is added (the composite sentence is now a synthesized claim)", () => {
    const domain = makeCapabilityDomain({ sourceLabel: "Governance", capabilities: [makeCapability()] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt("Teams lack a governed way to operate widgets", "confirmed"), targetUsers: [], scopeBoundaries: [] } });

    const result = synthesizeProductPurpose(model, arch, []);
    expect(result.confidence).toBe("derived");
  });

  it("keeps confidence 'confirmed' when the problem statement is confirmed and there is no domains clause", () => {
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt("Teams lack a governed way to operate widgets", "confirmed"), targetUsers: [], scopeBoundaries: [] } });
    const result = synthesizeProductPurpose(makeEmptyCapabilityModel(), arch, []);
    expect(result.confidence).toBe("confirmed");
  });

  it("preserves a non-confirmed problem-statement confidence regardless of whether a domains clause is added", () => {
    const domain = makeCapabilityDomain({ sourceLabel: "Governance", capabilities: [makeCapability()] });
    const model = makeEmptyCapabilityModel({ domains: [domain] });
    const arch = makeArchitectureFixture({ purpose: { problemStatement: stmt("Teams lack a governed way to operate widgets", "suggested"), targetUsers: [], scopeBoundaries: [] } });

    const result = synthesizeProductPurpose(model, arch, []);
    expect(result.confidence).toBe("suggested");
  });

  it("is deterministic: two syntheses of the same input produce identical output", () => {
    const arch = makeArchitectureFixture();
    const model = makeEmptyCapabilityModel();
    const a = synthesizeProductPurpose(model, arch, ["Compliance Officer"]);
    const b = synthesizeProductPurpose(model, arch, ["Compliance Officer"]);
    expect(a).toEqual(b);
  });
});
