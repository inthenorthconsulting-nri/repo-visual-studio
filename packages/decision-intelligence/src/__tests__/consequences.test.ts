import { describe, expect, it } from "vitest";
import { extractConsequences } from "../consequences.js";
import { buildConsequenceId } from "../ids.js";
import type { RawParsedDecision } from "../markdown-parser.js";
import { evidenceRef } from "./decision-fixtures.js";

const DECISION_ID = "decision:test-1";

function emptyParsed(overrides: Partial<RawParsedDecision> = {}): RawParsedDecision {
  return {
    title: undefined,
    leadParagraph: "",
    sections: {},
    listItemsBySection: {},
    table: undefined,
    ...overrides,
  };
}

describe("extractConsequences: frontmatter object form", () => {
  it("extracts statement/classification pairs from an array of objects", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ statement: "Requires a new on-call rotation.", classification: "obligation" }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Requires a new on-call rotation.");
    expect(result[0].classification).toBe("obligation");
    expect(result[0].decision_id).toBe(DECISION_ID);
  });

  it("defaults to 'unclassified' when the object's classification is missing or unrecognized", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ statement: "No classification given." }, { statement: "Bogus classification.", classification: "made_up" }] },
      emptyParsed(),
      [],
    );
    expect(result[0].classification).toBe("unclassified");
    expect(result[1].classification).toBe("unclassified");
  });

  it("drops entries whose statement is missing, non-string, or blank after trim", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ classification: "positive" }, { statement: "   ", classification: "positive" }, { statement: 5, classification: "positive" }, { statement: "Kept." }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Kept.");
  });

  it("trims object statements", () => {
    const result = extractConsequences(DECISION_ID, { consequences: [{ statement: "  padded  ", classification: "positive" }] }, emptyParsed(), []);
    expect(result[0].statement).toBe("padded");
  });
});

describe("extractConsequences: frontmatter string forms", () => {
  it("parses '[classification] statement' bracket form", () => {
    const result = extractConsequences(DECISION_ID, { consequences: ["[negative] Latency increases under peak load."] }, emptyParsed(), []);
    expect(result[0].classification).toBe("negative");
    expect(result[0].statement).toBe("Latency increases under peak load.");
  });

  it("parses 'classification: statement' colon form", () => {
    const result = extractConsequences(DECISION_ID, { consequences: ["tradeoff: Simpler code, slightly higher memory use."] }, emptyParsed(), []);
    expect(result[0].classification).toBe("tradeoff");
    expect(result[0].statement).toBe("Simpler code, slightly higher memory use.");
  });

  it("is case-insensitive on the label", () => {
    const result = extractConsequences(DECISION_ID, { consequences: ["[RISK] Upper case label."] }, emptyParsed(), []);
    expect(result[0].classification).toBe("risk");
  });

  it("falls back to 'unclassified' and keeps the full text when the label is unrecognized", () => {
    const result = extractConsequences(DECISION_ID, { consequences: ["[bogus] Not a real classification."] }, emptyParsed(), []);
    expect(result[0].classification).toBe("unclassified");
    expect(result[0].statement).toBe("[bogus] Not a real classification.");
  });

  it("falls back to 'unclassified' when there is no label at all", () => {
    const result = extractConsequences(DECISION_ID, { consequences: ["Just a plain sentence."] }, emptyParsed(), []);
    expect(result[0].classification).toBe("unclassified");
    expect(result[0].statement).toBe("Just a plain sentence.");
  });
});

describe("extractConsequences: every recognized classification value", () => {
  const classes = ["positive", "negative", "neutral", "tradeoff", "risk", "obligation", "constraint", "unclassified"] as const;

  it.each(classes)("accepts frontmatter object classification '%s'", (classification) => {
    const result = extractConsequences(DECISION_ID, { consequences: [{ statement: "s", classification }] }, emptyParsed(), []);
    expect(result[0].classification).toBe(classification);
  });

  it.each(classes)("accepts labeled-list classification '%s'", (classification) => {
    const result = extractConsequences(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { consequences: [`[${classification}] statement text`] } }), []);
    expect(result[0].classification).toBe(classification);
  });
});

describe("extractConsequences: frontmatter vs. labeled-list precedence", () => {
  it("uses frontmatter and ignores the labeled list when frontmatter has entries", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ statement: "From frontmatter.", classification: "positive" }] },
      emptyParsed({ listItemsBySection: { consequences: ["[negative] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From frontmatter.");
  });

  it("falls back to the labeled list when frontmatter is absent", () => {
    const result = extractConsequences(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { consequences: ["[negative] From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
    expect(result[0].classification).toBe("negative");
  });

  it("falls back to the labeled list when frontmatter.consequences is not an array", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: "not an array" },
      emptyParsed({ listItemsBySection: { consequences: ["[negative] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });

  it("falls back to the labeled list when the frontmatter array is present but empty", () => {
    const result = extractConsequences(DECISION_ID, { consequences: [] }, emptyParsed({ listItemsBySection: { consequences: ["constraint: From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });
});

describe("extractConsequences: never sentiment/prose inference", () => {
  it("does not extract anything from a 'Consequences' section's prose body when there is no recognized list or frontmatter", () => {
    const parsed = emptyParsed({
      sections: {
        consequences: "This removes flexibility for future teams and increases coupling between the two services.",
      },
      // No listItemsBySection entry: this is prose, not a bulleted list.
    });
    const result = extractConsequences(DECISION_ID, undefined, parsed, []);
    expect(result).toEqual([]);
  });

  it("does not extract anything when both frontmatter and the labeled list are absent", () => {
    const result = extractConsequences(DECISION_ID, undefined, emptyParsed(), []);
    expect(result).toEqual([]);
  });

  it("does not infer 'negative' from wording like 'removes flexibility' in an unlabeled list item", () => {
    const result = extractConsequences(
      DECISION_ID,
      undefined,
      emptyParsed({ listItemsBySection: { consequences: ["This removes flexibility for future teams."] } }),
      [],
    );
    expect(result[0].classification).toBe("unclassified");
    expect(result[0].statement).toBe("This removes flexibility for future teams.");
  });

  it("does not infer 'positive' from wording like 'greatly improves throughput' in an unlabeled list item", () => {
    const result = extractConsequences(
      DECISION_ID,
      undefined,
      emptyParsed({ listItemsBySection: { consequences: ["Greatly improves throughput for read-heavy workloads."] } }),
      [],
    );
    expect(result[0].classification).toBe("unclassified");
  });
});

describe("extractConsequences: id derivation and evidence passthrough", () => {
  it("derives id via buildConsequenceId(decisionId, '<index>.<statement>')", () => {
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ statement: "First.", classification: "positive" }, { statement: "Second.", classification: "negative" }] },
      emptyParsed(),
      [],
    );
    expect(result[0].id).toBe(buildConsequenceId(DECISION_ID, "0.First."));
    expect(result[1].id).toBe(buildConsequenceId(DECISION_ID, "1.Second."));
  });

  it("attaches the caller-supplied evidence_refs verbatim to every produced consequence", () => {
    const refs = [evidenceRef({ path: "docs/adr/0001.md" })];
    const result = extractConsequences(
      DECISION_ID,
      { consequences: [{ statement: "a", classification: "positive" }, { statement: "b", classification: "negative" }] },
      emptyParsed(),
      refs,
    );
    expect(result[0].evidence_refs).toBe(refs);
    expect(result[1].evidence_refs).toBe(refs);
  });
});
