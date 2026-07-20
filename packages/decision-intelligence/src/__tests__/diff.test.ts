import { describe, expect, it } from "vitest";
import { diffDecisions } from "../diff.js";
import { assessDecisionSnapshotCompatibility } from "../compatibility.js";
import { buildChangeId, buildChangeSetId } from "../ids.js";
import type { ArchitectureDecision } from "../contracts.js";
import { architectureDecision, decisionSnapshot, decisionSource, decisionSourceIssue, evidenceRef, GENERATED_AT } from "./decision-fixtures.js";

function decision(id: string, opts: { path?: string; digest?: string; authors?: string[]; title?: string } = {}): ArchitectureDecision {
  const path = opts.path ?? `docs/adr/${id.replace(/[:]/g, "-")}.md`;
  return architectureDecision({
    id,
    source: decisionSource({ repo_relative_path: path, content_digest: opts.digest ?? `digest-${id}`, source_type: "adr" }),
    authors: opts.authors ?? ["Alice"],
    title: opts.title ?? `Decision ${id}`,
    evidence_refs: [evidenceRef({ path })],
  });
}

describe("diffDecisions: no-change identity", () => {
  it("diffing a snapshot against itself produces exactly one 'unchanged' entry per decision", () => {
    const d1 = decision("decision:d1");
    const d2 = decision("decision:d2");
    const snapshot = decisionSnapshot({ decisions: [d1, d2] });
    const result = diffDecisions({ source: snapshot, target: snapshot, generatedAt: GENERATED_AT });
    expect(result.changes).toHaveLength(2);
    expect(result.changes.every((c) => c.change_type === "unchanged")).toBe(true);
    expect(result.changes.every((c) => c.classification === "editorial")).toBe(true);
  });
});

describe("diffDecisions: change_type coverage", () => {
  it("covers 'added': a decision present only in the target snapshot", () => {
    const source = decisionSnapshot({ decisions: [] });
    const target = decisionSnapshot({ decisions: [decision("decision:new")] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].change_type).toBe("added");
    expect(result.changes[0].classification).toBe("material");
  });

  it("covers 'removed': a decision present only in the source snapshot", () => {
    const source = decisionSnapshot({ decisions: [decision("decision:gone")] });
    const target = decisionSnapshot({ decisions: [] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].change_type).toBe("removed");
    expect(result.changes[0].classification).toBe("material");
  });

  it("covers 'modified': the same decision id with a changed field", () => {
    const source = decisionSnapshot({ decisions: [decision("decision:d1", { title: "Original" })] });
    const target = decisionSnapshot({ decisions: [decision("decision:d1", { title: "Changed" })] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].change_type).toBe("modified");
  });

  it("covers 'unchanged' even with reordered object keys (canonicalized comparison)", () => {
    const d = decision("decision:d1");
    const reordered = Object.fromEntries(Object.entries(d).reverse()) as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [d] });
    const target = decisionSnapshot({ decisions: [reordered] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].change_type).toBe("unchanged");
  });

  it("covers 'unresolved': the decision's document is unparseable in the source snapshot", () => {
    const d = decision("decision:d1", { path: "docs/adr/d1.md" });
    const source = decisionSnapshot({ decisions: [d], source_issues: [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/d1.md"] })] });
    const target = decisionSnapshot({ decisions: [d] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].change_type).toBe("unresolved");
    expect(result.changes[0].classification).toBe("unresolved");
  });

  it("covers 'unresolved': the decision's document is unparseable in the target snapshot only", () => {
    const d = decision("decision:d1", { path: "docs/adr/d1.md" });
    const source = decisionSnapshot({ decisions: [d] });
    const target = decisionSnapshot({ decisions: [d], source_issues: [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/d1.md"] })] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].change_type).toBe("unresolved");
  });

  it("'unresolved' from unparseable structure takes precedence over what would otherwise be 'added'", () => {
    const d = decision("decision:new", { path: "docs/adr/new.md" });
    const source = decisionSnapshot({ decisions: [] });
    const target = decisionSnapshot({ decisions: [d], source_issues: [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/new.md"] })] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].change_type).toBe("unresolved");
    expect(result.changes[0].change_type).not.toBe("added");
  });
});

describe("diffDecisions: rename detection is gated behind detectRenames and never inferred from a single removal+addition pair alone", () => {
  it("does NOT pair a matching removal+addition when detectRenames is omitted", () => {
    const from = decision("decision:from", { digest: "shared-digest" });
    const to = { ...from, id: "decision:to" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes).toHaveLength(2);
    const types = result.changes.map((c) => c.change_type).sort();
    expect(types).toEqual(["added", "removed"]);
    expect(result.changes.every((c) => !c.detail.includes("renamed"))).toBe(true);
  });

  it("does NOT pair a matching removal+addition when detectRenames is explicitly false", () => {
    const from = decision("decision:from", { digest: "shared-digest" });
    const to = { ...from, id: "decision:to" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: false });
    expect(result.changes.map((c) => c.change_type).sort()).toEqual(["added", "removed"]);
  });

  it("pairs a removal+addition as one renamed change when detectRenames is true and content_digest, source_type, and authors all corroborate", () => {
    const from = decision("decision:from", { digest: "shared-digest", authors: ["Alice"] });
    const to = { ...from, id: "decision:to" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].decision_id).toBe("decision:to");
    expect(result.changes[0].change_type).toBe("unchanged");
    expect(result.changes[0].detail).toContain('"decision:from"');
    expect(result.changes[0].detail).toContain('"decision:to"');
    expect(result.changes[0].detail).toContain("renamed");
    expect(result.changes[0].id).toBe(buildChangeId("decision:to", "unchanged"));
  });

  it("a corroborated rename with a genuinely changed field is 'modified', not 'unchanged'", () => {
    const from = decision("decision:from", { digest: "shared-digest", authors: ["Alice"] });
    const to = { ...from, id: "decision:to", title: "New Title" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].change_type).toBe("modified");
  });

  it("does NOT pair when detectRenames is true but authors fail to corroborate (partial signal is insufficient)", () => {
    const from = decision("decision:from", { digest: "shared-digest", authors: ["Alice"] });
    const to = { ...from, id: "decision:to", authors: ["Bob"] } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes.map((c) => c.change_type).sort()).toEqual(["added", "removed"]);
  });

  it("does NOT pair when detectRenames is true but source_type fails to corroborate", () => {
    const from = decision("decision:from", { digest: "shared-digest", authors: ["Alice"] });
    const to = {
      ...from,
      id: "decision:to",
      source: { ...from.source, source_type: "rfc" },
    } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes.map((c) => c.change_type).sort()).toEqual(["added", "removed"]);
  });

  it("marks a corroborated rename as 'unresolved' when either side's document is unparseable", () => {
    const from = decision("decision:from", { digest: "shared-digest", authors: ["Alice"], path: "docs/adr/from.md" });
    const to = { ...from, id: "decision:to" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from], source_issues: [decisionSourceIssue({ kind: "unparseable_structure", affected_paths: ["docs/adr/from.md"] })] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].change_type).toBe("unresolved");
  });

  it("deduplicates rename candidates: when two removals both corroborate against one addition, only the alphabetically-first fromId is paired", () => {
    const a = decision("decision:a", { digest: "dup-digest", authors: ["Alice"] });
    const b = decision("decision:b", { digest: "dup-digest", authors: ["Alice"] });
    const c = { ...a, id: "decision:c" } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [a, b] });
    const target = decisionSnapshot({ decisions: [c] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT, detectRenames: true });
    expect(result.changes).toHaveLength(2);
    const renamedEntry = result.changes.find((ch) => ch.decision_id === "decision:c")!;
    expect(renamedEntry.detail).toContain('"decision:a"');
    expect(renamedEntry.detail).toContain('"decision:c"');
    const removedEntry = result.changes.find((ch) => ch.decision_id === "decision:b")!;
    expect(removedEntry.change_type).toBe("removed");
  });
});

