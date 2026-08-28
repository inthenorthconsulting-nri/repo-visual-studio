import { describe, expect, it } from "vitest";
import { assessChangeAdvisoryFreshness, buildChangeAdvisoryCachePath, digestChangeAdvisory, toStoredChangeAdvisory } from "../persistence.js";
import { buildChangeAdvisory } from "../change-advisory.js";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { buildProposedChangeSetId } from "../ids.js";
import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, REPOSITORY_ID } from "./change-workbench-fixtures.js";
import { mutateExistingEntityRef } from "../refs.js";

const { nodes, edges } = baseFixtureGraph();

function buildFixtureAdvisory(baseSnapshotDigest: string) {
  const operations: ProposalOperation[] = [{ kind: "modify_attributes", ref: mutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }];
  const changeSet: ProposedChangeSet = { schema_version: 1, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
  return buildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest });
}

describe("persistence: buildChangeAdvisoryCachePath", () => {
  it("computes a path under CHANGE_WORKBENCH_ADVISORIES_DIR, never touching the filesystem", () => {
    const path = buildChangeAdvisoryCachePath(REPOSITORY_ID, "change-workbench:advisory:example:abc123");
    expect(path).toBe(".rvs/cache/change-workbench/advisories/fixture-repo/change-workbench-advisory-example-abc123.json");
  });

  it("is deterministic across repeated calls with the same input", () => {
    const a = buildChangeAdvisoryCachePath(REPOSITORY_ID, "advisory-1");
    const b = buildChangeAdvisoryCachePath(REPOSITORY_ID, "advisory-1");
    expect(a).toBe(b);
  });
});

describe("persistence: staleness semantics never auto-recompute or mutate a stored advisory", () => {
  it("reports 'current' when the stored digest matches the caller's freshly observed baseline", () => {
    const advisory = buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST);
    const stored = toStoredChangeAdvisory(advisory);
    expect(assessChangeAdvisoryFreshness(stored, BASE_SNAPSHOT_DIGEST)).toBe("current");
  });

  it("reports 'stale_equivalent' -- never silently 'current' -- when the baseline has moved at all", () => {
    const advisory = buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST);
    const stored = toStoredChangeAdvisory(advisory);
    expect(assessChangeAdvisoryFreshness(stored, "a-completely-different-snapshot-digest")).toBe("stale_equivalent");
  });

  it("toStoredChangeAdvisory never mutates the advisory it wraps", () => {
    const advisory = buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST);
    const before = JSON.stringify(advisory);
    toStoredChangeAdvisory(advisory);
    expect(JSON.stringify(advisory)).toBe(before);
  });
});

describe("persistence: digestChangeAdvisory is deterministic", () => {
  it("produces the same digest for two independently-built advisories of the identical proposal against the identical baseline", () => {
    const a = digestChangeAdvisory(buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST));
    const b = digestChangeAdvisory(buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST));
    expect(a).toBe(b);
  });

  it("produces a different digest when the baseline differs", () => {
    const a = digestChangeAdvisory(buildFixtureAdvisory(BASE_SNAPSHOT_DIGEST));
    const b = digestChangeAdvisory(buildFixtureAdvisory("a-different-baseline-digest"));
    expect(a).not.toBe(b);
  });
});
