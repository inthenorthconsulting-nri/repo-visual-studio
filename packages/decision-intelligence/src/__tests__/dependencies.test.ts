import { describe, expect, it } from "vitest";
import { buildDecisionDependencies, extractDeclaredDependencies, type DeclaredDependency } from "../dependencies.js";
import { buildDependencyCycleId, buildDependencyId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

describe("extractDeclaredDependencies: structured 'dependencies' array", () => {
  it("extracts valid { type, target } entries", () => {
    const result = extractDeclaredDependencies({ dependencies: [{ type: "depends_on", target: "decision:b" }] });
    expect(result).toEqual([{ type: "depends_on", target: "decision:b" }]);
  });

  it("drops entries with an unrecognized type", () => {
    const result = extractDeclaredDependencies({ dependencies: [{ type: "supersedes", target: "decision:b" }] });
    expect(result).toEqual([]);
  });

  it("drops entries with a missing, non-string, or blank target", () => {
    const result = extractDeclaredDependencies({
      dependencies: [{ type: "depends_on" }, { type: "depends_on", target: "   " }, { type: "depends_on", target: 5 }],
    });
    expect(result).toEqual([]);
  });

  it("drops non-object entries", () => {
    const result = extractDeclaredDependencies({ dependencies: ["decision:b", null, 5] });
    expect(result).toEqual([]);
  });

  it("trims the target", () => {
    const result = extractDeclaredDependencies({ dependencies: [{ type: "blocks", target: "  decision:b  " }] });
    expect(result).toEqual([{ type: "blocks", target: "decision:b" }]);
  });

  it("returns [] when frontmatter is undefined or 'dependencies' is not an array", () => {
    expect(extractDeclaredDependencies(undefined)).toEqual([]);
    expect(extractDeclaredDependencies({ dependencies: "decision:b" })).toEqual([]);
  });
});

describe("extractDeclaredDependencies: per-type keyed arrays", () => {
  const types = ["depends_on", "blocks", "requires", "is_required_by", "related_to", "conflicts_with"] as const;

  it.each(types)("extracts targets from a '%s' array", (type) => {
    const result = extractDeclaredDependencies({ [type]: ["decision:b", "decision:c"] });
    expect(result).toEqual([
      { type, target: "decision:b" },
      { type, target: "decision:c" },
    ]);
  });

  it("ignores non-string entries within a per-type array", () => {
    const result = extractDeclaredDependencies({ depends_on: ["decision:b", 5, null, "  "] });
    expect(result).toEqual([{ type: "depends_on", target: "decision:b" }]);
  });

  it("ignores a per-type key that is not an array", () => {
    const result = extractDeclaredDependencies({ depends_on: "decision:b" });
    expect(result).toEqual([]);
  });

  it("combines the structured array and per-type arrays when both are present", () => {
    const result = extractDeclaredDependencies({
      dependencies: [{ type: "requires", target: "decision:x" }],
      depends_on: ["decision:b"],
    });
    expect(result).toEqual([
      { type: "requires", target: "decision:x" },
      { type: "depends_on", target: "decision:b" },
    ]);
  });
});

function declaredMap(entries: Record<string, DeclaredDependency[]>): Map<string, DeclaredDependency[]> {
  return new Map(Object.entries(entries));
}

describe("buildDecisionDependencies: resolution against known decisions", () => {
  it("drops a declared dependency whose target does not resolve to a discovered decision", () => {
    const a = architectureDecision({ id: "decision:a" });
    const result = buildDecisionDependencies([a], declaredMap({ "decision:a": [{ type: "depends_on", target: "decision:ghost" }] }), new Map());
    expect(result.dependencies).toEqual([]);
  });

  it("keeps a declared dependency whose target resolves to a known decision", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const result = buildDecisionDependencies([a, b], declaredMap({ "decision:a": [{ type: "depends_on", target: "decision:b" }] }), new Map());
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]).toMatchObject({ from_decision_id: "decision:a", to_decision_id: "decision:b", dependency_type: "depends_on" });
  });

  it("derives id via buildDependencyId(from, type, to)", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const result = buildDecisionDependencies([a, b], declaredMap({ "decision:a": [{ type: "requires", target: "decision:b" }] }), new Map());
    expect(result.dependencies[0].id).toBe(buildDependencyId("decision:a", "requires", "decision:b"));
  });

  it("attaches evidence_refs from the 'from' decision's entry, defaulting to []", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const refs = [evidenceRef({ path: "docs/adr/a.md" })];
    const withRefs = buildDecisionDependencies(
      [a, b],
      declaredMap({ "decision:a": [{ type: "depends_on", target: "decision:b" }] }),
      new Map([["decision:a", refs]]),
    );
    expect(withRefs.dependencies[0].evidence_refs).toBe(refs);

    const withoutRefs = buildDecisionDependencies([a, b], declaredMap({ "decision:a": [{ type: "depends_on", target: "decision:b" }] }), new Map());
    expect(withoutRefs.dependencies[0].evidence_refs).toEqual([]);
  });

  it("sorts the returned dependencies by id", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const c = architectureDecision({ id: "decision:c" });
    const result = buildDecisionDependencies(
      [a, b, c],
      declaredMap({
        "decision:c": [{ type: "requires", target: "decision:a" }],
        "decision:a": [{ type: "blocks", target: "decision:b" }],
      }),
      new Map(),
    );
    const ids = result.dependencies.map((d) => d.id);
    expect(ids).toEqual([...ids].sort((x, y) => x.localeCompare(y)));
  });
});

