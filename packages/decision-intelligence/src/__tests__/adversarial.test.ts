import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../snapshot.js";
import { diffDecisions } from "../diff.js";
import { buildDecisionConflicts } from "../conflicts.js";
import { resolveDecisionIdentity, detectDecisionIdentityIssues, type DecisionIdentityInput, type ResolvedDecisionSourceRecord } from "../identity.js";
import { architectureDecision, decisionLink, decisionSource, evidenceRef, GENERATED_AT } from "./decision-fixtures.js";

const TARGET_GENERATED_AT = "2026-07-08T00:00:00.000Z";

describe("adversarial: wording-only prose edits are never material", () => {
  it("a decision_text-only edit, with every MATERIAL/GOVERNANCE/METADATA-tracked field unchanged, is classified editorial", () => {
    // DecisionSnapshot/ArchitectureDecision carry no `assumptions` field at all (assumptions.ts's output is
    // a separate array never embedded in a decision record), so an "assumption wording edit" cannot itself
    // appear inside diff.ts's comparison surface. The closest real structural equivalent -- and the one
    // change-classification.ts's own docstring names explicitly (spec S34) -- is a wording-only edit to a
    // decision's own decision_text/context prose, which must fall through to "editorial" precisely because
    // neither field is a member of MATERIAL_FIELDS, GOVERNANCE_FIELDS, or METADATA_FIELDS.
    const fixedEvidence = [evidenceRef({ path: "docs/adr/0001-wording.md" })];
    const source = architectureDecision({
      id: "decision:wording",
      title: "Use Postgres for primary storage",
      decision_text: "We will use Postgres for storage.",
      evidence_refs: fixedEvidence,
    });
    const target = architectureDecision({
      id: "decision:wording",
      title: "Use Postgres for primary storage",
      decision_text: "We are going to use Postgres for storage instead.",
      evidence_refs: fixedEvidence,
    });

    const sourceSnapshot = buildDecisionSnapshot({ repositoryId: "repo-wording", generatedAt: GENERATED_AT, decisions: [source], sourceIssues: [] });
    const targetSnapshot = buildDecisionSnapshot({ repositoryId: "repo-wording", generatedAt: TARGET_GENERATED_AT, decisions: [target], sourceIssues: [] });

    const changeSet = diffDecisions({ source: sourceSnapshot, target: targetSnapshot, generatedAt: TARGET_GENERATED_AT });
    expect(changeSet.changes).toHaveLength(1);
    expect(changeSet.changes[0]!.change_type).toBe("modified");
    expect(changeSet.changes[0]!.classification).toBe("editorial");
  });
});

describe("adversarial: a moved decision file keeps its id when frontmatter.id is stable", () => {
  it("resolveDecisionIdentity returns the same id and basis across a path change when frontmatter.id does not change", () => {
    const digest = "digest-stable-0007";
    const before: DecisionIdentityInput = { repo_relative_path: "docs/adr/0007-old-location.md", frontmatter: { id: "ADR-0007" }, title: "Old title text", content_digest: digest };
    const after: DecisionIdentityInput = { repo_relative_path: "docs/decisions/nested/0007-relocated.md", frontmatter: { id: "ADR-0007" }, title: "Old title text", content_digest: digest };

    const beforeResult = resolveDecisionIdentity(before, undefined);
    const afterResult = resolveDecisionIdentity(after, undefined);

    expect(afterResult.id).toBe(beforeResult.id);
    expect(afterResult.basis).toBe("frontmatter_id");
  });

  it("without a stable frontmatter.id, a path-based fallback resolution DOES change id when the path changes -- the contrast case", () => {
    const digest = "digest-no-frontmatter";
    const before: DecisionIdentityInput = { repo_relative_path: "docs/adr/0008-old-location.md", frontmatter: undefined, title: "Untitled decision", content_digest: digest };
    const after: DecisionIdentityInput = { repo_relative_path: "docs/decisions/nested/0008-relocated.md", frontmatter: undefined, title: "Untitled decision", content_digest: digest };

    const beforeResult = resolveDecisionIdentity(before, undefined);
    const afterResult = resolveDecisionIdentity(after, undefined);

    expect(beforeResult.basis).toBe("path");
    expect(afterResult.basis).toBe("path");
    expect(afterResult.id).not.toBe(beforeResult.id);
  });
});

