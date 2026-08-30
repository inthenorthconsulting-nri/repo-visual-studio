// Public-entry-point (barrel) equivalence proof. Distinct from
// determinism.test.ts (which proves the CORE COMPUTATION is
// order/repetition-invariant): this file proves that going through the
// package's public entry point -- src/index.ts's barrel re-exports, the
// same names any future consumer imports via "@rvs/change-workbench" --
// produces identical results to calling the same functions via direct
// internal submodule imports, the way every other test in this suite does.
//
// What this file is NOT, and must not be read as: installed-package /
// node_modules-resolution certification. This package is `"private": true`,
// declares `"main": "src/index.ts"` with no `"exports"` field and no build
// script -- there is no compiled artifact and no npm tarball surface here.
// It also has no other real workspace consumer (checked: no other
// package.json in this repo declares "@rvs/change-workbench" as a
// dependency) to import it "for real" through node_modules. Earlier in this
// milestone this package briefly declared itself as a self-devDependency
// solely so pnpm would create a node_modules/@rvs/change-workbench symlink
// back to itself, purely to route this file's imports through package-name
// resolution. That symlink resolved to the exact same files on disk as a
// relative import -- it exercised no packaging step, no build transform, no
// distinct artifact, and so was never a genuine package/source distinction,
// only a roundabout way of importing the same barrel this file now imports
// directly. It has been removed (see package.json) as a misleading
// dependency kept for no reason other than to make an import path look like
// something it wasn't. Determinism (same inputs -> same outputs, proven
// extensively elsewhere in this suite) is not the same claim as "package
// equivalence" (this package's published surface matches its source) --
// this package currently has no published surface for that claim to be
// about. Full installed/consumer package-boundary certification -- the
// pnpm-pack-then-install mechanism source-vs-package-equivalence.test.ts
// uses for @rvs/cli, the one package in this repo with a real compiled/
// packed artifact -- remains Milestone 11.6's, once this package has one
// too.
//
// What IS real and worth proving now: that src/index.ts's barrel actually
// re-exports every one of these names faithfully (no silent drop, no
// rename, no divergent binding) by importing "the barrel way" on one side
// and each function's own defining submodule on the other -- every other
// test file in this directory imports individual submodules directly and
// never exercises the barrel at all.
import { describe, expect, it } from "vitest";

// Public entry point: every name below is imported exactly as a consumer
// importing "@rvs/change-workbench" would spell it, resolved through
// src/index.ts's barrel re-exports via a relative path to that barrel file.
import {
  buildProposedChangeSetId as pkgBuildProposedChangeSetId,
  composeProposedChangeSet as pkgComposeProposedChangeSet,
  tryConfirmEntityRef as pkgTryConfirmEntityRef,
  proposeEntityRef as pkgProposeEntityRef,
  mutateExistingEntityRef as pkgMutateExistingEntityRef,
  buildChangeOverlay as pkgBuildChangeOverlay,
  buildChangeAdvisory as pkgBuildChangeAdvisory,
  toStoredChangeAdvisory as pkgToStoredChangeAdvisory,
  assessChangeAdvisoryFreshness as pkgAssessChangeAdvisoryFreshness,
  evaluateProposedChange as pkgEvaluateProposedChange,
} from "../index.js";
import type { ProposalOperation, ProposedChangeSet } from "../index.js";

// Direct internal submodule imports: the same functions' own defining
// files, resolved via relative path, exactly as every other test file in
// this directory does -- never going through the barrel.
import { buildProposedChangeSetId as srcBuildProposedChangeSetId } from "../ids.js";
import { composeProposedChangeSet as srcComposeProposedChangeSet } from "../change-advisory.js";
import { tryConfirmEntityRef as srcTryConfirmEntityRef, proposeEntityRef as srcProposeEntityRef } from "../refs.js";
import { buildChangeOverlay as srcBuildChangeOverlay } from "../overlay.js";
import { buildChangeAdvisory as srcBuildChangeAdvisory } from "../change-advisory.js";
import { toStoredChangeAdvisory as srcToStoredChangeAdvisory, assessChangeAdvisoryFreshness as srcAssessChangeAdvisoryFreshness } from "../persistence.js";
import { evaluateProposedChange as srcEvaluateProposedChange } from "../evaluation.js";

import { BASE_SNAPSHOT_DIGEST, baseFixtureGraph, confirmedRef, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes, edges } = baseFixtureGraph();

