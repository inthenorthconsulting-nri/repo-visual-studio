import { describe, expect, it } from "vitest";
import { buildArchitectureLinks } from "../architecture-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function frontmatterWithLink(overrides: Partial<{ type: string; domain: string; target: string }> = {}) {
  return { links: [{ type: "governs", domain: "architecture", target: "comp-1", ...overrides }] };
}

describe("buildArchitectureLinks: declaration gating", () => {
  it("returns [] when frontmatter is undefined", () => {
    const decision = architectureDecision();
    expect(buildArchitectureLinks(decision, undefined, undefined)).toEqual([]);
  });

  it("returns [] when frontmatter has no links at all", () => {
    const decision = architectureDecision();
    expect(buildArchitectureLinks(decision, {}, undefined)).toEqual([]);
  });

  it("returns [] when declared links all target a different domain", () => {
    const decision = architectureDecision();
    const frontmatter = { links: [{ type: "requires", domain: "capability", target: "cap-1" }] };
    expect(buildArchitectureLinks(decision, frontmatter, undefined)).toEqual([]);
  });

  it("does not infer a link from a textual mention of a component's name in context/decision_text", () => {
    const decision = architectureDecision({ context: "This decision affects the payments-gateway component directly.", decision_text: "We chose payments-gateway." });
    const snapshot = { components: [{ id: "payments-gateway" }] };
    expect(buildArchitectureLinks(decision, {}, snapshot)).toEqual([]);
    expect(buildArchitectureLinks(decision, undefined, snapshot)).toEqual([]);
  });

  it("only picks up entries whose target_domain is architecture, ignoring other domains declared alongside", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "governs", domain: "architecture", target: "comp-1" },
        { type: "requires", domain: "capability", target: "comp-1" },
        { type: "affects", domain: "product", target: "comp-1" },
      ],
    };
    const links = buildArchitectureLinks(decision, frontmatter, undefined);
    expect(links).toHaveLength(1);
    expect(links[0].target_domain).toBe("architecture");
  });
});

describe("buildArchitectureLinks: resolution", () => {
  it("is unresolved and kept when architectureSnapshot is undefined", () => {
    const decision = architectureDecision();
    const links = buildArchitectureLinks(decision, frontmatterWithLink(), undefined);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
  });

  it("is unresolved and kept when the snapshot does not contain the target entity id", () => {
    const decision = architectureDecision();
    const snapshot = { components: [{ id: "comp-other" }] };
    const links = buildArchitectureLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].detail).toContain("could not be confirmed");
  });

  it("resolves when the snapshot structurally contains the target entity id, however nested", () => {
    const decision = architectureDecision();
    const snapshot = { groups: [{ components: [{ id: "comp-1", name: "Comp One" }] }] };
    const links = buildArchitectureLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("comp-1");
    expect(links[0].detail).toContain('governs architecture entity "comp-1"');
  });

  it("derives id via buildLinkId(decision.id, link_type, target_key)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = buildArchitectureLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].id).toBe(buildLinkId("decision:test-1", "governs", "comp-1"));
  });

  it("carries the decision's evidence_refs on the produced link", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ evidence_refs: refs });
    const links = buildArchitectureLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].evidence_refs).toBe(refs);
  });

  it("resolves multiple declared architecture links independently", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "governs", domain: "architecture", target: "comp-1" },
        { type: "depends_on", domain: "architecture", target: "comp-2" },
      ],
    };
    const snapshot = { components: [{ id: "comp-1" }] };
    const links = buildArchitectureLinks(decision, frontmatter, snapshot);
    expect(links).toHaveLength(2);
    const byTarget = new Map(links.map((l) => [l.id, l]));
    expect(byTarget.get(buildLinkId(decision.id, "governs", "comp-1"))?.resolution).toBe("resolved");
    expect(byTarget.get(buildLinkId(decision.id, "depends_on", "comp-2"))?.resolution).toBe("unresolved");
  });
});