describe("adversarial: input reordering never changes output ordering", () => {
  it("reordering the decisions array before buildDecisionSnapshot does not change decision order, snapshot id, or digest", () => {
    const a = architectureDecision({ id: "decision:c-alpha" });
    const b = architectureDecision({ id: "decision:c-beta" });
    const c = architectureDecision({ id: "decision:c-gamma" });

    const forward = buildDecisionSnapshot({ repositoryId: "repo-order", generatedAt: GENERATED_AT, decisions: [a, b, c], sourceIssues: [] });
    const reversed = buildDecisionSnapshot({ repositoryId: "repo-order", generatedAt: GENERATED_AT, decisions: [c, b, a], sourceIssues: [] });
    const shuffled = buildDecisionSnapshot({ repositoryId: "repo-order", generatedAt: GENERATED_AT, decisions: [b, c, a], sourceIssues: [] });

    expect(reversed.decisions.map((d) => d.id)).toEqual(forward.decisions.map((d) => d.id));
    expect(shuffled.decisions.map((d) => d.id)).toEqual(forward.decisions.map((d) => d.id));
    expect(reversed.id).toBe(forward.id);
    expect(shuffled.id).toBe(forward.id);
    expect(reversed.digest).toBe(forward.digest);
    expect(shuffled.digest).toBe(forward.digest);
  });

  it("reordering the links array does not change buildDecisionConflicts' identity, decision_ids, kind, or status -- only the prose 'detail' field may mention the pair in encounter order", () => {
    const introducer = architectureDecision({ id: "decision:conflict-introducer" });
    const remover = architectureDecision({ id: "decision:conflict-remover" });
    const linkIntroduces = decisionLink({ decision_id: introducer.id, link_type: "introduces", target_domain: "architecture", target_id: "component:shared", resolution: "resolved" });
    const linkRemoves = decisionLink({ decision_id: remover.id, link_type: "removes", target_domain: "architecture", target_id: "component:shared", resolution: "resolved" });

    const evidenceMap = new Map<string, ReturnType<typeof evidenceRef>[]>();
    const forward = buildDecisionConflicts([introducer, remover], [linkIntroduces, linkRemoves], [], evidenceMap);
    const reversed = buildDecisionConflicts([remover, introducer], [linkRemoves, linkIntroduces], [], evidenceMap);

    expect(forward.length).toBeGreaterThan(0);
    expect(reversed.map((c) => ({ id: c.id, decision_ids: c.decision_ids, kind: c.kind, status: c.status }))).toEqual(
      forward.map((c) => ({ id: c.id, decision_ids: c.decision_ids, kind: c.kind, status: c.status })),
    );
  });
});

