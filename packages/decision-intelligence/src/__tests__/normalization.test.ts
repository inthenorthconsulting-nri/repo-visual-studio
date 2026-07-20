import { describe, expect, it } from "vitest";
import { normalizeDecisionFields } from "../normalization.js";
import type { RawParsedDecision } from "../markdown-parser.js";

function parsed(overrides: Partial<RawParsedDecision> = {}): RawParsedDecision {
  return {
    title: undefined,
    leadParagraph: "",
    sections: {},
    listItemsBySection: {},
    table: undefined,
    ...overrides,
  };
}

describe("normalizeDecisionFields: title precedence", () => {
  it("prefers frontmatter.title over parsed title and fallback", () => {
    const result = normalizeDecisionFields(parsed({ title: "Parsed Title" }), { title: "Frontmatter Title" }, "Fallback Title", undefined);
    expect(result.title).toBe("Frontmatter Title");
  });

  it("falls back to parsed.title when frontmatter.title is absent", () => {
    const result = normalizeDecisionFields(parsed({ title: "Parsed Title" }), undefined, "Fallback Title", undefined);
    expect(result.title).toBe("Parsed Title");
  });

  it("falls back to fallbackTitle when neither frontmatter nor parsed provide a title", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Fallback Title", undefined);
    expect(result.title).toBe("Fallback Title");
  });

  it("treats a whitespace-only frontmatter.title as absent", () => {
    const result = normalizeDecisionFields(parsed({ title: "Parsed Title" }), { title: "   " }, "Fallback Title", undefined);
    expect(result.title).toBe("Parsed Title");
  });

  it("ignores a non-string frontmatter.title", () => {
    const result = normalizeDecisionFields(parsed({ title: "Parsed Title" }), { title: 42 }, "Fallback Title", undefined);
    expect(result.title).toBe("Parsed Title");
  });
});

describe("normalizeDecisionFields: decision_status precedence and mapping", () => {
  it("prefers frontmatter.status over section and table status", () => {
    const result = normalizeDecisionFields(parsed({ sections: { status: "rejected" }, table: { status: "draft" } }), { status: "accepted" }, "Title", undefined);
    expect(result.decision_status).toBe("accepted");
  });

  it("falls back to the 'status' section when frontmatter.status is absent", () => {
    const result = normalizeDecisionFields(parsed({ sections: { status: "accepted" }, table: { status: "draft" } }), undefined, "Title", undefined);
    expect(result.decision_status).toBe("accepted");
  });

  it("falls back to the table's status column when neither frontmatter nor a section provide one", () => {
    const result = normalizeDecisionFields(parsed({ table: { status: "accepted" } }), undefined, "Title", undefined);
    expect(result.decision_status).toBe("accepted");
  });

  it("maps an unrecognized status string to 'unknown', never guessing", () => {
    const result = normalizeDecisionFields(parsed(), { status: "some made up status" }, "Title", undefined);
    expect(result.decision_status).toBe("unknown");
  });

  it("maps a completely absent status to 'unknown'", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Title", undefined);
    expect(result.decision_status).toBe("unknown");
  });

  it("is case-insensitive and trims whitespace when mapping status text", () => {
    const result = normalizeDecisionFields(parsed(), { status: "  ACCEPTED  " }, "Title", undefined);
    expect(result.decision_status).toBe("accepted");
  });

  it("honors a configured status_mapping in addition to the built-in defaults", () => {
    const result = normalizeDecisionFields(parsed(), { status: "shipped" }, "Title", { accepted: ["shipped"] });
    expect(result.decision_status).toBe("accepted");
  });

  it("still recognizes built-in default status values when a status_mapping is configured for a different status", () => {
    const result = normalizeDecisionFields(parsed(), { status: "accepted" }, "Title", { under_review: ["pending"] });
    expect(result.decision_status).toBe("accepted");
  });
});

describe("normalizeDecisionFields: scope", () => {
  it("uses frontmatter.scope when it is a valid DecisionScope", () => {
    const result = normalizeDecisionFields(parsed(), { scope: "capability" }, "Title", undefined);
    expect(result.scope).toBe("capability");
  });

  it("defaults to 'unresolved' when frontmatter.scope is absent", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Title", undefined);
    expect(result.scope).toBe("unresolved");
  });

  it("defaults to 'unresolved' for an unrecognized scope value rather than guessing", () => {
    const result = normalizeDecisionFields(parsed(), { scope: "galaxy_wide" }, "Title", undefined);
    expect(result.scope).toBe("unresolved");
  });

  it("does not derive scope from parsed markdown sections", () => {
    const result = normalizeDecisionFields(parsed({ sections: { scope: "capability" } }), undefined, "Title", undefined);
    expect(result.scope).toBe("unresolved");
  });
});

