import { describe, expect, it } from "vitest";
import {
  portfolioCapabilityId,
  portfolioClaimId,
  portfolioDecisionId,
  portfolioDependencyEdgeId,
  portfolioDependencyNodeId,
  portfolioDomainId,
  portfolioEvidenceId,
  portfolioGapId,
  portfolioOverlapId,
  portfolioProductId,
  portfolioRelationshipId,
  portfolioSceneId,
} from "../ids.js";

describe("id generator functions", () => {
  it("portfolioProductId composes the sanitized config id", () => {
    expect(portfolioProductId("governance-cli")).toBe("portfolio:product:governance-cli");
  });

  it("portfolioEvidenceId composes sourceType, productId, and index in order", () => {
    expect(portfolioEvidenceId("capability", "portfolio:product:governance-cli", 2)).toBe("portfolio:evidence:capability:portfolio-product-governance-cli:2");
  });

  it("portfolioCapabilityId sanitizes the normalized key", () => {
    expect(portfolioCapabilityId("widget-sync")).toBe("portfolio:capability:widget-sync");
  });

  it("portfolioDomainId lowercases the domain label before sanitizing", () => {
    expect(portfolioDomainId("Widget Operations")).toBe("portfolio:domain:widget-operations");
  });

  it("portfolioOverlapId sanitizes the capability id", () => {
    expect(portfolioOverlapId("portfolio:capability:widget-sync")).toBe("portfolio:overlap:portfolio-capability-widget-sync");
  });

  it("portfolioGapId lowercases the key before sanitizing", () => {
    expect(portfolioGapId("unowned_capability", "Widget Sync")).toBe("portfolio:gap:unowned_capability:widget-sync");
  });

  it("portfolioClaimId composes claimType and subjectId, sanitizing both", () => {
    expect(portfolioClaimId("identity", "portfolio:product:governance-cli")).toBe("portfolio:claim:identity:portfolio-product-governance-cli");
  });

  it("portfolioDecisionId lowercases the key before sanitizing", () => {
    expect(portfolioDecisionId("ownership", "Widget Sync")).toBe("portfolio:decision:ownership:widget-sync");
  });

  it("portfolioSceneId composes type and index", () => {
    expect(portfolioSceneId("portfolio-hero", 0)).toBe("portfolio:scene:portfolio-hero:0");
  });

  it("portfolioDependencyNodeId lowercases the label before sanitizing", () => {
    expect(portfolioDependencyNodeId("product", "Alpha CLI")).toBe("portfolio:node:product:alpha-cli");
  });

  it("sanitizes every character outside [a-zA-Z0-9_.-] to a dash, across id functions", () => {
    expect(portfolioProductId("some id!@# with spaces")).toBe("portfolio:product:some-id----with-spaces");
    expect(portfolioEvidenceId("cap ability!", "id@#$", 0)).toBe("portfolio:evidence:cap-ability-:id---:0");
  });

  it("is a pure function of its inputs: same inputs always produce the same id", () => {
    expect(portfolioProductId("governance-cli")).toBe(portfolioProductId("governance-cli"));
    expect(portfolioCapabilityId("widget-sync")).toBe(portfolioCapabilityId("widget-sync"));
    expect(portfolioClaimId("identity", "x")).toBe(portfolioClaimId("identity", "x"));
    expect(portfolioDecisionId("ownership", "x")).toBe(portfolioDecisionId("ownership", "x"));
  });

  describe("portfolioRelationshipId (sorts its pair argument internally)", () => {
    it("is deterministic for the same input", () => {
      expect(portfolioRelationshipId("portfolio:product:alpha", "portfolio:product:beta", "shared_capability")).toBe(
        portfolioRelationshipId("portfolio:product:alpha", "portfolio:product:beta", "shared_capability"),
      );
    });

    it("produces the same id regardless of productAId/productBId argument order", () => {
      const forward = portfolioRelationshipId("portfolio:product:alpha", "portfolio:product:beta", "shared_capability");
      const reversed = portfolioRelationshipId("portfolio:product:beta", "portfolio:product:alpha", "shared_capability");
      expect(forward).toBe(reversed);
      expect(forward).toBe("portfolio:relationship:shared_capability:portfolio-product-alpha:portfolio-product-beta");
    });
  });

  describe("portfolioDependencyEdgeId (directional — does not sort its endpoints)", () => {
    it("is deterministic for the same input", () => {
      expect(portfolioDependencyEdgeId("produces", "portfolio:product:alpha", "portfolio:node:product:beta")).toBe(
        portfolioDependencyEdgeId("produces", "portfolio:product:alpha", "portfolio:node:product:beta"),
      );
    });

    it("produces a DIFFERENT id when sourceProductId and targetId are swapped, preserving edge direction", () => {
      const forward = portfolioDependencyEdgeId("produces", "portfolio:product:alpha", "portfolio:node:product:beta");
      const reversed = portfolioDependencyEdgeId("produces", "portfolio:node:product:beta", "portfolio:product:alpha");
      expect(forward).not.toBe(reversed);
      expect(forward).toBe("portfolio:edge:produces:portfolio-product-alpha:portfolio-node-product-beta");
    });
  });
});