describe("public-entry-point equivalence: src/index.ts barrel vs direct submodule imports", () => {
  it("ProposedChangeSet construction produces the same id via composeProposedChangeSet", () => {
    const operations: ProposalOperation[] = [{ kind: "remove_entity", ref: pkgMutateExistingEntityRef(confirmedRef("comp-c", nodes)) }];
    const viaBarrel = pkgComposeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
    const viaSubmodule = srcComposeProposedChangeSet({ repositoryId: REPOSITORY_ID, operations });
    expect(viaBarrel.id).toBe(viaSubmodule.id);
    expect(viaBarrel.id).toBe(pkgBuildProposedChangeSetId(REPOSITORY_ID, operations));
    expect(viaBarrel.id).toBe(srcBuildProposedChangeSetId(REPOSITORY_ID, operations));
  });

  it("reference validation (tryConfirmEntityRef) agrees on both a successful and a failed confirmation", () => {
    expect(pkgTryConfirmEntityRef("comp-a", nodes)).toBe(srcTryConfirmEntityRef("comp-a", nodes));
    expect(pkgTryConfirmEntityRef("does-not-exist", nodes)).toBe(srcTryConfirmEntityRef("does-not-exist", nodes));
    expect(pkgTryConfirmEntityRef("does-not-exist", nodes)).toBeUndefined();
  });

  it("overlay construction produces byte-identical OverlayBuildResult", () => {
    const newRef = pkgProposeEntityRef("pkg-boundary-fixture", "new-1");
    const operations: ProposalOperation[] = [
      { kind: "add_entity", ref: newRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New", repository_id: REPOSITORY_ID },
      { kind: "add_relation", from_ref: newRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    ];
    const changeSetPkg: ProposedChangeSet = { schema_version: 1, id: pkgBuildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
    const viaBarrel = pkgBuildChangeOverlay({ changeSet: changeSetPkg, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    const srcRef = srcProposeEntityRef("pkg-boundary-fixture", "new-1");
    const srcOperations: ProposalOperation[] = [
      { kind: "add_entity", ref: srcRef, node_type: "component", source_artifact: "architecture", proposed_source_entity_id: "new-1", label: "New", repository_id: REPOSITORY_ID },
      { kind: "add_relation", from_ref: srcRef, to_ref: confirmedRef("comp-a", nodes), edge_type: "depends_on" },
    ];
    const changeSetSrc: ProposedChangeSet = { schema_version: 1, id: srcBuildProposedChangeSetId(REPOSITORY_ID, srcOperations), repository_id: REPOSITORY_ID, operations: srcOperations };
    const viaSubmodule = srcBuildChangeOverlay({ changeSet: changeSetSrc, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
  });

  it("ChangeAdvisory construction produces byte-identical output, including coverage", () => {
    const operations: ProposalOperation[] = [{ kind: "modify_attributes", ref: pkgMutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }];
    const changeSet: ProposedChangeSet = { schema_version: 1, id: pkgBuildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };

    const viaBarrel = pkgBuildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const viaSubmodule = srcBuildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
    expect(viaBarrel.domain_coverage).toEqual(viaSubmodule.domain_coverage);
    expect(viaBarrel.id).toBe(viaSubmodule.id);
  });

  it("staleness evaluation (assessChangeAdvisoryFreshness) agrees on 'current' and 'stale_equivalent'", () => {
    const operations: ProposalOperation[] = [{ kind: "modify_attributes", ref: pkgMutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }];
    const changeSet: ProposedChangeSet = { schema_version: 1, id: pkgBuildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
    const advisory = pkgBuildChangeAdvisory({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    const storedViaBarrel = pkgToStoredChangeAdvisory(advisory);
    const storedViaSubmodule = srcToStoredChangeAdvisory(advisory);
    expect(JSON.stringify(storedViaBarrel)).toBe(JSON.stringify(storedViaSubmodule));

    expect(pkgAssessChangeAdvisoryFreshness(storedViaBarrel, BASE_SNAPSHOT_DIGEST)).toBe(srcAssessChangeAdvisoryFreshness(storedViaSubmodule, BASE_SNAPSHOT_DIGEST));
    expect(pkgAssessChangeAdvisoryFreshness(storedViaBarrel, BASE_SNAPSHOT_DIGEST)).toBe("current");
    expect(pkgAssessChangeAdvisoryFreshness(storedViaBarrel, "a-different-baseline")).toBe(srcAssessChangeAdvisoryFreshness(storedViaSubmodule, "a-different-baseline"));
    expect(pkgAssessChangeAdvisoryFreshness(storedViaBarrel, "a-different-baseline")).toBe("stale_equivalent");
  });

  it("the canonical evaluateProposedChange() produces a byte-identical ChangeWorkbenchEvaluation via the barrel and via its direct submodule", () => {
    const operations: ProposalOperation[] = [{ kind: "modify_attributes", ref: pkgMutateExistingEntityRef(confirmedRef("comp-b", nodes)), attributes: { label: "Renamed B" } }];
    const changeSet: ProposedChangeSet = { schema_version: 1, id: pkgBuildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };

    const viaBarrel = pkgEvaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });
    const viaSubmodule = srcEvaluateProposedChange({ changeSet, confirmedNodes: nodes, confirmedEdges: edges, baseSnapshotDigest: BASE_SNAPSHOT_DIGEST });

    expect(JSON.stringify(viaBarrel)).toBe(JSON.stringify(viaSubmodule));
    expect(viaBarrel.advisory.id).toBe(viaSubmodule.advisory.id);
  });
});
