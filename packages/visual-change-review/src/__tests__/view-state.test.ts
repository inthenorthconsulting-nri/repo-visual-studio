import { describe, expect, it } from "vitest";
import { buildChangeReviewArtifact } from "../artifact.js";
import { buildReviewAssembly } from "../source.js";
import {
  DEFAULT_REVIEW_VIEW_STATE,
  decodeReviewViewState,
  encodeReviewViewState,
  type ReviewViewState,
} from "../view-state.js";
import { causalChain, componentRemoved } from "./fixtures.js";

// View state: what a shared link is allowed to carry.
//
// Two properties are tested here and both matter to a reviewer. The link
// round-trips, so pasting it into a pull request comment reopens the same
// view. And the link carries nothing but names the artifact already contains
// -- no path, no evidence text, nothing the page could fetch.

const model = buildChangeReviewArtifact({
  producer: "test",
  subject: "Test",
  assembly: buildReviewAssembly(causalChain()),
  audience: "engineering",
  detail_mode: "faithful",
}).model;

const aChange = model.changes[0]?.id as string;
const anEntity = model.after_entity_ids[0] as string;

describe("view state round trip", () => {
  it("returns the default state for an empty encoding", () => {
    const { state, rejected } = decodeReviewViewState("", model);
    expect(state).toEqual(DEFAULT_REVIEW_VIEW_STATE);
    expect(rejected).toEqual([]);
  });

  it("round-trips every field", () => {
    const original: ReviewViewState = {
      change: aChange,
      focus: anEntity,
      lens: "governance",
      panel: "after",
      query: "orders",
    };
    const { state, rejected } = decodeReviewViewState(encodeReviewViewState(original), model);
    expect(state).toEqual(original);
    expect(rejected).toEqual([]);
  });

  it("accepts the encoding with or without a leading hash", () => {
    const encoded = encodeReviewViewState({ ...DEFAULT_REVIEW_VIEW_STATE, lens: "impact" });
    expect(decodeReviewViewState(`#${encoded}`, model).state).toEqual(decodeReviewViewState(encoded, model).state);
  });

  it("encodes the same state the same way every time", () => {
    const state: ReviewViewState = { change: aChange, lens: "decisions", panel: "before", query: "" };
    const runs = new Set(Array.from({ length: 5 }, () => encodeReviewViewState(state)));
    expect(runs.size).toBe(1);
  });
});

describe("view state rejection", () => {
  it("reports a change the review no longer contains rather than silently defaulting", () => {
    const { state, rejected } = decodeReviewViewState("c=chg-that-was-removed", model);
    expect(state.change).toBeUndefined();
    expect(rejected).toEqual(['unknown change "chg-that-was-removed"']);
  });

  it("reports an unknown entity, lens, panel and field", () => {
    const { rejected } = decodeReviewViewState("f=ghost&l=vibes&p=middle&z=1", model);
    expect(rejected).toHaveLength(4);
    expect(rejected.join(" ")).toContain("unknown entity");
    expect(rejected.join(" ")).toContain("unknown lens");
    expect(rejected.join(" ")).toContain("unknown panel");
    expect(rejected.join(" ")).toContain("unknown field");
  });

  it("reports a malformed field", () => {
    expect(decodeReviewViewState("justtext", model).rejected[0]).toContain("malformed field");
  });

  it("reports an undecodable value instead of throwing", () => {
    const { rejected } = decodeReviewViewState("c=%E0%A4%A", model);
    expect(rejected).toEqual(['undecodable value for "c"']);
  });

  it("keeps a rejected value from becoming a place to hide a payload", () => {
    const { rejected } = decodeReviewViewState(`f=${encodeURIComponent("<img src=x onerror=alert(1)>")}`, model);
    expect(rejected.join(" ")).not.toContain("<");
    expect(rejected.join(" ")).not.toContain(">");
    expect(rejected.join(" ")).not.toContain("=");
  });

  it("truncates a very long rejected value", () => {
    const { rejected } = decodeReviewViewState(`f=${"a".repeat(400)}`, model);
    expect(rejected[0]?.length).toBeLessThan(80);
    expect(rejected[0]).toContain("...");
  });
});

describe("what a link is not allowed to carry", () => {
  const paths = [
    "/Users/someone/github/repo/packages/api/src/index.ts",
    "C:\\Users\\someone\\repo\\src\\index.ts",
    "../../etc/passwd",
    "file:///etc/passwd",
    "https://example.com/steal",
  ];

  it("never resolves a path-like focus, because focus is resolved against the model", () => {
    for (const path of paths) {
      const { state, rejected } = decodeReviewViewState(`f=${encodeURIComponent(path)}`, model);
      expect(state.focus, path).toBeUndefined();
      expect(rejected, path).toHaveLength(1);
    }
  });

  it("never resolves a path-like change id", () => {
    for (const path of paths) {
      expect(decodeReviewViewState(`c=${encodeURIComponent(path)}`, model).state.change, path).toBeUndefined();
    }
  });

  it("refuses a query that is not something a reader types at a search box", () => {
    for (const value of ["<script>", "a\u2028b", "\u0000", "x".repeat(200), "'; drop--"]) {
      const { state, rejected } = decodeReviewViewState(`q=${encodeURIComponent(value)}`, model);
      expect(state.query, value).toBe("");
      expect(rejected, value).toHaveLength(1);
    }
  });

  it("carries no evidence text, no absolute path and no local file reference when encoding a real state", () => {
    const review = buildChangeReviewArtifact({
      producer: "test",
      subject: "Test",
      assembly: buildReviewAssembly(componentRemoved()),
      audience: "engineering",
      detail_mode: "faithful",
    }).model;
    for (const change of review.changes) {
      const encoded = encodeReviewViewState({
        change: change.id,
        focus: change.entity_id,
        lens: "impact",
        panel: "delta",
        query: "",
      });
      expect(encoded).not.toMatch(/%2F|\/|\\/);
      expect(encoded).not.toContain(change.summary);
      expect(encoded.length).toBeLessThan(200);
    }
  });

  it("accepts only ids the review already contains, so state can name nothing new", () => {
    const known = new Set([...model.before_entity_ids, ...model.after_entity_ids]);
    const { state } = decodeReviewViewState(`f=${encodeURIComponent(anEntity)}`, model);
    expect(known.has(state.focus as string)).toBe(true);
  });
});
