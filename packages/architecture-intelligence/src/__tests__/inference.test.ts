import { describe, expect, it } from "vitest";
import { confirmed, derived, isPresentableAsFact, qualifierFor, suggested, summarizeConfidence, unresolved } from "../inference.js";

describe("inference helpers", () => {
  it("tags each constructor with the correct inference class", () => {
    expect(confirmed("x", []).inference).toBe("confirmed");
    expect(derived("x", [], "why").inference).toBe("derived");
    expect(suggested("x", [], "why").inference).toBe("suggested");
    expect(unresolved("x", "why").inference).toBe("unresolved");
  });

  it("unresolved statements carry no evidence", () => {
    expect(unresolved("x", "why").evidence).toEqual([]);
  });

  it("summarizes a mixed set of statements into counts", () => {
    const summary = summarizeConfidence([
      confirmed("a", []),
      confirmed("b", []),
      derived("c", [], "why"),
      suggested("d", [], "why"),
      unresolved("e", "why"),
    ]);
    expect(summary).toEqual({ confirmed: 2, derived: 1, suggested: 1, unresolved: 1, total: 5 });
  });

  it("only confirmed/derived are presentable as fact", () => {
    expect(isPresentableAsFact("confirmed")).toBe(true);
    expect(isPresentableAsFact("derived")).toBe(true);
    expect(isPresentableAsFact("suggested")).toBe(false);
    expect(isPresentableAsFact("unresolved")).toBe(false);
  });

  it("qualifies suggested/unresolved statements so they are never silently stated as fact", () => {
    expect(qualifierFor("suggested")).toBe("Likely");
    expect(qualifierFor("unresolved")).toBe("Unconfirmed");
    expect(qualifierFor("confirmed")).toBeUndefined();
  });
});
