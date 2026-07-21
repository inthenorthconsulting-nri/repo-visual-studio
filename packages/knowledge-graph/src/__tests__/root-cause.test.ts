import { describe, it, expect } from "vitest";
import { groupRootCauses } from "../root-cause.js";
import { buildRootCauseGroupId, digestOf } from "../ids.js";
import { rootCauseFixtureSet } from "./graph-fixtures.js";

describe("groupRootCauses", () => {
  it("classifies a pair of findings sharing exactly one causal ancestor as 'confirmed'", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingConfirmed1.id));
    expect(group).toBeDefined();
    expect(group?.classification).toBe("confirmed");
    expect(group?.finding_node_ids.sort()).toEqual([fixture.findingConfirmed1.id, fixture.findingConfirmed2.id].sort());
    expect(group?.candidate_root_node_ids).toEqual([fixture.confirmedConsumer.id]);
    expect(group?.id).toBe(buildRootCauseGroupId(fixture.confirmedConsumer.id));
  });

  it("classifies findings sharing more than one causal ancestor candidate as 'probable' (ambiguous)", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingProbable1.id));
    expect(group?.classification).toBe("probable");
    expect(group?.detail).toContain("ambiguous");
    expect(group?.candidate_root_node_ids.sort()).toEqual([fixture.probableConsumer1.id, fixture.probableConsumer2.id].sort());
  });

  it("classifies findings sharing one causal ancestor but with a non-resolved edge on the path as 'probable' (partial edge)", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingPartial1.id));
    expect(group?.classification).toBe("probable");
    expect(group?.detail).toContain("partial edge");
    expect(group?.candidate_root_node_ids).toEqual([fixture.partialConsumer.id]);
  });

  it("classifies findings reaching a shared ancestor only via non-causal edges as 'shared_dependency_only'", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingSharedDep1.id));
    expect(group?.classification).toBe("shared_dependency_only");
    expect(group?.candidate_root_node_ids).toEqual([fixture.sharedDepReferencer.id]);
  });

  it("classifies a finding whose anchor is itself unresolved as 'unresolved', in its own singleton group", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingUnresolved1.id));
    expect(group?.classification).toBe("unresolved");
    expect(group?.finding_node_ids).toEqual([fixture.findingUnresolved1.id]);
    expect(group?.candidate_root_node_ids).toEqual([]);
    expect(group?.id).toBe(buildRootCauseGroupId(`multi:${digestOf([fixture.findingUnresolved1.id])}`));
  });

  it("returns groups sorted by id", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("returns no groups for a graph with zero governance findings", () => {
    expect(groupRootCauses([], [])).toEqual([]);
  });

  it("deduplicates evidence_refs on the built group", () => {
    const fixture = rootCauseFixtureSet();
    const groups = groupRootCauses(fixture.nodes, fixture.edges);
    const group = groups.find((g) => g.finding_node_ids.includes(fixture.findingConfirmed1.id));
    expect(group?.evidence_refs).toEqual([]);
  });
});
