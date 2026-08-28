import { describe, expect, it } from "vitest";
import {
  DETAIL_MODES,
  FORMAT_MOTION_COMPATIBILITY,
  INTENT_GRAMMAR_COMPATIBILITY,
  INTENT_MOTION_COMPATIBILITY,
  MOTION_INTENTS,
  SEMANTIC_INTENTS,
  VISUAL_AUDIENCES,
  VISUAL_FORMATS,
  VISUAL_GRAMMARS,
  grammarSupportsIntent,
  isDetailMode,
  isMotionIntent,
  isSemanticIntent,
  isVisualGrammar,
  motionSupportsFormat,
} from "../vocabulary.js";

describe("controlled vocabularies", () => {
  it("contain no duplicates", () => {
    for (const list of [SEMANTIC_INTENTS, VISUAL_GRAMMARS, DETAIL_MODES, MOTION_INTENTS, VISUAL_AUDIENCES, VISUAL_FORMATS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("reject values outside them", () => {
    expect(isSemanticIntent("microservices")).toBe(false);
    expect(isVisualGrammar("mermaid")).toBe(false);
    expect(isDetailMode("executive")).toBe(false);
  });

  it("never admit a renderer effect as a motion intent", () => {
    // Motion intent answers "what does the reader learn from the movement".
    // fade/slide/bounce/spring/rotate answer "what does it look like", which
    // is a renderer's business and must never reach this vocabulary.
    for (const effect of ["fade", "slide", "slide-left", "bounce", "spring", "rotate", "zoom", "pulse"]) {
      expect(isMotionIntent(effect)).toBe(false);
    }
  });
});

describe("intent/grammar compatibility", () => {
  it("covers every intent with at least one grammar", () => {
    for (const intent of SEMANTIC_INTENTS) {
      expect(INTENT_GRAMMAR_COMPATIBILITY[intent].length).toBeGreaterThan(0);
    }
  });

  it("references only published grammars", () => {
    for (const intent of SEMANTIC_INTENTS) {
      for (const grammar of INTENT_GRAMMAR_COMPATIBILITY[intent]) {
        expect(VISUAL_GRAMMARS).toContain(grammar);
      }
    }
  });

  it("leaves no grammar unreachable from every intent", () => {
    // An unreachable grammar is a form nothing can ever select: dead
    // vocabulary that still has to be maintained, documented, and rendered.
    const reachable = new Set(SEMANTIC_INTENTS.flatMap((i) => [...INTENT_GRAMMAR_COMPATIBILITY[i]]));
    expect([...VISUAL_GRAMMARS].filter((g) => !reachable.has(g))).toEqual([]);
  });

  it("lists no grammar twice for one intent", () => {
    for (const intent of SEMANTIC_INTENTS) {
      const list = INTENT_GRAMMAR_COMPATIBILITY[intent];
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("agrees with grammarSupportsIntent for every pair", () => {
    for (const intent of SEMANTIC_INTENTS) {
      for (const grammar of VISUAL_GRAMMARS) {
        expect(grammarSupportsIntent(intent, grammar)).toBe(
          INTENT_GRAMMAR_COMPATIBILITY[intent].includes(grammar),
        );
      }
    }
  });
});

describe("motion compatibility", () => {
  it("always allows static output for every intent and every format", () => {
    for (const intent of SEMANTIC_INTENTS) expect(INTENT_MOTION_COMPATIBILITY[intent]).toContain("none");
    for (const format of VISUAL_FORMATS) expect(FORMAT_MOTION_COMPATIBILITY[format]).toContain("none");
  });

  it("permits nothing but static output for paginated and exported formats", () => {
    // A PDF cannot animate. Declaring motion for one would mean the view's
    // meaning depends on something the reader can never see.
    expect([...FORMAT_MOTION_COMPATIBILITY.document]).toEqual(["none"]);
    expect([...FORMAT_MOTION_COMPATIBILITY.export]).toEqual(["none"]);
    for (const motion of MOTION_INTENTS) {
      if (motion === "none") continue;
      expect(motionSupportsFormat("document", motion)).toBe(false);
      expect(motionSupportsFormat("export", motion)).toBe(false);
    }
  });

  it("references only published motion intents", () => {
    for (const intent of SEMANTIC_INTENTS) {
      for (const motion of INTENT_MOTION_COMPATIBILITY[intent]) expect(MOTION_INTENTS).toContain(motion);
    }
    for (const format of VISUAL_FORMATS) {
      for (const motion of FORMAT_MOTION_COMPATIBILITY[format]) expect(MOTION_INTENTS).toContain(motion);
    }
  });
});