describe("adversarial: declaration order of decisions in a source snapshot never changes derived ids", () => {
  it("5 decisions declared in a different order produce byte-identical snapshot ids and per-decision ids", () => {
    const decisions = ["e1", "e2", "e3", "e4", "e5"].map((suffix) => architectureDecision({ id: `decision:d-${suffix}` }));
    const declaredOrder = buildDecisionSnapshot({ repositoryId: "repo-decl-order", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const shuffledOrder = buildDecisionSnapshot({ repositoryId: "repo-decl-order", generatedAt: GENERATED_AT, decisions: [decisions[3]!, decisions[0]!, decisions[4]!, decisions[1]!, decisions[2]!], sourceIssues: [] });

    expect(shuffledOrder.id).toBe(declaredOrder.id);
    expect(JSON.stringify(shuffledOrder)).toBe(JSON.stringify(declaredOrder));
  });
});

describe("adversarial: diffing two structurally identical snapshots yields zero non-unchanged entries", () => {
  it("every decision comes back change_type 'unchanged' when source and target decisions are identical", () => {
    const decisions = [architectureDecision({ id: "decision:same-1" }), architectureDecision({ id: "decision:same-2", decision_status: "implemented" })];
    const source = buildDecisionSnapshot({ repositoryId: "repo-nochange", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-nochange", generatedAt: TARGET_GENERATED_AT, decisions, sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: TARGET_GENERATED_AT });
    expect(changeSet.changes).toHaveLength(decisions.length);
    expect(changeSet.changes.every((c) => c.change_type === "unchanged")).toBe(true);
    expect(changeSet.changes.some((c) => c.change_type === "added" || c.change_type === "removed" || c.change_type === "modified")).toBe(false);
  });
});

describe("adversarial: an ambiguous rename (bare removal + addition) is never auto-detected", () => {
  it("does not pair a removal+addition even with detectRenames:true when content_digest differs", () => {
    const removed = architectureDecision({ id: "decision:f-old", source: decisionSource({ content_digest: "digest-old" }) });
    const added = architectureDecision({ id: "decision:f-new", source: decisionSource({ content_digest: "digest-new" }) });
    const source = buildDecisionSnapshot({ repositoryId: "repo-f", generatedAt: GENERATED_AT, decisions: [removed], sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-f", generatedAt: GENERATED_AT, decisions: [added], sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    const types = changeSet.changes.map((c) => c.change_type).sort();
    expect(types).toEqual(["added", "removed"]);
  });

  it("does not pair a removal+addition when detectRenames is omitted (default false), even when content_digest/source_type/authors all match", () => {
    const sharedSource = decisionSource({ content_digest: "digest-shared" });
    const removed = architectureDecision({ id: "decision:f-old2", source: sharedSource, authors: ["a"] });
    const added = architectureDecision({ id: "decision:f-new2", source: sharedSource, authors: ["a"] });
    const source = buildDecisionSnapshot({ repositoryId: "repo-f2", generatedAt: GENERATED_AT, decisions: [removed], sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-f2", generatedAt: GENERATED_AT, decisions: [added], sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    const types = changeSet.changes.map((c) => c.change_type).sort();
    expect(types).toEqual(["added", "removed"]);
  });

  it("DOES pair a removal+addition when detectRenames:true and content_digest/source_type/authors all corroborate -- the contrast case proving the gate itself works", () => {
    const sharedSource = decisionSource({ content_digest: "digest-corroborated", source_type: "adr" });
    const removed = architectureDecision({ id: "decision:f-old3", source: sharedSource, authors: ["a", "b"] });
    const added = architectureDecision({ id: "decision:f-new3", source: sharedSource, authors: ["a", "b"] });
    const source = buildDecisionSnapshot({ repositoryId: "repo-f3", generatedAt: GENERATED_AT, decisions: [removed], sourceIssues: [] });
    const target = buildDecisionSnapshot({ repositoryId: "repo-f3", generatedAt: GENERATED_AT, decisions: [added], sourceIssues: [] });

    const changeSet = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(changeSet.changes).toHaveLength(1);
    expect(changeSet.changes[0]!.decision_id).toBe("decision:f-new3");
    expect(changeSet.changes[0]!.change_type).not.toBe("added");
  });
});

describe("adversarial: an id differing only by case is flagged as a collision, never silently distinct", () => {
  it("detectDecisionIdentityIssues reports duplicate_id_case_only for two records whose ids differ only by case", () => {
    const records: ResolvedDecisionSourceRecord[] = [
      { id: "decision:adr-1", repo_relative_path: "docs/adr/0001-a.md", content_digest: "d1", evidence_refs: [] },
      { id: "decision:ADR-1", repo_relative_path: "docs/adr/0001-b.md", content_digest: "d2", evidence_refs: [] },
    ];

    const issues = detectDecisionIdentityIssues(records);
    expect(issues.map((i) => i.kind)).toContain("duplicate_id_case_only");
    const caseIssue = issues.find((i) => i.kind === "duplicate_id_case_only")!;
    expect(caseIssue.affected_paths).toEqual(["docs/adr/0001-a.md", "docs/adr/0001-b.md"]);
    expect(issues.map((i) => i.kind)).not.toContain("multiple_files_claim_one_id");
  });

  it("does not report duplicate_id_case_only when ids are exactly equal -- that is multiple_files_claim_one_id's job instead", () => {
    const records: ResolvedDecisionSourceRecord[] = [
      { id: "decision:exact-1", repo_relative_path: "docs/adr/0002-a.md", content_digest: "d1", evidence_refs: [] },
      { id: "decision:exact-1", repo_relative_path: "docs/adr/0002-b.md", content_digest: "d2", evidence_refs: [] },
    ];

    const issues = detectDecisionIdentityIssues(records);
    expect(issues.map((i) => i.kind)).toContain("multiple_files_claim_one_id");
    expect(issues.map((i) => i.kind)).not.toContain("duplicate_id_case_only");
  });
});
