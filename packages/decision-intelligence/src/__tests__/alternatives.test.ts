import { describe, expect, it } from "vitest";
import { extractAlternatives } from "../alternatives.js";
import { buildAlternativeId } from "../ids.js";
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

describe("extractAlternatives: frontmatter object form", () => {
  it("extracts statement/state pairs from an array of objects", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "Use a managed queue instead.", state: "rejected" }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Use a managed queue instead.");
    expect(result[0].state).toBe("rejected");
    expect(result[0].decision_id).toBe(DECISION_ID);
  });

  it("defaults to 'unknown' when the object's state is missing or unrecognized", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "No state given." }, { statement: "Bogus state.", state: "made_up" }] },
      emptyParsed(),
      [],
    );
    expect(result[0].state).toBe("unknown");
    expect(result[1].state).toBe("unknown");
  });

  it("drops entries whose statement is missing, non-string, or blank after trim", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ state: "considered" }, { statement: "   ", state: "considered" }, { statement: 5, state: "considered" }, { statement: "Kept." }] },
      emptyParsed(),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("Kept.");
  });

  it("trims object statements", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: [{ statement: "  padded  ", state: "considered" }] }, emptyParsed(), []);
    expect(result[0].statement).toBe("padded");
  });
});

describe("extractAlternatives: frontmatter string forms", () => {
  it("parses '[state] statement' bracket form", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: ["[selected] The chosen approach."] }, emptyParsed(), []);
    expect(result[0].state).toBe("selected");
    expect(result[0].statement).toBe("The chosen approach.");
  });

  it("parses 'state: statement' colon form", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: ["deferred: Revisit after the next migration."] }, emptyParsed(), []);
    expect(result[0].state).toBe("deferred");
    expect(result[0].statement).toBe("Revisit after the next migration.");
  });

  it("is case-insensitive on the label", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: ["[REJECTED] Upper case label."] }, emptyParsed(), []);
    expect(result[0].state).toBe("rejected");
  });

  it("falls back to 'unknown' and keeps the full text when the label is unrecognized", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: ["[bogus] Not a real state."] }, emptyParsed(), []);
    expect(result[0].state).toBe("unknown");
    expect(result[0].statement).toBe("[bogus] Not a real state.");
  });

  it("falls back to 'unknown' when there is no label at all", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: ["Just a plain sentence."] }, emptyParsed(), []);
    expect(result[0].state).toBe("unknown");
    expect(result[0].statement).toBe("Just a plain sentence.");
  });
});

describe("extractAlternatives: every recognized state value", () => {
  const states = ["considered", "rejected", "deferred", "selected", "unknown"] as const;

  it.each(states)("accepts frontmatter object state '%s'", (state) => {
    const result = extractAlternatives(DECISION_ID, { alternatives: [{ statement: "s", state }] }, emptyParsed(), []);
    expect(result[0].state).toBe(state);
  });

  it.each(states)("accepts labeled-list state '%s'", (state) => {
    const result = extractAlternatives(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { alternatives: [`[${state}] statement text`] } }), []);
    expect(result[0].state).toBe(state);
  });
});

describe("extractAlternatives: frontmatter vs. labeled-list precedence", () => {
  it("uses frontmatter and ignores the labeled list when frontmatter has entries", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "From frontmatter.", state: "considered" }] },
      emptyParsed({ listItemsBySection: { alternatives: ["[rejected] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From frontmatter.");
  });

  it("falls back to the labeled list when frontmatter is absent", () => {
    const result = extractAlternatives(DECISION_ID, undefined, emptyParsed({ listItemsBySection: { alternatives: ["[rejected] From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
    expect(result[0].state).toBe("rejected");
  });

  it("falls back to the labeled list when frontmatter.alternatives is not an array", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: "not an array" },
      emptyParsed({ listItemsBySection: { alternatives: ["[rejected] From list."] } }),
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });

  it("falls back to the labeled list when the frontmatter array is present but empty", () => {
    const result = extractAlternatives(DECISION_ID, { alternatives: [] }, emptyParsed({ listItemsBySection: { alternatives: ["deferred: From list."] } }), []);
    expect(result).toHaveLength(1);
    expect(result[0].statement).toBe("From list.");
  });
});

describe("extractAlternatives: never sentiment/prose inference", () => {
  it("does not extract anything from an 'Alternatives' section's prose body when there is no recognized list or frontmatter", () => {
    const parsed = emptyParsed({
      sections: {
        alternatives: "We also thought about a managed queue but ultimately preferred rolling our own.",
      },
      // No listItemsBySection entry: this is prose, not a bulleted list.
    });
    const result = extractAlternatives(DECISION_ID, undefined, parsed, []);
    expect(result).toEqual([]);
  });

  it("does not extract anything when both frontmatter and the labeled list are absent", () => {
    const result = extractAlternatives(DECISION_ID, undefined, emptyParsed(), []);
    expect(result).toEqual([]);
  });

  it("does not infer 'rejected' from wording like 'we decided against this' in an unlabeled list item", () => {
    const result = extractAlternatives(
      DECISION_ID,
      undefined,
      emptyParsed({ listItemsBySection: { alternatives: ["We decided against this because it was too slow."] } }),
      [],
    );
    expect(result[0].state).toBe("unknown");
    expect(result[0].statement).toBe("We decided against this because it was too slow.");
  });
});

describe("extractAlternatives: never ranked", () => {
  it("produces no ordinal/priority/rank field on any alternative", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "First option.", state: "selected" }, { statement: "Second option.", state: "rejected" }] },
      emptyParsed(),
      [],
    );
    for (const alternative of result) {
      expect(Object.keys(alternative).sort()).toEqual(["decision_id", "evidence_refs", "id", "state", "statement"]);
    }
  });

  it("preserves declared document order regardless of state -- a 'rejected' alternative listed first stays first", () => {
    const result = extractAlternatives(
      DECISION_ID,
      {
        alternatives: [
          { statement: "Listed first, but rejected.", state: "rejected" },
          { statement: "Listed second, but selected.", state: "selected" },
        ],
      },
      emptyParsed(),
      [],
    );
    expect(result.map((a) => a.statement)).toEqual(["Listed first, but rejected.", "Listed second, but selected."]);
  });

  it("does not reorder or prioritize a 'selected' alternative to the front of the labeled list", () => {
    const result = extractAlternatives(
      DECISION_ID,
      undefined,
      emptyParsed({
        listItemsBySection: {
          alternatives: ["[deferred] Deferred option.", "[considered] Considered option.", "[selected] Selected option, listed last."],
        },
      }),
      [],
    );
    expect(result.map((a) => a.state)).toEqual(["deferred", "considered", "selected"]);
  });
});

describe("extractAlternatives: id derivation and evidence passthrough", () => {
  it("derives id via buildAlternativeId(decisionId, '<index>.<statement>')", () => {
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "First.", state: "considered" }, { statement: "Second.", state: "rejected" }] },
      emptyParsed(),
      [],
    );
    expect(result[0].id).toBe(buildAlternativeId(DECISION_ID, "0.First."));
    expect(result[1].id).toBe(buildAlternativeId(DECISION_ID, "1.Second."));
  });

  it("attaches the caller-supplied evidence_refs verbatim to every produced alternative", () => {
    const refs = [evidenceRef({ path: "docs/adr/0001.md" })];
    const result = extractAlternatives(
      DECISION_ID,
      { alternatives: [{ statement: "a", state: "considered" }, { statement: "b", state: "rejected" }] },
      emptyParsed(),
      refs,
    );
    expect(result[0].evidence_refs).toBe(refs);
    expect(result[1].evidence_refs).toBe(refs);
  });
});
