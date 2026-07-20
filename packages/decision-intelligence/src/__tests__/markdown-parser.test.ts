import { describe, expect, it } from "vitest";
import { parseDecisionMarkdown, parseLabeledListItem } from "../markdown-parser.js";

describe("parseDecisionMarkdown: title and lead paragraph", () => {
  it("extracts the first depth-1 heading as title", () => {
    const result = parseDecisionMarkdown("# Use Postgres\n\nSome lead text.\n");
    expect(result.title).toBe("Use Postgres");
  });

  it("returns undefined title when there is no depth-1 heading", () => {
    const result = parseDecisionMarkdown("## Status\n\nAccepted.\n");
    expect(result.title).toBeUndefined();
  });

  it("extracts the first paragraph as leadParagraph", () => {
    const result = parseDecisionMarkdown("# Title\n\nThis is the lead paragraph.\n\n## Status\n\nAccepted.\n");
    expect(result.leadParagraph).toBe("This is the lead paragraph.");
  });

  it("returns an empty string leadParagraph when there is no paragraph at all", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Status\n\n- accepted\n");
    expect(result.leadParagraph).toBe("");
  });

  it("only ever picks the first depth-1 heading, ignoring later ones", () => {
    const result = parseDecisionMarkdown("# First Title\n\nBody.\n\n# Second Title\n");
    expect(result.title).toBe("First Title");
  });
});

describe("parseDecisionMarkdown: heading sections (Form 1)", () => {
  it("splits Nygard-style sections keyed by normalized heading text", () => {
    const result = parseDecisionMarkdown("# ADR-1\n\n## Status\n\nAccepted.\n\n## Context\n\nWe needed a database.\n\n## Decision\n\nUse Postgres.\n\n## Consequences\n\nOperational cost.\n");
    expect(result.sections).toEqual({
      status: "Accepted.",
      context: "We needed a database.",
      decision: "Use Postgres.",
      consequences: "Operational cost.",
    });
  });

  it("recognizes depth-3 headings as section boundaries too", () => {
    const result = parseDecisionMarkdown("# Title\n\n### Status\n\nAccepted.\n");
    expect(result.sections["status"]).toBe("Accepted.");
  });

  it("does not treat a depth-1 or depth-4 heading as a section boundary (their text is absorbed into the enclosing section)", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Status\n\nAccepted.\n\n#### Detail\n\nMore text under detail.\n");
    expect(result.sections["status"]).toBe("Accepted.\n\nDetail\n\nMore text under detail.");
    expect(result.sections["detail"]).toBeUndefined();
  });

  it("strips a leading 'Decision:' label from the heading text when deriving the section key", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Decision: Use Postgres\n\nBecause it is reliable.\n");
    expect(result.sections["use_postgres"]).toBe("Because it is reliable.");
    expect(result.sections["decision"]).toBeUndefined();
  });

  it("normalizes punctuation and whitespace in heading text into underscores", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Open Questions & Risks!\n\nSome text.\n");
    expect(result.sections["open_questions_risks"]).toBe("Some text.");
  });

  it("excludes pipe-table syntax from section text now that remark-gfm parses it into a `table`-typed node", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Status\n\nIntro text.\n\n| Status | Date |\n| --- | --- |\n| Accepted | 2026-01-01 |\n\nTrailing text.\n");
    expect(result.sections["status"]).toBe("Intro text.\n\nTrailing text.");
    expect(result.sections["status"]).not.toContain("Accepted");
    expect(result.sections["status"]).not.toContain("2026-01-01");
  });

  it("captures the last section through to end of document", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Consequences\n\nFirst line.\n\nSecond paragraph.\n");
    expect(result.sections["consequences"]).toBe("First line.\n\nSecond paragraph.");
  });

  it("returns empty sections and listItemsBySection for a document with no qualifying headings", () => {
    const result = parseDecisionMarkdown("# Title\n\nJust prose, no headings.\n");
    expect(result.sections).toEqual({});
    expect(result.listItemsBySection).toEqual({});
  });
});