describe("diffDecisions: evidence_refs are deduped and sorted", () => {
  it("merges and dedupes evidence_refs from both sides for a modified decision", () => {
    const from = decision("decision:d1", { path: "docs/adr/d1.md" });
    const to = { ...from, title: "Changed", evidence_refs: [evidenceRef({ path: "docs/adr/other.md" }), evidenceRef({ path: "docs/adr/d1.md" })] } as ArchitectureDecision;
    const source = decisionSnapshot({ decisions: [from] });
    const target = decisionSnapshot({ decisions: [to] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    const paths = result.changes[0].evidence_refs.map((r) => r.path);
    expect(paths).toEqual(["docs/adr/d1.md", "docs/adr/other.md"]);
  });
});

describe("diffDecisions: assembly and identity", () => {
  it("derives id via buildChangeSetId(source.id, target.id)", () => {
    const source = decisionSnapshot({ id: "decision:snapshot:source-x" });
    const target = decisionSnapshot({ id: "decision:snapshot:target-y" });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.id).toBe(buildChangeSetId("decision:snapshot:source-x", "decision:snapshot:target-y"));
    expect(result.source_snapshot_id).toBe("decision:snapshot:source-x");
    expect(result.target_snapshot_id).toBe("decision:snapshot:target-y");
  });

  it("derives every change's id via buildChangeId(decisionId, changeType)", () => {
    const source = decisionSnapshot({ decisions: [decision("decision:d1")] });
    const target = decisionSnapshot({ decisions: [] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.changes[0].id).toBe(buildChangeId("decision:d1", "removed"));
  });

  it("passes through the caller-supplied generatedAt verbatim", () => {
    const result = diffDecisions({ source: decisionSnapshot(), target: decisionSnapshot(), generatedAt: "2020-05-05T00:00:00.000Z" });
    expect(result.generated_at).toBe("2020-05-05T00:00:00.000Z");
  });

  it("compatibility field is exactly assessDecisionSnapshotCompatibility(source, target)", () => {
    const source = decisionSnapshot({ repository_id: "repo-a" });
    const target = decisionSnapshot({ repository_id: "repo-b" });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    expect(result.compatibility).toEqual(assessDecisionSnapshotCompatibility(source, target));
    expect(result.compatibility.status).toBe("incompatible");
  });

  it("sorts changes by id", () => {
    const source = decisionSnapshot({ decisions: [decision("decision:zzz"), decision("decision:aaa")] });
    const target = decisionSnapshot({ decisions: [] });
    const result = diffDecisions({ source, target, generatedAt: GENERATED_AT });
    const ids = result.changes.map((c) => c.id);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });
});
