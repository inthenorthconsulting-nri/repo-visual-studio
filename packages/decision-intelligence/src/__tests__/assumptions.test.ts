import { describe, expect, it } from "vitest";
import { extractAssumptions } from "../assumptions.js";
import { buildAssumptionId } from "../ids.js";
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

describe("extractAssumptions: frontmatter object form", () => {
  it("extracts statement/state pairs from an array of objects", () => {
    const result = extractAssumptions(
      DECISION_ID,
      { assumptions: [{ statement: "Traffic will stay under 1k rps.", state: "confirmed" }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Traffic will stay under 1k rps.");
    expect(result[0].state).toBe("confirmed");
    expect(result[0].decision_id).toBe(DECISION_ID);
  });

  it("defaults to 'unverifiable' when the object's state is missing or unrecognized", () => {
    const result = extractAssumptions(
      DECISION_ID,
      { assumptions: [{ statement: "No state given." }, { statement: "Bogus state.", state: "made_up" }] },
      emptyParsed(),
      [],
    );
    expect(result[0].state).toBe("unverifiable");
    expect(result[1].state).toBe("unverifiable");
  });

  it("drops entries whose statement is missing, non-string, or blank after trim", () => {
    const result = extractAssumptions(
      DECISION_ID,
      { assumptions: [{ state: "confirmed" }, { statement: "   ", state: "confirmed" }, { statement: 5, state: "confirmed" }, { statement: "Kept." }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Kept.");
  });

  it("trims object statements", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: [{ statement: "  padded  ", state: "confirmed" }] }, emptyParsed(), []);
    expect(result[0].statement).toBe("padded");
  });
});

describe("extractAssumptions: frontmatter string forms", () => {
  it("parses '[state] statement' bracket form", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["[confirmed] The cache is warm."] }, emptyParsed(), []);
    expect(result[0].state).toBe("confirmed");
    expect(result[0].statement).toBe("The cache is warm.");
  });

  it("parses 'state: statement' colon form", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["weakened: The vendor SLA may not hold."] }, emptyParsed(), []);
    expect(result[0].state).toBe("weakened");
    expect(result[0].statement).toBe("The vendor SLA may not hold.");
  });

  it("is case-insensitive on the label", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["[CONFIRMED] Upper case label."] }, emptyParsed(), []);
    expect(result[0].state).toBe("confirmed");
  });

  it("falls back to the default state and keeps the full text when the label is unrecognized", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["[bogus] Not a real state."] }, emptyParsed(), []);
    expect(result[0].state).toBe("unverifiable");
    expect(result[0].statement).toBe("[bogus] Not a real state.");
  });

  it("falls back to the default state when there is no label at all", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["Just a plain sentence."] }, emptyParsed(), []);
    expect(result[0].state).toBe("unverifiable");
    expect(result[0].statement).toBe("Just a plain sentence.");
  });

  it("skips blank strings", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: ["   ", "confirmed: Real one."] }, emptyParsed(), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Real one.");
  });
});

describe("extractAssumptions: every recognized state value", () => {
  const states = ["confirmed", "supported", "weakened", "contradicted", "unverifiable", "retired"] as const;

  it.each(states)("accepts frontmatter object state '%s'", (state) => {
    const result = extractAssumptions(DECISION_ID, { assumptions: [{ statement: "s", state }] }, emptyParsed(), []);
    expect(result[0].state).toBe(state);
  });

  it.each(states)("accepts labeled-list state '%s'", (state) => {
    const result = extractAssumptions(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { assumptions: [`[${state}] statement text`] } }), []);
    expect(result[0].state).toBe(state);
  });
});

describe("extractAssumptions: frontmatter vs. labeled-list precedence", () => {
  it("uses frontmatter and ignores the labeled list when frontmatter has entries", () => {
    const result = extractAssumptions(
      DECISION_ID,
      { assumptions: [{ statement: "From frontmatter.", state: "confirmed" }] },
      emptyParsed({ listItemsBySection: { assumptions: ["[retired] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From frontmatter.");
  });

  it("falls back to the labeled list when frontmatter is absent", () => {
    const result = extractAssumptions(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { assumptions: ["[retired] From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
    expect(result[0].state).toBe("retired");
  });

  it("falls back to the labeled list when frontmatter.assumptions is not an array", () => {
    const result = extractAssumptions(
      DECISION_ID,
      { assumptions: "not an array" },
      emptyParsed({ listItemsBySection: { assumptions: ["[retired] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });

  it("falls back to the labeled list when the frontmatter array is present but empty", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: [] }, emptyParsed({ listItemsBySection: { assumptions: ["confirmed: From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });
});

describe("extractAssumptions: never sentiment/prose inference", () => {
  it("does not extract anything from an 'Assumptions' section's prose body when there is no recognized list or frontmatter", () => {
    const parsed = emptyParsed({
      sections: {
        assumptions: "We assume the vendor contract will renew and that latency will remain acceptable under load.",
      },
      // No listItemsBySection entry: this is prose, not a bulleted list.
    });
    const result = extractAssumptions(DECISION_ID, undefined, parsed, []);
    expect(result).toEqual([]);
  });

  it("does not extract anything when both frontmatter and the labeled list are absent", () => {
    const result = extractAssumptions(DECISION_ID, undefined, emptyParsed(), []);
    expect(result).toEqual([]);
  });

  it("does not infer state from wording in an unlabeled list item, even when the wording suggests a state", () => {
    const result = extractAssumptions(
      DECISION_ID,
      undefined,
      emptyParsed({ listItemsBySection: { assumptions: ["This assumption has been confirmed by the vendor."] } }),
      [],
    );
    // No bracket/colon label recognized -> default state, not "confirmed" despite the wording.
    expect(result[0].state).toBe("unverifiable");
    expect(result[0].statement).toBe("This assumption has been confirmed by the vendor.");
  });
});

describe("extractAssumptions: id derivation and evidence passthrough", () => {
  it("derives id via buildAssumptionId(decisionId, '<index>.<statement>')", () => {
    const result = extractAssumptions(DECISION_ID, { assumptions: [{ statement: "First.", state: "confirmed" }, { statement: "Second.", state: "retired" }] }, emptyParsed(), []);
    expect(result[0].id).toBe(buildAssumptionId(DECISION_ID, "0.First."));
    expect(result[1].id).toBe(buildAssumptionId(DECISION_ID, "1.Second."));
  });

  it("attaches the caller-supplied evidence_refs verbatim to every produced assumption", () => {
    const refs = [evidenceRef({ path: "docs/adr/0001.md" })];
    const result = extractAssumptions(DECISION_ID, { assumptions: [{ statement: "a", state: "confirmed" }, { statement: "b", state: "retired" }] }, emptyParsed(), refs);
    expect(result[0].evidence_refs).toBe(refs);
    expect(result[1].evidence_refs).toBe(refs);
  });
});
