import { describe, expect, it } from "vitest";
import { buildProductLinks } from "../product-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function frontmatterWithLink(overrides: Partial<{ type: string; domain: string; target: string }> = {}) {
  return { links: [{ type: "affects", domain: "product", target: "prod-1", ...overrides }] };
}

describe("buildProductLinks: declaration gating", () => {
  it("returns [] when frontmatter is undefined", () => {
    const decision = architectureDecision();
    expect(buildProductLinks(decision, undefined, undefined)).toEqual([]);
  });

  it("returns [] when frontmatter has no links at all", () => {
    const decision = architectureDecision();
    expect(buildProductLinks(decision, {}, undefined)).toEqual([]);
  });

  it("returns [] when declared links all target a different domain", () => {
    const decision = architectureDecision();
    const frontmatter = { links: [{ type: "governs", domain: "architecture", target: "prod-1" }] };
    expect(buildProductLinks(decision, frontmatter, undefined)).toEqual([]);
  });

  it("does not infer a link merely from a decision discussing a product-facing feature", () => {
    const decision = architectureDecision({ context: "This decision changes the checkout-app product experience.", decision_text: "checkout-app users will notice the change." });
    const snapshot = { products: [{ id: "checkout-app" }] };
    expect(buildProductLinks(decision, {}, snapshot)).toEqual([]);
    expect(buildProductLinks(decision, undefined, snapshot)).toEqual([]);
  });

  it("only picks up entries whose target_domain is product, ignoring other domains declared alongside", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "affects", domain: "product", target: "prod-1" },
        { type: "governs", domain: "architecture", target: "prod-1" },
        { type: "requires", domain: "capability", target: "prod-1" },
      ],
    };
    const links = buildProductLinks(decision, frontmatter, undefined);
    expect(links).toHaveLength(1);
    expect(links[0].target_domain).toBe("product");
  });
});

describe("buildProductLinks: resolution", () => {
  it("is unresolved and kept when productSnapshot is undefined", () => {
    const decision = architectureDecision();
    const links = buildProductLinks(decision, frontmatterWithLink(), undefined);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
  });

  it("is unresolved and kept when the snapshot does not contain the target entity id", () => {
    const decision = architectureDecision();
    const snapshot = { products: [{ id: "prod-other" }] };
    const links = buildProductLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].detail).toContain("could not be confirmed");
  });

  it("resolves when the snapshot structurally contains the target entity id, however nested", () => {
    const decision = architectureDecision();
    const snapshot = { groups: [{ products: [{ id: "prod-1", name: "Product One" }] }] };
    const links = buildProductLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("prod-1");
    expect(links[0].detail).toContain('affects product entity "prod-1"');
  });

  it("derives id via buildLinkId(decision.id, link_type, target_key)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = buildProductLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].id).toBe(buildLinkId("decision:test-1", "affects", "prod-1"));
  });

  it("carries the decision's evidence_refs on the produced link", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ evidence_refs: refs });
    const links = buildProductLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].evidence_refs).toBe(refs);
  });

  it("resolves multiple declared product links independently", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "affects", domain: "product", target: "prod-1" },
        { type: "references", domain: "product", target: "prod-2" },
      ],
    };
    const snapshot = { products: [{ id: "prod-1" }] };
    const links = buildProductLinks(decision, frontmatter, snapshot);
    expect(links).toHaveLength(2);
    const byId = new Map(links.map((l) => [l.id, l]));
    expect(byId.get(buildLinkId(decision.id, "affects", "prod-1"))?.resolution).toBe("resolved");
    expect(byId.get(buildLinkId(decision.id, "references", "prod-2"))?.resolution).toBe("unresolved");
  });
});
