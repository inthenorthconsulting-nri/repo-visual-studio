import { describe, expect, it } from "vitest";
import { buildReviewAssembly } from "../source.js";
import { REVIEW_CHANGE_TYPES, UNRESOLVED_IMPACT_STATEMENTS } from "../contracts.js";
import {
  blockingFinding,
  capabilityRegression,
  causalChain,
  componentAdded,
  componentRemoved,
  decisionAssumptionContradicted,
  decisionImplementationDrift,
  dependencyRerouted,
  everythingChanged,
  FIXTURES,
  largeDelta,
  noChange,
  reordered,
  resolvedFinding,
  reviewRequiredFinding,
  unknownConsumer,
} from "./fixtures.js";

const typesIn = (input: Parameters<typeof buildReviewAssembly>[0]) =>
  new Set(buildReviewAssembly(input).changes.map((c) => c.change_type));

describe("change semantics", () => {
  it("reports no change when the comparison found none", () => {
    const assembly = buildReviewAssembly(noChange());
    expect(assembly.changes).toEqual([]);
    // And says so about a *comparison*, not about the architecture: both
    // snapshots are still fully represented.
    expect(assembly.before_entity_ids).toEqual(["api", "billing", "orders", "store"]);
    expect(assembly.after_entity_ids).toEqual(assembly.before_entity_ids);
  });

  it("represents an added component as added, with no invented before counterpart", () => {
    const assembly = buildReviewAssembly(componentAdded());
    const change = assembly.changes.find((c) => c.entity_id === "shipping");
    expect(change?.change_type).toBe("added");
    expect(change?.before_entity_id).toBeUndefined();
    expect(change?.after_entity_id).toBe("shipping");
  });

  it("represents a removed component as removed, and does not soften it to deprecated", () => {
    const assembly = buildReviewAssembly(componentRemoved());
    const change = assembly.changes.find((c) => c.entity_id === "billing");
    expect(change?.change_type).toBe("removed");
    expect(change?.before_entity_id).toBe("billing");
    expect(change?.after_entity_id).toBeUndefined();
    expect(assembly.changes.map((c) => c.change_type)).not.toContain("deprecated");
  });

  it("anchors a rerouted dependency on its origin entity rather than on the path key", () => {
    const assembly = buildReviewAssembly(dependencyRerouted());
    const rerouted = assembly.changes.filter((c) => c.change_type === "rerouted");
    expect(rerouted).toHaveLength(1);
    // The change is about "orders", an entity that exists, so it can be drawn
    // and selected. Anchoring it on "orders->store" would leave it dangling.
    expect(rerouted[0].entity_id).toBe("orders");
    expect(rerouted[0].summary).toContain("store");
  });

  it("calls a change regressed only where upstream recorded reduced or lost runtime", () => {
    expect(typesIn(capabilityRegression())).toContain("regressed");
    // The same entity, same change, without the runtime classification: a
    // modification, because nobody upstream said anything was lost.
    const without = capabilityRegression();
    expect(
      typesIn({
        ...without,
        governance_changes: without.governance_changes?.map((c) => ({ ...c, classification: undefined })),
      }),
    ).toEqual(new Set(["modified"]));
  });

  it("carries capability and product links through without inventing any", () => {
    const change = buildReviewAssembly(capabilityRegression()).changes.find((c) => c.entity_id === "orders");
    expect(change?.capability_ids).toEqual(["cap-order-placement"]);
    expect(change?.product_ids).toEqual(["prod-commerce"]);
    // An entity nobody linked gets an empty list, not a guessed one.
    const unlinked = buildReviewAssembly(componentAdded()).changes.find((c) => c.entity_id === "shipping");
    expect(unlinked?.capability_ids).toEqual([]);
  });

  it("marks a change carrying a blocking finding as review-required", () => {
    const assembly = buildReviewAssembly(blockingFinding());
    const change = assembly.changes.find((c) => c.entity_id === "billing");
    expect(change?.review_required).toBe(true);
    expect(change?.governance_finding_ids).toEqual(["gf-blocking"]);
    expect(assembly.review_required_ids).toContain(change?.id);
    expect(assembly.governance_findings[0].severity).toBe("blocking");
  });

  it("marks a change carrying a review-required finding as review-required", () => {
    const change = buildReviewAssembly(reviewRequiredFinding()).changes.find((c) => c.entity_id === "billing");
    expect(change?.review_required).toBe(true);
  });

  it("attaches a contradicted decision assumption to the entity it is about", () => {
    const assembly = buildReviewAssembly(decisionAssumptionContradicted());
    const change = assembly.changes.find((c) => c.entity_id === "billing");
    expect(change?.decision_ids).toEqual(["adr-0007"]);
    expect(assembly.decision_impacts[0].state).toBe("assumption_contradicted");
    // Reported as recorded. Nothing here approves, rejects, or judges it.
    expect(assembly.decision_impacts[0].detail).toContain("ADR-0007");
  });

  it("attaches decision implementation drift the same way", () => {
    const assembly = buildReviewAssembly(decisionImplementationDrift());
    expect(assembly.decision_impacts[0].state).toBe("implementation_invalidated");
    expect(assembly.changes.some((c) => c.decision_ids.includes("adr-0011"))).toBe(true);
  });

  it("sources `resolved` only from a finding upstream marked resolved", () => {
    const assembly = buildReviewAssembly(resolvedFinding());
    expect(assembly.changes.map((c) => c.change_type)).toEqual(["resolved"]);
    expect(assembly.governance_findings[0].resolved).toBe(true);
    // A resolved finding does not make the change review-required.
    expect(assembly.review_required_ids).toEqual([]);
  });

  it("uses only the eight declared change types, and no visual-only synonym", () => {
    for (const [name, build] of FIXTURES) {
      for (const type of typesIn(build())) {
        expect(REVIEW_CHANGE_TYPES, `${name} produced an undeclared change type`).toContain(type);
      }
    }
  });
});

