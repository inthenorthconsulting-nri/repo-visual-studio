import { describe, expect, it } from "vitest";
import type { ProductIdentityCandidate } from "../contracts.js";
import { pickWinningCandidate, rankSecondaryCandidates } from "../ranking.js";

function candidate(overrides: Partial<ProductIdentityCandidate> = {}): ProductIdentityCandidate {
  return {
    id: `prodintel:candidate:${overrides.archetype ?? "governance_platform"}`,
    displayName: "Widget Platform",
    archetype: "governance_platform",
    purpose: "Governance and compliance platform",
    primaryUsers: [],
    valuePillars: [],
    differentiators: [],
    evidence: [],
    confidence: "confirmed",
    score: 1,
    ...overrides,
  };
}

describe("pickWinningCandidate", () => {
  it("finds the candidate whose archetype matches the given primary archetype", () => {
    const candidates = [candidate({ archetype: "developer_tool" }), candidate({ archetype: "governance_platform" })];
    const winner = pickWinningCandidate(candidates, "governance_platform");
    expect(winner?.archetype).toBe("governance_platform");
  });

  it("returns undefined when no candidate matches the primary archetype (e.g. 'unknown' never has a scored candidate)", () => {
    const candidates = [candidate({ archetype: "developer_tool" })];
    expect(pickWinningCandidate(candidates, "unknown")).toBeUndefined();
  });

  it("never re-classifies — it does not select a higher-scoring candidate over an exact archetype match", () => {
    const candidates = [candidate({ archetype: "developer_tool", score: 100 }), candidate({ archetype: "governance_platform", score: 1 })];
    const winner = pickWinningCandidate(candidates, "governance_platform");
    expect(winner?.score).toBe(1);
  });
});

describe("rankSecondaryCandidates", () => {
  it("excludes the primary archetype's own candidate even if it is also listed among secondaryArchetypes", () => {
    const candidates = [candidate({ archetype: "governance_platform", score: 5 }), candidate({ archetype: "developer_tool", score: 2 })];
    const result = rankSecondaryCandidates(candidates, "governance_platform", ["governance_platform", "developer_tool"]);
    expect(result.map((c) => c.archetype)).toEqual(["developer_tool"]);
  });

  it("only includes candidates whose archetype is listed in secondaryArchetypes", () => {
    const candidates = [candidate({ archetype: "governance_platform" }), candidate({ archetype: "developer_tool" }), candidate({ archetype: "observability_platform" })];
    const result = rankSecondaryCandidates(candidates, "governance_platform", ["developer_tool"]);
    expect(result.map((c) => c.archetype)).toEqual(["developer_tool"]);
  });

  it("sorts by score descending, then id ascending on a tie", () => {
    const candidates = [
      candidate({ archetype: "developer_tool", score: 1 }),
      candidate({ archetype: "observability_platform", score: 3 }),
      candidate({ archetype: "automation_platform", score: 1 }),
    ];
    const result = rankSecondaryCandidates(candidates, "governance_platform", ["developer_tool", "observability_platform", "automation_platform"]);
    expect(result.map((c) => c.archetype)).toEqual(["observability_platform", "automation_platform", "developer_tool"]);
  });

  it("returns an empty array when secondaryArchetypes is empty", () => {
    const candidates = [candidate({ archetype: "developer_tool" })];
    expect(rankSecondaryCandidates(candidates, "governance_platform", [])).toEqual([]);
  });
});
