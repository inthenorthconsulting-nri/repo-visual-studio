import { describe, expect, it } from "vitest";
import { containsAbsoluteSuperiorityTerm, containsGenericMarketingTerm, findUnsupportedQualifiedMaturityTerm, humanizeIdentifier, truncateToWords, wordCount } from "../label.js";

describe("containsGenericMarketingTerm", () => {
  it("detects a generic marketing term case-insensitively and returns the matched term", () => {
    expect(containsGenericMarketingTerm("This is an AI-Powered platform.")).toBe("ai-powered");
    expect(containsGenericMarketingTerm("Our revolutionary approach to widgets.")).toBe("revolutionary");
  });

  it("returns undefined when no generic marketing term is present", () => {
    expect(containsGenericMarketingTerm("Synchronizes widgets across environments for compliance teams.")).toBeUndefined();
  });
});

describe("containsAbsoluteSuperiorityTerm", () => {
  it("detects an absolute superiority term case-insensitively", () => {
    expect(containsAbsoluteSuperiorityTerm("This is THE ONLY tool that does this.")).toBe("the only");
    expect(containsAbsoluteSuperiorityTerm("It is unmatched in the industry.")).toBe("unmatched");
  });

  it("returns undefined when no absolute superiority term is present", () => {
    expect(containsAbsoluteSuperiorityTerm("Synchronizes widgets across environments.")).toBeUndefined();
  });
});

describe("findUnsupportedQualifiedMaturityTerm", () => {
  it("flags 'production-grade' as unsupported when none of its required evidence classes are available", () => {
    expect(findUnsupportedQualifiedMaturityTerm("A production-grade platform.", new Set())).toBe("production-grade");
  });

  it("does not flag 'production-grade' when at least one required evidence class is available", () => {
    expect(findUnsupportedQualifiedMaturityTerm("A production-grade platform.", new Set(["deployment"]))).toBeUndefined();
    expect(findUnsupportedQualifiedMaturityTerm("A production-grade platform.", new Set(["release"]))).toBeUndefined();
    expect(findUnsupportedQualifiedMaturityTerm("A production-grade platform.", new Set(["usage"]))).toBeUndefined();
  });

  it("returns undefined when no qualified maturity term appears at all", () => {
    expect(findUnsupportedQualifiedMaturityTerm("A widget synchronization platform.", new Set())).toBeUndefined();
  });
});

describe("wordCount", () => {
  it("counts words separated by whitespace", () => {
    expect(wordCount("Governs widget operations for compliance teams")).toBe(6);
  });

  it("ignores leading/trailing whitespace and collapses internal runs", () => {
    expect(wordCount("  Governs   widget   operations  ")).toBe(3);
  });

  it("returns 0 for an empty string", () => {
    expect(wordCount("")).toBe(0);
  });
});

describe("truncateToWords", () => {
  it("returns the text unchanged when at or under the word limit", () => {
    expect(truncateToWords("Governs widget operations", 5)).toBe("Governs widget operations");
  });

  it("truncates to exactly maxWords when over the limit", () => {
    expect(truncateToWords("one two three four five six", 3)).toBe("one two three");
  });
});

describe("humanizeIdentifier", () => {
  it("title-cases a snake_case identifier into a human-facing phrase", () => {
    expect(humanizeIdentifier("governance_platform")).toBe("Governance Platform");
  });

  it("title-cases a kebab-case identifier into a human-facing phrase", () => {
    expect(humanizeIdentifier("developer-tool")).toBe("Developer Tool");
  });

  it("never invents words beyond the identifier's own parts", () => {
    expect(humanizeIdentifier("x")).toBe("X");
  });
});