describe("normalizeDecisionFields: context and decision_text", () => {
  it("prefers frontmatter.context over the 'context' section", () => {
    const result = normalizeDecisionFields(parsed({ sections: { context: "Section context" } }), { context: "Frontmatter context" }, "Title", undefined);
    expect(result.context).toBe("Frontmatter context");
  });

  it("falls back to the 'context' section when frontmatter.context is absent", () => {
    const result = normalizeDecisionFields(parsed({ sections: { context: "Section context" } }), undefined, "Title", undefined);
    expect(result.context).toBe("Section context");
  });

  it("leaves context undefined when neither source provides it", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Title", undefined);
    expect(result.context).toBeUndefined();
  });

  it("prefers frontmatter.decision over the 'decision' section for decision_text", () => {
    const result = normalizeDecisionFields(parsed({ sections: { decision: "Section decision" } }), { decision: "Frontmatter decision" }, "Title", undefined);
    expect(result.decision_text).toBe("Frontmatter decision");
  });

  it("falls back to the 'decision' section for decision_text", () => {
    const result = normalizeDecisionFields(parsed({ sections: { decision: "Section decision" } }), undefined, "Title", undefined);
    expect(result.decision_text).toBe("Section decision");
  });
});

describe("normalizeDecisionFields: authors", () => {
  it("reads authors from a frontmatter array", () => {
    const result = normalizeDecisionFields(parsed(), { authors: ["Alice", "Bob"] }, "Title", undefined);
    expect(result.authors).toEqual(["Alice", "Bob"]);
  });

  it("reads a single author from the singular 'author' field", () => {
    const result = normalizeDecisionFields(parsed(), { author: "Alice" }, "Title", undefined);
    expect(result.authors).toEqual(["Alice"]);
  });

  it("prefers the plural 'authors' field over 'author' when both are present", () => {
    const result = normalizeDecisionFields(parsed(), { authors: ["Alice"], author: "Bob" }, "Title", undefined);
    expect(result.authors).toEqual(["Alice"]);
  });

  it("does not fall back to 'author' when 'authors' is present but an empty array", () => {
    const result = normalizeDecisionFields(parsed(), { authors: [], author: "Bob" }, "Title", undefined);
    expect(result.authors).toEqual([]);
  });

  it("filters out non-string and empty entries from the authors array", () => {
    const result = normalizeDecisionFields(parsed(), { authors: ["Alice", "", 42, "  ", "Bob"] }, "Title", undefined);
    expect(result.authors).toEqual(["Alice", "Bob"]);
  });

  it("trims whitespace around each author name", () => {
    const result = normalizeDecisionFields(parsed(), { authors: ["  Alice  "] }, "Title", undefined);
    expect(result.authors).toEqual(["Alice"]);
  });

  it("defaults to an empty array when no authors field is present", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Title", undefined);
    expect(result.authors).toEqual([]);
  });
});

describe("normalizeDecisionFields: date", () => {
  it("prefers frontmatter.date over the table's date column", () => {
    const result = normalizeDecisionFields(parsed({ table: { date: "2025-01-01" } }), { date: "2026-01-01" }, "Title", undefined);
    expect(result.date).toBe("2026-01-01");
  });

  it("falls back to the table's date column when frontmatter.date is absent", () => {
    const result = normalizeDecisionFields(parsed({ table: { date: "2025-01-01" } }), undefined, "Title", undefined);
    expect(result.date).toBe("2025-01-01");
  });

  it("does not derive date from a markdown section (only frontmatter or table)", () => {
    const result = normalizeDecisionFields(parsed({ sections: { date: "2025-01-01" } }), undefined, "Title", undefined);
    expect(result.date).toBeUndefined();
  });
});

describe("normalizeDecisionFields: supersedes / superseded_by", () => {
  it("reads supersedes from frontmatter as a string array", () => {
    const result = normalizeDecisionFields(parsed(), { supersedes: ["decision:old-1", "decision:old-2"] }, "Title", undefined);
    expect(result.supersedes).toEqual(["decision:old-1", "decision:old-2"]);
  });

  it("wraps a single supersedes string into an array", () => {
    const result = normalizeDecisionFields(parsed(), { supersedes: "decision:old-1" }, "Title", undefined);
    expect(result.supersedes).toEqual(["decision:old-1"]);
  });

  it("defaults supersedes to an empty array when absent", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Title", undefined);
    expect(result.supersedes).toEqual([]);
  });

  it("reads superseded_by from the underscore key", () => {
    const result = normalizeDecisionFields(parsed(), { superseded_by: ["decision:new-1"] }, "Title", undefined);
    expect(result.superseded_by).toEqual(["decision:new-1"]);
  });

  it("reads superseded_by from the hyphenated 'superseded-by' key when the underscore key is absent", () => {
    const result = normalizeDecisionFields(parsed(), { "superseded-by": ["decision:new-1"] }, "Title", undefined);
    expect(result.superseded_by).toEqual(["decision:new-1"]);
  });

  it("prefers the underscore key over the hyphenated key when both are present", () => {
    const result = normalizeDecisionFields(parsed(), { superseded_by: ["decision:new-1"], "superseded-by": ["decision:new-2"] }, "Title", undefined);
    expect(result.superseded_by).toEqual(["decision:new-1"]);
  });
});

describe("normalizeDecisionFields: full fallback with nothing provided", () => {
  it("produces the documented defaults when parsed and frontmatter are both empty", () => {
    const result = normalizeDecisionFields(parsed(), undefined, "Fallback Title", undefined);
    expect(result).toEqual({
      title: "Fallback Title",
      decision_status: "unknown",
      scope: "unresolved",
      context: undefined,
      decision_text: undefined,
      authors: [],
      date: undefined,
      supersedes: [],
      superseded_by: [],
    });
  });
});