describe("buildDecisionDependencies: informational-relationship cycle (allowed)", () => {
  it("classifies a 3-node cycle formed entirely of 'related_to' edges as 'informational_allowed'", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const c = architectureDecision({ id: "decision:c" });
    const refsA = [evidenceRef({ path: "a.md" })];
    const refsB = [evidenceRef({ path: "b.md" })];
    const refsC = [evidenceRef({ path: "c.md" })];

    const result = buildDecisionDependencies(
      [a, b, c],
      declaredMap({
        "decision:a": [{ type: "related_to", target: "decision:b" }],
        "decision:b": [{ type: "related_to", target: "decision:c" }],
        "decision:c": [{ type: "related_to", target: "decision:a" }],
      }),
      new Map([
        ["decision:a", refsA],
        ["decision:b", refsB],
        ["decision:c", refsC],
      ]),
    );

    expect(result.cycles).toHaveLength(1);
    const cycle = result.cycles[0];
    expect(cycle.classification).toBe("informational_allowed");
    expect(cycle.decision_ids).toEqual(["decision:a", "decision:b", "decision:c"]);
    expect(cycle.id).toBe(buildDependencyCycleId(["decision:a", "decision:b", "decision:c"]));
    expect(cycle.evidence_refs).toEqual([...refsA, ...refsB, ...refsC]);
  });
});

describe("buildDecisionDependencies: blocking-dependency cycle (flagged)", () => {
  it("classifies a 2-node cycle formed of 'depends_on' edges as 'blocking_flagged'", () => {
    const x = architectureDecision({ id: "decision:x" });
    const y = architectureDecision({ id: "decision:y" });
    const result = buildDecisionDependencies(
      [x, y],
      declaredMap({
        "decision:x": [{ type: "depends_on", target: "decision:y" }],
        "decision:y": [{ type: "depends_on", target: "decision:x" }],
      }),
      new Map(),
    );

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].classification).toBe("blocking_flagged");
    expect(result.cycles[0].decision_ids).toEqual(["decision:x", "decision:y"]);
    expect(result.cycles[0].id).toBe(buildDependencyCycleId(["decision:x", "decision:y"]));
  });

  it("groups all four blocking kinds (depends_on, blocks, requires, is_required_by) into the same classification", () => {
    const p = architectureDecision({ id: "decision:p" });
    const q = architectureDecision({ id: "decision:q" });
    const r = architectureDecision({ id: "decision:r" });
    const s = architectureDecision({ id: "decision:s" });
    const result = buildDecisionDependencies(
      [p, q, r, s],
      declaredMap({
        "decision:p": [{ type: "depends_on", target: "decision:q" }],
        "decision:q": [{ type: "blocks", target: "decision:r" }],
        "decision:r": [{ type: "requires", target: "decision:s" }],
        "decision:s": [{ type: "is_required_by", target: "decision:p" }],
      }),
      new Map(),
    );

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].classification).toBe("blocking_flagged");
    expect(result.cycles[0].decision_ids.sort()).toEqual(["decision:p", "decision:q", "decision:r", "decision:s"]);
  });
});

describe("buildDecisionDependencies: supersession cycles are never produced here", () => {
  it("does not detect any cycle formed only of 'conflicts_with' edges (neither informational nor blocking kind)", () => {
    const m = architectureDecision({ id: "decision:m" });
    const n = architectureDecision({ id: "decision:n" });
    const result = buildDecisionDependencies(
      [m, n],
      declaredMap({
        "decision:m": [{ type: "conflicts_with", target: "decision:n" }],
        "decision:n": [{ type: "conflicts_with", target: "decision:m" }],
      }),
      new Map(),
    );
    expect(result.cycles).toEqual([]);
  });

  it("never emits classification 'supersession_invalid', even across a graph with both informational and blocking cycles present simultaneously", () => {
    const a = architectureDecision({ id: "decision:a" });
    const b = architectureDecision({ id: "decision:b" });
    const c = architectureDecision({ id: "decision:c" });
    const x = architectureDecision({ id: "decision:x" });
    const y = architectureDecision({ id: "decision:y" });
    const result = buildDecisionDependencies(
      [a, b, c, x, y],
      declaredMap({
        "decision:a": [{ type: "related_to", target: "decision:b" }],
        "decision:b": [{ type: "related_to", target: "decision:c" }],
        "decision:c": [{ type: "related_to", target: "decision:a" }],
        "decision:x": [{ type: "depends_on", target: "decision:y" }],
        "decision:y": [{ type: "depends_on", target: "decision:x" }],
      }),
      new Map(),
    );

    expect(result.cycles).toHaveLength(2);
    expect(result.cycles.every((cycle) => cycle.classification !== "supersession_invalid")).toBe(true);
    expect(new Set(result.cycles.map((cycle) => cycle.classification))).toEqual(new Set(["informational_allowed", "blocking_flagged"]));
    const ids = result.cycles.map((c) => c.id);
    expect(ids).toEqual([...ids].sort((p, q) => p.localeCompare(q)));
  });
});
