import { describe, it, expect } from "vitest";
import { buildKnowledgeGraphNarrative, containsForbiddenPhrasing, type BuildKnowledgeGraphNarrativeInput } from "../narrative.js";
import { buildNarrativeId } from "../ids.js";
import { buildGraphSnapshot } from "../snapshot.js";
import { GENERATED_AT, allPresentUpstreamArtifacts, linearChainFixture, REPOSITORY_ID } from "./graph-fixtures.js";

const EXPECTED_SECTION_HEADINGS = [
  "Headline",
  "Graph inventory",
  "Relationship landscape",
  "Critical dependency paths",
  "Component/capability impact",
  "Product and portfolio reach",
  "Governance root causes",
  "Decision dependencies",
  "Invalidated assumptions",
  "Orphans and unresolved references",
  "Graph changes",
  "Human review required",
  "Validation and limitations",
];

function baseInput(overrides: Partial<BuildKnowledgeGraphNarrativeInput> = {}): BuildKnowledgeGraphNarrativeInput {
  const { nodes, edges } = linearChainFixture();
  const snapshot = buildGraphSnapshot({ repositoryId: REPOSITORY_ID, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
  return { snapshot, nodes, edges, generatedAt: GENERATED_AT, ...overrides };
}

describe("containsForbiddenPhrasing", () => {
  it("returns matched phrases, case-insensitively", () => {
    expect(containsForbiddenPhrasing("This change is Guaranteed to work.")).toEqual(["guaranteed"]);
    expect(containsForbiddenPhrasing("Everything is fine.")).toEqual([]);
  });

  it("can return multiple matches", () => {
    const hits = containsForbiddenPhrasing("no risk and no impact here, definitely safe");
    expect(hits).toEqual(["no risk", "no impact", "definitely safe"]);
  });
});

describe("buildKnowledgeGraphNarrative", () => {
  it("produces exactly the 13 fixed sections in order", () => {
    const narrative = buildKnowledgeGraphNarrative(baseInput());
    expect(narrative.sections.map((s) => s.heading)).toEqual(EXPECTED_SECTION_HEADINGS);
  });

  it("assembles id/generated_at/source_snapshot_id from the snapshot and caller-supplied timestamp", () => {
    const input = baseInput();
    const narrative = buildKnowledgeGraphNarrative(input);
    expect(narrative.id).toBe(buildNarrativeId(input.snapshot.id));
    expect(narrative.generated_at).toBe(GENERATED_AT);
    expect(narrative.source_snapshot_id).toBe(input.snapshot.id);
    expect(narrative.target_snapshot_id).toBeUndefined();
  });

  it("sets target_snapshot_id from changeSet.target_snapshot_id when a changeSet is supplied", () => {
    const changeSet = {
      id: "graph:changeset:a:b",
      schema_version: 1,
      source_snapshot_id: "graph:snapshot:a",
      target_snapshot_id: "graph:snapshot:b",
      nodes_added: [],
      nodes_removed: [],
      edges_added: [],
      edges_removed: [],
      entity_types_changed: [],
      relationships_changed: [],
      dependency_paths_changed: [],
      impact_radius_increased: [],
      impact_radius_decreased: [],
      new_orphans: [],
      new_cycles: [],
      root_causes_introduced: [],
      root_causes_resolved: [],
      decision_dependencies_changed: [],
      governance_reach_changed: [],
    };
    const narrative = buildKnowledgeGraphNarrative(baseInput({ changeSet }));
    expect(narrative.target_snapshot_id).toBe("graph:snapshot:b");
    const headline = narrative.sections.find((s) => s.heading === "Headline")?.body ?? "";
    expect(headline).toContain(changeSet.source_snapshot_id);
  });

  it("reports empty-state placeholder text for every optional collection when omitted", () => {
    const narrative = buildKnowledgeGraphNarrative(baseInput());
    const body = (heading: string) => narrative.sections.find((s) => s.heading === heading)?.body ?? "";
    expect(body("Critical dependency paths")).toContain("Impact queries have not been run yet");
    expect(body("Governance root causes")).toContain("No root-cause groups have been computed");
    expect(body("Decision dependencies")).toContain("No decision-impact queries have been run yet");
    expect(body("Invalidated assumptions")).toContain("No decision-impact query has classified");
    expect(body("Graph changes")).toContain("No comparison target was provided");
    expect(body("Human review required")).toContain("No decision-impact, root-cause, or change-plan query currently flags");
  });

  it("throws when a generated section would contain forbidden phrasing (self-check catches it before returning)", () => {
    const { nodes, edges } = linearChainFixture();
    const badRepositoryId = "no risk repository";
    const snapshot = buildGraphSnapshot({ repositoryId: badRepositoryId, upstreamArtifacts: allPresentUpstreamArtifacts(), nodes, edges });
    expect(() => buildKnowledgeGraphNarrative(baseInput({ snapshot }))).toThrowError(/forbidden phrasing/);
  });

  it("is deterministic across repeated calls with identical input", () => {
    const input = baseInput();
    const first = buildKnowledgeGraphNarrative(input);
    const second = buildKnowledgeGraphNarrative(input);
    expect(first).toEqual(second);
  });
});
