import { describe, expect, it } from "vitest";
import { classifyDecisionSource, type ClassificationInput } from "../source-classification.js";

function input(overrides: Partial<ClassificationInput> = {}): ClassificationInput {
  return {
    repo_relative_path: "docs/notes.md",
    configured_type: undefined,
    raw_content: "",
    frontmatter: undefined,
    ...overrides,
  };
}

describe("classifyDecisionSource: configured_path", () => {
  it("uses configured_type unconditionally when present", () => {
    const result = classifyDecisionSource(input({ configured_type: "rfc", raw_content: "# ADR-1\n", frontmatter: { id: "adr-1", status: "accepted" } }));
    expect(result).toEqual({ source_type: "rfc", classification_basis: "configured_path" });
  });

  it("takes precedence over every other signal at once", () => {
    const result = classifyDecisionSource(
      input({
        configured_type: "decision_log",
        raw_content: "# ADR-1\n## Decision:\n",
        repo_relative_path: "docs/0001-example.md",
        frontmatter: { type: "rfc", id: "adr-1", status: "accepted" },
      }),
    );
    expect(result).toEqual({ source_type: "decision_log", classification_basis: "configured_path" });
  });
});

describe("classifyDecisionSource: explicit_type_field", () => {
  it("uses frontmatter.type when it is a recognized DecisionSourceType", () => {
    const result = classifyDecisionSource(input({ frontmatter: { type: "decision_log" } }));
    expect(result).toEqual({ source_type: "decision_log", classification_basis: "explicit_type_field" });
  });

  it("ignores frontmatter.type values outside the recognized decision-type list and falls through", () => {
    const result = classifyDecisionSource(input({ frontmatter: { type: "unsupported" } }));
    expect(result.classification_basis).not.toBe("explicit_type_field");
  });

  it("ignores a non-string frontmatter.type value", () => {
    const result = classifyDecisionSource(input({ frontmatter: { type: 123 } }));
    expect(result.classification_basis).not.toBe("explicit_type_field");
  });

  it("takes precedence over frontmatter shape, heading pattern, and filename convention", () => {
    const result = classifyDecisionSource(
      input({
        frontmatter: { type: "rfc", id: "adr-1", status: "accepted" },
        raw_content: "# ADR-1\n",
        repo_relative_path: "docs/0001-decision.md",
      }),
    );
    expect(result).toEqual({ source_type: "rfc", classification_basis: "explicit_type_field" });
  });
});

describe("classifyDecisionSource: frontmatter shape", () => {
  it("id+status frontmatter without a recognizable id prefix classifies as design_decision", () => {
    const result = classifyDecisionSource(input({ frontmatter: { id: "my-decision", status: "accepted" } }));
    expect(result).toEqual({ source_type: "design_decision", classification_basis: "frontmatter" });
  });

  it("id+status frontmatter with an rfc-prefixed id classifies as rfc", () => {
    const result = classifyDecisionSource(input({ frontmatter: { id: "RFC-42", status: "draft" } }));
    expect(result).toEqual({ source_type: "rfc", classification_basis: "frontmatter" });
  });

  it("id+status frontmatter with an adr-prefixed id classifies as adr", () => {
    const result = classifyDecisionSource(input({ frontmatter: { id: "adr-0001", status: "accepted" } }));
    expect(result).toEqual({ source_type: "adr", classification_basis: "frontmatter" });
  });

  it("an 'adr' key alone (without id/status) is sufficient to trigger frontmatter shape", () => {
    const result = classifyDecisionSource(input({ frontmatter: { adr: true } }));
    expect(result).toEqual({ source_type: "design_decision", classification_basis: "frontmatter" });
  });

  it("id alone without status does not trigger frontmatter shape", () => {
    const result = classifyDecisionSource(input({ frontmatter: { id: "adr-1" } }));
    expect(result.classification_basis).not.toBe("frontmatter");
  });

  it("status alone without id does not trigger frontmatter shape", () => {
    const result = classifyDecisionSource(input({ frontmatter: { status: "accepted" } }));
    expect(result.classification_basis).not.toBe("frontmatter");
  });

  it("takes precedence over heading pattern and filename convention", () => {
    const result = classifyDecisionSource(
      input({ frontmatter: { id: "x", status: "accepted" }, raw_content: "# ADR-1\n", repo_relative_path: "docs/0001-decision.md" }),
    );
    expect(result.classification_basis).toBe("frontmatter");
  });

  it("returns undefined frontmatter safely (no crash) when frontmatter is absent", () => {
    const result = classifyDecisionSource(input({ frontmatter: undefined }));
    expect(result.classification_basis).not.toBe("frontmatter");
  });
});

