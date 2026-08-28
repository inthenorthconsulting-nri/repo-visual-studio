import { describe, expect, it } from "vitest";
import {
  deriveSelectionSignals,
  selectGrammarFromSignals,
  selectVisualGrammar,
  selectionReasonCodes,
} from "../grammar-selection.js";
import { digestOf } from "../ids.js";
import { INTENT_GRAMMAR_COMPATIBILITY, SEMANTIC_INTENTS } from "../vocabulary.js";
import { chain, edge, model, node, shuffleModel } from "./fixtures.js";

const base = { audience: "engineering", detail_mode: "faithful", format: "slide" } as const;

describe("grammar selection is deterministic", () => {
  it("returns an identical result across five runs", () => {
    const m = chain(12);
    const runs = Array.from({ length: 5 }, () =>
      digestOf(selectVisualGrammar({ intent: "dependency", model: m, ...base })),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("is unaffected by the order of the caller's arrays", () => {
    // Input order is not evidence. If a shuffled node array could change the
    // chosen grammar, two runs over the same repository would disagree about
    // what the diagram is.
    const m = chain(12);
    const canonical = digestOf(selectVisualGrammar({ intent: "dependency", model: m, ...base }));
    for (let seed = 1; seed <= 8; seed++) {
      const shuffled = shuffleModel(m, seed);
      expect(digestOf(selectVisualGrammar({ intent: "dependency", model: shuffled, ...base }))).toBe(canonical);
    }
  });

  it("replays from its own recorded signals", () => {
    // The property validation.ts depends on to be able to raise
    // VISUAL_NONDETERMINISTIC_SELECTION at all.
    for (const intent of SEMANTIC_INTENTS) {
      const selection = selectVisualGrammar({ intent, model: chain(6), ...base });
      expect(digestOf(selectGrammarFromSignals(selection.signals))).toBe(digestOf(selection));
    }
  });
});

describe("grammar selection stays inside the intent's compatibility list", () => {
  it("never selects an incompatible grammar for any intent", () => {
    for (const intent of SEMANTIC_INTENTS) {
      for (const m of [model(), chain(3), chain(40)]) {
        const selection = selectVisualGrammar({ intent, model: m, ...base });
        expect(INTENT_GRAMMAR_COMPATIBILITY[intent]).toContain(selection.grammar);
        for (const alternative of selection.alternatives) {
          expect(INTENT_GRAMMAR_COMPATIBILITY[intent]).toContain(alternative);
        }
      }
    }
  });

  it("offers every other compatible grammar as an alternative, without repeating the winner", () => {
    for (const intent of SEMANTIC_INTENTS) {
      const selection = selectVisualGrammar({ intent, model: chain(5), ...base });
      expect(selection.alternatives).not.toContain(selection.grammar);
      expect(new Set(selection.alternatives).size).toBe(selection.alternatives.length);
      expect(selection.alternatives.length).toBe(INTENT_GRAMMAR_COMPATIBILITY[intent].length - 1);
    }
  });

  it("emits only published reason codes, and says so when nothing distinguished the evidence", () => {
    const codes = new Set(selectionReasonCodes());
    for (const intent of SEMANTIC_INTENTS) {
      const selection = selectVisualGrammar({ intent, model: model(), ...base });
      expect(codes.has(selection.reason_code)).toBe(true);
      // An empty model carries no distinguishing signal at all; the honest
      // answer is the documented default, not a confident-sounding rule.
      expect(selection.reason_code).toBe("VISUAL_GRAMMAR_INTENT_DEFAULT");
    }
  });
});

describe("grammar selection reads evidence, not names", () => {
  it("chooses delta when upstream supplied change facts", () => {
    const m = model({
      nodes: [node("a"), node("b")],
      changes: [{ id: "c1", kind: "added", subject_id: "b", subject_type: "node", detail: "", evidence_refs: [] }],
    });
    expect(selectVisualGrammar({ intent: "change", model: m, ...base }).grammar).toBe("delta");
  });

  it("chooses a dependency graph rather than a tree once a cycle exists", () => {
    const acyclic = model({ nodes: [node("a"), node("b")], edges: [edge("a", "b")] });
    const cyclic = model({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b", { in_cycle: true }), edge("b", "a", { in_cycle: true })],
      has_cycles: true,
    });
    expect(selectVisualGrammar({ intent: "dependency", model: acyclic, ...base }).grammar).toBe("tree");
    expect(selectVisualGrammar({ intent: "dependency", model: cyclic, ...base }).grammar).toBe("dependency_graph");
  });

  it("claims a fishbone on evidence only when an upstream analysis established cause groups", () => {
    // A fishbone is root_cause's documented default form, so the grammar is
    // the same either way. What must differ is the *reason*: without cause
    // groups the honest answer is "the intent's default", not "the evidence
    // showed converging causes".
    const m = model({ nodes: [node("effect"), node("c1"), node("c2")] });
    const unsupported = selectVisualGrammar({ intent: "root_cause", model: m, ...base });
    const supported = selectVisualGrammar({ intent: "root_cause", model: m, cause_group_count: 3, ...base });
    expect(unsupported.reason_code).toBe("VISUAL_GRAMMAR_INTENT_DEFAULT");
    expect(supported.grammar).toBe("fishbone");
    expect(supported.reason_code).not.toBe("VISUAL_GRAMMAR_INTENT_DEFAULT");
    expect(supported.signals.cause_group_count).toBe(3);
  });

  it("does not infer a cycle the upstream graph never found", () => {
    // has_cycles is copied from the model, never recomputed here: this layer
    // is not entitled to discover a relationship the Knowledge Graph didn't.
    const m = model({
      nodes: [node("a"), node("b")],
      edges: [edge("a", "b"), edge("b", "a", { id: "b->a" })],
      has_cycles: false,
    });
    expect(deriveSelectionSignals({ intent: "dependency", model: m, ...base }).has_cycles).toBe(false);
  });

  it("ignores labels entirely", () => {
    const plain = model({ nodes: [node("a"), node("b")], edges: [edge("a", "b")] });
    const suggestive = model({
      nodes: [node("a", { label: "Timeline of decisions" }), node("b", { label: "Root cause: outage" })],
      edges: [edge("a", "b")],
    });
    expect(selectVisualGrammar({ intent: "dependency", model: plain, ...base }).grammar).toBe(
      selectVisualGrammar({ intent: "dependency", model: suggestive, ...base }).grammar,
    );
  });
});
