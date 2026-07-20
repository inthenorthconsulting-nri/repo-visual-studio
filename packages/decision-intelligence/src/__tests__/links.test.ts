import { describe, expect, it } from "vitest";
import { buildDecisionLink, collectKnownEntityIds, extractDeclaredLinks, resolveAgainstEntityIds } from "../links.js";
import { buildLinkId } from "../ids.js";
import { evidenceRef } from "./decision-fixtures.js";

describe("extractDeclaredLinks", () => {
  it("returns [] when frontmatter is undefined", () => {
    expect(extractDeclaredLinks(undefined)).toEqual([]);
  });

  it("returns [] when frontmatter.links is missing", () => {
    expect(extractDeclaredLinks({})).toEqual([]);
  });

  it("returns [] when frontmatter.links is not an array", () => {
    expect(extractDeclaredLinks({ links: { type: "governs", domain: "architecture", target: "x" } })).toEqual([]);
    expect(extractDeclaredLinks({ links: "governs" })).toEqual([]);
  });

  it("drops entries that are not objects", () => {
    expect(extractDeclaredLinks({ links: ["a-string", 42, null, true] })).toEqual([]);
  });

  it("drops entries missing a valid type", () => {
    expect(extractDeclaredLinks({ links: [{ domain: "architecture", target: "x" }] })).toEqual([]);
    expect(extractDeclaredLinks({ links: [{ type: "not_a_real_type", domain: "architecture", target: "x" }] })).toEqual([]);
    expect(extractDeclaredLinks({ links: [{ type: 5, domain: "architecture", target: "x" }] })).toEqual([]);
  });

  it("drops entries missing a valid target_domain", () => {
    expect(extractDeclaredLinks({ links: [{ type: "governs", target: "x" }] })).toEqual([]);
    expect(extractDeclaredLinks({ links: [{ type: "governs", domain: "not_a_real_domain", target: "x" }] })).toEqual([]);
  });

  it("drops entries with a missing, non-string, or blank target", () => {
    expect(extractDeclaredLinks({ links: [{ type: "governs", domain: "architecture" }] })).toEqual([]);
    expect(extractDeclaredLinks({ links: [{ type: "governs", domain: "architecture", target: 7 }] })).toEqual([]);
    expect(extractDeclaredLinks({ links: [{ type: "governs", domain: "architecture", target: "   " }] })).toEqual([]);
  });

  it("accepts a well-formed entry and trims the target", () => {
    const declared = extractDeclaredLinks({ links: [{ type: "governs", domain: "architecture", target: "  comp-1  " }] });
    expect(declared).toEqual([{ link_type: "governs", target_domain: "architecture", target_key: "comp-1" }]);
  });

  it("accepts every one of the 16 declared link types", () => {
    const types = [
      "governs",
      "introduces",
      "removes",
      "replaces",
      "constrains",
      "permits",
      "deprecates",
      "requires",
      "explains",
      "justifies",
      "depends_on",
      "implements",
      "validates",
      "excepts",
      "affects",
      "references",
    ];
    const links = types.map((type) => ({ type, domain: "architecture", target: "x" }));
    const declared = extractDeclaredLinks({ links });
    expect(declared.map((d) => d.link_type)).toEqual(types);
  });

  it("keeps only well-formed entries when the array mixes valid and malformed entries, preserving order", () => {
    const declared = extractDeclaredLinks({
      links: [
        { type: "governs", domain: "architecture", target: "a" },
        { type: "bogus", domain: "architecture", target: "b" },
        { type: "requires", domain: "capability", target: "c" },
        null,
        { type: "explains", domain: "portfolio", target: "" },
      ],
    });
    expect(declared).toEqual([
      { link_type: "governs", target_domain: "architecture", target_key: "a" },
      { link_type: "requires", target_domain: "capability", target_key: "c" },
    ]);
  });
});

describe("buildDecisionLink", () => {
  it("derives id via buildLinkId(decisionId, linkType, targetKey)", () => {
    const link = buildDecisionLink("decision:test-1", "governs", "architecture", "comp-1", { resolution: "unresolved" }, "detail", []);
    expect(link.id).toBe(buildLinkId("decision:test-1", "governs", "comp-1"));
  });

  it("passes through decision_id, link_type, target_domain, resolution, detail, evidence_refs", () => {
    const refs = [evidenceRef({ path: "docs/adr/0001.md" })];
    const link = buildDecisionLink("decision:test-1", "requires", "capability", "cap-1", { resolution: "resolved", targetId: "cap-1" }, "detail text", refs);
    expect(link.decision_id).toBe("decision:test-1");
    expect(link.link_type).toBe("requires");
    expect(link.target_domain).toBe("capability");
    expect(link.resolution).toBe("resolved");
    expect(link.detail).toBe("detail text");
    expect(link.evidence_refs).toBe(refs);
  });

  it("sets target_id when the outcome carries a targetId (resolved)", () => {
    const link = buildDecisionLink("decision:test-1", "governs", "architecture", "comp-1", { resolution: "resolved", targetId: "comp-1" }, "detail", []);
    expect(link.target_id).toBe("comp-1");
  });

  it("sets target_id when the outcome carries a targetId (incompatible)", () => {
    const link = buildDecisionLink("decision:test-1", "excepts", "governance", "pol:rule", { resolution: "incompatible", targetId: "pol:rule" }, "detail", []);
    expect(link.target_id).toBe("pol:rule");
  });

  it("sets target_id when the outcome carries a targetId (partially_resolved)", () => {
    const link = buildDecisionLink("decision:test-1", "governs", "architecture", "comp-1", { resolution: "partially_resolved", targetId: "comp-1" }, "detail", []);
    expect(link.target_id).toBe("comp-1");
  });

  it("leaves target_id undefined when the outcome is unresolved", () => {
    const link = buildDecisionLink("decision:test-1", "governs", "architecture", "comp-1", { resolution: "unresolved" }, "detail", []);
    expect(link.target_id).toBeUndefined();
  });

  it("leaves target_id undefined when the outcome is ambiguous", () => {
    const link = buildDecisionLink("decision:test-1", "governs", "architecture", "comp-1", { resolution: "ambiguous" }, "detail", []);
    expect(link.target_id).toBeUndefined();
  });
});