describe("classifyDecisionSource: heading pattern", () => {
  it("recognizes '# ADR-<n>' style headings as adr", () => {
    const result = classifyDecisionSource(input({ raw_content: "# ADR-1: Use Postgres\n\nBody." }));
    expect(result).toEqual({ source_type: "adr", classification_basis: "heading_pattern" });
  });

  it("recognizes headings without a separator ('ADR1')", () => {
    const result = classifyDecisionSource(input({ raw_content: "# ADR1\n" }));
    expect(result.source_type).toBe("adr");
  });

  it("recognizes '## Decision:' style headings as design_decision", () => {
    const result = classifyDecisionSource(input({ raw_content: "## Decision: Use Postgres\n" }));
    expect(result).toEqual({ source_type: "design_decision", classification_basis: "heading_pattern" });
  });

  it("ADR heading pattern takes precedence over 'Decision:' heading pattern when both are present", () => {
    const result = classifyDecisionSource(input({ raw_content: "# ADR-1\n## Decision: Accept\n" }));
    expect(result.source_type).toBe("adr");
  });

  it("takes precedence over filename convention", () => {
    const result = classifyDecisionSource(input({ raw_content: "## Decision: Accept\n", repo_relative_path: "notes/random.md" }));
    expect(result.classification_basis).toBe("heading_pattern");
  });

  it("is case-insensitive and matches on any line via the multiline flag", () => {
    const result = classifyDecisionSource(input({ raw_content: "Intro text.\n# adr-99\n" }));
    expect(result.source_type).toBe("adr");
  });

  it("does not match ADR text that is not a heading (no leading '#')", () => {
    const result = classifyDecisionSource(input({ raw_content: "This document references ADR-1 in passing.\n" }));
    expect(result.classification_basis).not.toBe("heading_pattern");
  });
});

describe("classifyDecisionSource: filename convention", () => {
  it("recognizes a 4-digit-prefixed filename as adr", () => {
    const result = classifyDecisionSource(input({ repo_relative_path: "docs/adr/0001-use-postgres.md" }));
    expect(result).toEqual({ source_type: "adr", classification_basis: "filename_convention" });
  });

  it("does not match a filename with fewer than 4 consecutive digits", () => {
    const result = classifyDecisionSource(input({ repo_relative_path: "docs/adr/001-use-postgres.md" }));
    expect(result.classification_basis).not.toBe("filename_convention");
  });

  it("matches case-insensitively on the .md extension", () => {
    const result = classifyDecisionSource(input({ repo_relative_path: "docs/adr/0001-use-postgres.MD" }));
    expect(result.source_type).toBe("adr");
  });
});

describe("classifyDecisionSource: none / unsupported", () => {
  it("returns unsupported with issue_kind when nothing matches", () => {
    const result = classifyDecisionSource(input({ repo_relative_path: "docs/random-notes.md", raw_content: "Just some prose." }));
    expect(result).toEqual({ source_type: "unsupported", classification_basis: "none", issue_kind: "unsupported_source_type" });
  });

  it("never guesses a decision type from ambiguous content", () => {
    const result = classifyDecisionSource(input({ raw_content: "We decided to use decisions somewhere." }));
    expect(result.source_type).toBe("unsupported");
  });

  it("does not set issue_kind on any successful classification", () => {
    const result = classifyDecisionSource(input({ configured_type: "adr" }));
    expect(result.issue_kind).toBeUndefined();
  });
});