describe("unknown impact", () => {
  it("says reach is unresolved rather than saying there is none", () => {
    const assembly = buildReviewAssembly(unknownConsumer());
    const statements = assembly.unresolved_impacts.map((u) => u.statement);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements).toContain(UNRESOLVED_IMPACT_STATEMENTS.reach_unresolved);
    for (const statement of statements) {
      expect(statement).not.toMatch(/no downstream impact|safe change|no consumers/i);
    }
  });

  it("phrases an empty result as a statement about the evidence analyzed", () => {
    // Upstream measured this change's reach as cross-component and recorded
    // no path. That is "nothing was found", not "nothing is there", and the
    // wording has to be the first of those.
    const assembly = buildReviewAssembly(blockingFinding());
    expect(assembly.unresolved_impacts.map((u) => u.statement)).toContain(
      UNRESOLVED_IMPACT_STATEMENTS.no_confirmed_consumers,
    );
  });

  it("defaults to unresolved reach when nobody measured it", () => {
    // No finding carries a blast radius here, so reach was never established.
    // Saying "no confirmed consumers were found" would imply somebody looked.
    const assembly = buildReviewAssembly(componentRemoved());
    expect(assembly.unresolved_impacts.map((u) => u.statement)).toContain(
      UNRESOLVED_IMPACT_STATEMENTS.reach_unresolved,
    );
  });
});

describe("determinism", () => {
  it("produces an identical assembly from reordered inputs", () => {
    const straight = buildReviewAssembly(causalChain());
    const shuffled = buildReviewAssembly(reordered(causalChain()));
    expect(shuffled.input_digest).toBe(straight.input_digest);
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(straight));
  });

  it("produces an identical assembly on five consecutive builds", () => {
    for (const [name, build] of FIXTURES) {
      const runs = Array.from({ length: 5 }, () => JSON.stringify(buildReviewAssembly(build())));
      expect(new Set(runs).size, `${name} was not deterministic across five builds`).toBe(1);
    }
  });

  it("sorts every list it returns", () => {
    for (const [name, build] of FIXTURES) {
      const assembly = buildReviewAssembly(build());
      const sorted = <T>(items: readonly T[], key: (item: T) => string) =>
        items.map(key).every((value, i, all) => i === 0 || all[i - 1] <= value);
      expect(sorted(assembly.changes, (c) => c.id), `${name}: changes`).toBe(true);
      expect(sorted(assembly.confirmed_paths, (p) => p.id), `${name}: paths`).toBe(true);
      expect(sorted(assembly.unresolved_impacts, (u) => u.id), `${name}: unresolved`).toBe(true);
      expect(sorted(assembly.governance_findings, (f) => f.id), `${name}: findings`).toBe(true);
    }
  });
});

describe("the union model", () => {
  it("draws every entity from both snapshots exactly once", () => {
    const assembly = buildReviewAssembly(componentRemoved());
    const ids = assembly.visual.nodes.map((n) => n.source_entity_id);
    expect(new Set(ids).size).toBe(ids.length);
    // "billing" exists only in the baseline and is still drawn -- the review
    // cannot show what was removed if the removed thing is not in the model.
    expect(ids).toContain("billing");
  });

  it("emphasises changed entities without hiding unchanged ones", () => {
    const assembly = buildReviewAssembly(componentRemoved());
    const billing = assembly.visual.nodes.find((n) => n.source_entity_id === "billing");
    const api = assembly.visual.nodes.find((n) => n.source_entity_id === "api");
    expect(billing?.emphasis).toBe("primary");
    expect(api?.emphasis).toBe("normal");
  });

  it("carries change facts into the visual model, which is what selects the delta grammar", () => {
    const assembly = buildReviewAssembly(largeDelta());
    expect(assembly.visual.changes.length).toBeGreaterThan(0);
    expect(assembly.visual.changes.every((c) => c.kind !== undefined)).toBe(true);
  });

  it("keeps every entity when nothing at all changed", () => {
    const assembly = buildReviewAssembly(everythingChanged());
    expect(assembly.visual.nodes).toHaveLength(20);
    expect(assembly.visual.changes).toHaveLength(20);
  });
});
