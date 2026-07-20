import { describe, expect, it } from "vitest";
import { buildPortfolioLinks } from "../portfolio-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function frontmatterWithLink(overrides: Partial<{ type: string; domain: string; target: string }> = {}) {
  return { links: [{ type: "affects", domain: "portfolio", target: "rel-1", ...overrides }] };
}

describe("buildPortfolioLinks: declaration gating", () => {
  it("returns [] when frontmatter is undefined", () => {
    const decision = architectureDecision();
    expect(buildPortfolioLinks(decision, undefined, undefined)).toEqual([]);
  });

  it("returns [] when frontmatter has no links at all", () => {
    const decision = architectureDecision();
    expect(buildPortfolioLinks(decision, {}, undefined)).toEqual([]);
  });

  it("returns [] when declared links all target a different domain", () => {
    const decision = architectureDecision();
    const frontmatter = { links: [{ type: "governs", domain: "architecture", target: "rel-1" }] };
    expect(buildPortfolioLinks(decision, frontmatter, undefined)).toEqual([]);
  });

  it("does not infer a portfolio decision from shared dependency usage alone between two repositories/products", () => {
    const decision = architectureDecision({ context: "Both repo-a and repo-b depend on the shared-auth-lib package.", decision_text: "shared-auth-lib is used across the portfolio." });
    const snapshot = { relationships: [{ id: "shared-auth-lib" }], products: [{ id: "repo-a" }, { id: "repo-b" }] };
    expect(buildPortfolioLinks(decision, {}, snapshot)).toEqual([]);
    expect(buildPortfolioLinks(decision, undefined, snapshot)).toEqual([]);
  });

  it("only picks up entries whose target_domain is portfolio, ignoring other domains declared alongside", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "affects", domain: "portfolio", target: "rel-1" },
        { type: "governs", domain: "architecture", target: "rel-1" },
        { type: "requires", domain: "capability", target: "rel-1" },
      ],
    };
    const links = buildPortfolioLinks(decision, frontmatter, undefined);
    expect(links).toHaveLength(1);
    expect(links[0].target_domain).toBe("portfolio");
  });
});

describe("buildPortfolioLinks: resolution", () => {
  it("is unresolved and kept when portfolioSnapshot is undefined", () => {
    const decision = architectureDecision();
    const links = buildPortfolioLinks(decision, frontmatterWithLink(), undefined);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
  });

  it("is unresolved and kept when the snapshot does not contain the target entity id", () => {
    const decision = architectureDecision();
    const snapshot = { relationships: [{ id: "rel-other" }] };
    const links = buildPortfolioLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].detail).toContain("could not be confirmed");
  });

  it("resolves when the snapshot structurally contains the target entity id, however nested", () => {
    const decision = architectureDecision();
    const snapshot = { groups: [{ relationships: [{ id: "rel-1", name: "Relationship One" }] }] };
    const links = buildPortfolioLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("rel-1");
    expect(links[0].detail).toContain('affects portfolio relationship "rel-1"');
  });

  it("derives id via buildLinkId(decision.id, link_type, target_key)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = buildPortfolioLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].id).toBe(buildLinkId("decision:test-1", "affects", "rel-1"));
  });

  it("carries the decision's evidence_refs on the produced link", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ evidence_refs: refs });
    const links = buildPortfolioLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].evidence_refs).toBe(refs);
  });

  it("resolves multiple declared portfolio links independently", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "affects", domain: "portfolio", target: "rel-1" },
        { type: "depends_on", domain: "portfolio", target: "rel-2" },
      ],
    };
    const snapshot = { relationships: [{ id: "rel-1" }] };
    const links = buildPortfolioLinks(decision, frontmatter, snapshot);
    expect(links).toHaveLength(2);
    const byId = new Map(links.map((l) => [l.id, l]));
    expect(byId.get(buildLinkId(decision.id, "affects", "rel-1"))?.resolution).toBe("resolved");
    expect(byId.get(buildLinkId(decision.id, "depends_on", "rel-2"))?.resolution).toBe("unresolved");
  });
});