describe("parseDecisionMarkdown: list items by section", () => {
  it("captures top-level list items within a section, trimmed", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Assumptions\n\n- [scale] Traffic stays under 1000 rps\n- [cost] Budget remains flat\n");
    expect(result.listItemsBySection["assumptions"]).toEqual(["[scale] Traffic stays under 1000 rps", "[cost] Budget remains flat"]);
  });

  it("does not populate listItemsBySection for a section with no list", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Status\n\nAccepted, no list here.\n");
    expect(result.listItemsBySection["status"]).toBeUndefined();
  });

  it("filters out list items that flatten to empty text", () => {
    const result = parseDecisionMarkdown("# Title\n\n## Notes\n\n-   \n- Real item\n");
    expect(result.listItemsBySection["notes"]).toEqual(["Real item"]);
  });
});

describe("parseDecisionMarkdown: leading table (Form 2)", () => {
  it("extracts a well-formed pipe table's first data row keyed by lowercased headers", () => {
    const result = parseDecisionMarkdown("# Title\n\n| Status | Date | Author |\n| --- | --- | --- |\n| Accepted | 2026-01-01 | Alice |\n");
    expect(result.table).toEqual({ status: "Accepted", date: "2026-01-01", author: "Alice" });
  });

  it("returns undefined when there is no table-like syntax at all", () => {
    const result = parseDecisionMarkdown("# Title\n\nJust prose.\n");
    expect(result.table).toBeUndefined();
  });

  it("extracts only the first table when multiple candidate tables are present", () => {
    const result = parseDecisionMarkdown("# Title\n\n| Status |\n| --- |\n| Accepted |\n\n| Other |\n| --- |\n| Value |\n");
    expect(result.table).toEqual({ status: "Accepted" });
  });
});

describe("parseDecisionMarkdown: multiple forms coexisting", () => {
  it("captures both a leading table and heading sections when both forms are present", () => {
    const result = parseDecisionMarkdown("# Title\n\n| Status |\n| --- |\n| Accepted |\n\n## Context\n\nWe needed a database.\n");
    expect(result.table).toEqual({ status: "Accepted" });
    expect(result.sections["context"]).toBe("We needed a database.");
  });
});

describe("parseLabeledListItem", () => {
  const validLabels = ["risk", "benefit", "negative_outcome"] as const;

  it("recognizes a '[label] statement' form", () => {
    const result = parseLabeledListItem("[risk] This could increase latency.", validLabels);
    expect(result).toEqual({ label: "risk", statement: "This could increase latency." });
  });

  it("recognizes a 'label: statement' form", () => {
    const result = parseLabeledListItem("risk: This could increase latency.", validLabels);
    expect(result).toEqual({ label: "risk", statement: "This could increase latency." });
  });

  it("matches labels case-insensitively", () => {
    const result = parseLabeledListItem("[RISK] Upper case label.", validLabels);
    expect(result.label).toBe("risk");
  });

  it("normalizes multi-word labels to snake_case before matching", () => {
    const result = parseLabeledListItem("[negative outcome] Something bad.", validLabels);
    expect(result).toEqual({ label: "negative_outcome", statement: "Something bad." });
  });

  it("returns undefined label and the full trimmed text when the label is not in validLabels", () => {
    const result = parseLabeledListItem("[unknown_label] Some statement.", validLabels);
    expect(result).toEqual({ label: undefined, statement: "[unknown_label] Some statement." });
  });

  it("returns undefined label and the full trimmed text when there is no label prefix at all", () => {
    const result = parseLabeledListItem("Just a plain bullet with no label.", validLabels);
    expect(result).toEqual({ label: undefined, statement: "Just a plain bullet with no label." });
  });

  it("prefers the bracket form over the colon form when the text could match either pattern order", () => {
    const result = parseLabeledListItem("[risk] risk: nested colon text", validLabels);
    expect(result.label).toBe("risk");
    expect(result.statement).toBe("risk: nested colon text");
  });

  it("trims surrounding whitespace from the recovered statement", () => {
    const result = parseLabeledListItem("risk:    Padded statement.   ", validLabels);
    expect(result.statement).toBe("Padded statement.");
  });
});