describe("resolveAgainstEntityIds", () => {
  it("returns unresolved when knownEntityIds is undefined (upstream artifact absent) -- never assumed resolved", () => {
    expect(resolveAgainstEntityIds("comp-1", undefined)).toEqual({ resolution: "unresolved" });
  });

  it("returns unresolved when knownEntityIds is an empty set", () => {
    expect(resolveAgainstEntityIds("comp-1", new Set())).toEqual({ resolution: "unresolved" });
  });

  it("returns unresolved when there is no exact match", () => {
    expect(resolveAgainstEntityIds("comp-1", new Set(["comp-2", "comp-3"]))).toEqual({ resolution: "unresolved" });
  });

  it("returns resolved with the targetKey as targetId on an exact match", () => {
    expect(resolveAgainstEntityIds("comp-1", new Set(["comp-1", "comp-2"]))).toEqual({ resolution: "resolved", targetId: "comp-1" });
  });

  it("never fuzzy- or prefix-matches: a near-miss key stays unresolved", () => {
    expect(resolveAgainstEntityIds("comp-1", new Set(["comp-10"]))).toEqual({ resolution: "unresolved" });
    expect(resolveAgainstEntityIds("comp-10", new Set(["comp-1"]))).toEqual({ resolution: "unresolved" });
  });

  it("is case-sensitive: differing case is never treated as a match", () => {
    expect(resolveAgainstEntityIds("Comp-1", new Set(["comp-1"]))).toEqual({ resolution: "unresolved" });
  });
});

describe("collectKnownEntityIds", () => {
  it("returns an empty set for null or non-object input", () => {
    expect(collectKnownEntityIds(null)).toEqual(new Set());
    expect(collectKnownEntityIds("a string")).toEqual(new Set());
    expect(collectKnownEntityIds(42)).toEqual(new Set());
  });

  it("collects a top-level id", () => {
    expect(collectKnownEntityIds({ id: "comp-1" })).toEqual(new Set(["comp-1"]));
  });

  it("collects ids nested inside objects and arrays without knowing the array field name", () => {
    const snapshot = {
      components: [{ id: "comp-1", name: "A" }, { id: "comp-2" }],
      metadata: { owner: { id: "team-1" } },
    };
    expect(collectKnownEntityIds(snapshot)).toEqual(new Set(["comp-1", "comp-2", "team-1"]));
  });

  it("walks a top-level array", () => {
    expect(collectKnownEntityIds([{ id: "a" }, { id: "b" }])).toEqual(new Set(["a", "b"]));
  });

  it("dedupes repeated ids into a single Set entry", () => {
    expect(collectKnownEntityIds([{ id: "a" }, { id: "a" }])).toEqual(new Set(["a"]));
  });

  it("ignores id fields that are not strings", () => {
    expect(collectKnownEntityIds({ id: 123 })).toEqual(new Set());
    expect(collectKnownEntityIds({ id: null })).toEqual(new Set());
    expect(collectKnownEntityIds({ id: { nested: "x" } })).toEqual(new Set());
  });

  it("ignores empty or whitespace-only string ids", () => {
    expect(collectKnownEntityIds({ id: "" })).toEqual(new Set());
    expect(collectKnownEntityIds({ id: "   " })).toEqual(new Set());
  });

  it("bounds recursion to MAX_ID_COLLECTION_DEPTH: collects at depth 6, drops depth 7 and beyond", () => {
    let node: unknown = { id: "id-8" };
    for (let level = 7; level >= 0; level -= 1) {
      node = { id: `id-${level}`, next: node };
    }
    const ids = collectKnownEntityIds(node);
    expect(ids).toEqual(new Set(["id-0", "id-1", "id-2", "id-3", "id-4", "id-5", "id-6"]));
    expect(ids.has("id-7")).toBe(false);
    expect(ids.has("id-8")).toBe(false);
  });
});
