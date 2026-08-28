import { describe, expect, it } from "vitest";
import { buildReviewAssembly } from "../source.js";
import { causalChain, componentRemoved, node, snapshot, unknownConsumer } from "./fixtures.js";

// §39's causal-review regression: the chain a reviewer actually needs.
//
// A component is removed. The capability it carried regresses. A decision
// assumption is contradicted. A governance finding is raised. Every link in
// that chain was established by an upstream layer, and the review has to
// reproduce all four and connect them to one change -- without inventing a
// fifth link from the fact that two of the entities sit next to each other.

describe("causal review", () => {
  const assembly = buildReviewAssembly(causalChain());
  const removal = assembly.changes.find((c) => c.entity_id === "billing" && c.change_type === "removed");

  it("reproduces the whole chain against one change", () => {
    expect(removal).toBeDefined();
    expect(removal?.capability_ids).toEqual(["cap-invoicing"]);
    expect(removal?.governance_finding_ids).toEqual(["gf-chain"]);
    expect(removal?.decision_ids).toEqual(["adr-0007"]);
    expect(removal?.review_required).toBe(true);
  });

  it("records the capability regression as a change of its own, from the runtime loss upstream recorded", () => {
    const regressed = assembly.changes.filter((c) => c.change_type === "regressed");
    expect(regressed).toHaveLength(1);
    expect(regressed[0].entity_id).toBe("cap-invoicing");
  });

  it("draws the confirmed route upstream emitted, and attributes it to the artifact it came from", () => {
    const confirmed = assembly.confirmed_paths.filter((p) => p.kind === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed[0].entity_ids).toEqual(["billing", "store"]);
    expect(confirmed[0].upstream_artifact_id).toBe("impact-results.json");
    expect(confirmed[0].description).toContain("impact-results.json");
  });

  it("does not infer causality from adjacency", () => {
    // "api" and "orders" are adjacent to the changed entity in the graph and
    // upstream emitted no route to either. Neither may appear as the far end
    // of a confirmed path.
    const reached = assembly.confirmed_paths.filter((p) => p.kind === "confirmed").map((p) => p.to_entity_id);
    expect(reached).not.toContain("api");
    expect(reached).not.toContain("orders");
  });

  it("labels a shared-evidence relation as related rather than promoting it to a cause", () => {
    // Two changed entities citing one file. That is a reason to look.
    const shared = [{ path: "src/shared.ts", lines: "1-10" }];
    const nodes = [
      node("left", { evidence_refs: shared }),
      node("right", { evidence_refs: shared }),
    ];
    const built = buildReviewAssembly({
      before: snapshot("snap-a", nodes, []),
      after: snapshot("snap-b", nodes, []),
      compatibility: { status: "compatible", reasons: [] },
      graph_changes: { entity_types_changed: ["left", "right"] },
    });
    const related = built.confirmed_paths.filter((p) => p.kind === "related");
    expect(related.length).toBeGreaterThan(0);
    expect(related[0].description).toContain("reason to look rather than an established cause");
    expect(built.confirmed_paths.filter((p) => p.kind === "confirmed")).toHaveLength(0);
  });

  it("labels an unresolved relation as unresolved, and keeps it", () => {
    const built = buildReviewAssembly(unknownConsumer());
    const unresolved = built.confirmed_paths.filter((p) => p.kind === "unresolved");
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved[0].description).toContain("not determined");
  });

  it("separates the three route kinds rather than blurring them into one", () => {
    const kinds = new Set(assembly.confirmed_paths.map((p) => p.kind));
    for (const kind of kinds) expect(["confirmed", "related", "unresolved"]).toContain(kind);
  });

  it("finds no route at all where upstream emitted none", () => {
    const bare = buildReviewAssembly(componentRemoved());
    expect(bare.confirmed_paths).toEqual([]);
    // ...and says so as an open question rather than as a clean bill of health.
    expect(bare.unresolved_impacts.length).toBeGreaterThan(0);
  });
});
