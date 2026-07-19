import { describe, expect, it } from "vitest";
import type { PortfolioRelationshipConfidence } from "../contracts.js";
import { classifyOverlapSeverity, detectOverlaps } from "../overlaps.js";
import { makePortfolioCapability, makePortfolioCapabilityParticipation } from "./fixtures.js";

describe("classifyOverlapSeverity", () => {
  it("returns informational for unresolved confidence regardless of participant count", () => {
    expect(classifyOverlapSeverity(2, "unresolved")).toBe("informational");
    expect(classifyOverlapSeverity(5, "unresolved")).toBe("informational");
  });

  it("returns strategic when participantCount >= 4 (any non-unresolved confidence)", () => {
    expect(classifyOverlapSeverity(4, "derived")).toBe("strategic");
    expect(classifyOverlapSeverity(10, "suggested")).toBe("strategic");
    expect(classifyOverlapSeverity(4, "confirmed")).toBe("strategic");
  });

  it("returns material when participantCount === 3 (any non-unresolved confidence)", () => {
    expect(classifyOverlapSeverity(3, "suggested")).toBe("material");
    expect(classifyOverlapSeverity(3, "confirmed")).toBe("material");
    expect(classifyOverlapSeverity(3, "derived")).toBe("material");
  });

  it("returns minor for confirmed confidence with fewer than 3 participants", () => {
    expect(classifyOverlapSeverity(2, "confirmed")).toBe("minor");
    expect(classifyOverlapSeverity(1, "confirmed")).toBe("minor");
  });

  it("falls back to informational for non-confirmed confidence with fewer than 3 participants", () => {
    expect(classifyOverlapSeverity(2, "derived")).toBe("informational");
    expect(classifyOverlapSeverity(2, "suggested")).toBe("informational");
    const other: PortfolioRelationshipConfidence = "suggested";
    expect(classifyOverlapSeverity(1, other)).toBe("informational");
  });
});

describe("detectOverlaps", () => {
  it("escalates a shared-coverage capability with unresolved ownership (2+ fully-current participants) into an overlap and reclassifies coverage to overlapping", () => {
    const capability = makePortfolioCapability({
      id: "portfolio:capability:widget-sync",
      displayName: "Widget Sync",
      coverage: "shared",
      confidence: "confirmed",
      evidenceIds: ["portfolio:evidence:capability:a:0", "portfolio:evidence:capability:b:0"],
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: false }),
      ],
    });

    const result = detectOverlaps([capability]);

    expect(result.overlaps).toHaveLength(1);
    const overlap = result.overlaps[0]!;
    expect(overlap.capabilityId).toBe(capability.id);
    expect(overlap.productIds).toEqual(["portfolio:product:a", "portfolio:product:b"]);
    expect(overlap.ownershipResolved).toBe(false);
    expect(overlap.severity).toBe("minor"); // 2 participants, confirmed confidence
    expect(overlap.evidenceIds).toEqual(capability.evidenceIds);

    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]!.coverage).toBe("overlapping");
  });

  it("does not create an overlap for a shared-coverage capability with exactly one fully-current participant, and coverage stays shared", () => {
    const capability = makePortfolioCapability({
      coverage: "shared",
      confidence: "confirmed",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: true }),
      ],
    });

    const result = detectOverlaps([capability]);

    expect(result.overlaps).toEqual([]);
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]!.coverage).toBe("shared");
    expect(result.capabilities[0]).toEqual(capability);
  });

  it("leaves single_product-coverage capabilities untouched and produces no overlap", () => {
    const capability = makePortfolioCapability({ coverage: "single_product" });
    const result = detectOverlaps([capability]);
    expect(result.overlaps).toEqual([]);
    expect(result.capabilities).toEqual([capability]);
  });

  it("sorts overlaps by id", () => {
    const capabilityB = makePortfolioCapability({
      id: "portfolio:capability:zzz-second",
      coverage: "shared",
      confidence: "confirmed",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: false }),
      ],
    });
    const capabilityA = makePortfolioCapability({
      id: "portfolio:capability:aaa-first",
      coverage: "shared",
      confidence: "confirmed",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:c", qualified: false }),
      ],
    });

    const result = detectOverlaps([capabilityB, capabilityA]);
    expect(result.overlaps.map((o) => o.capabilityId)).toEqual([capabilityA.id, capabilityB.id]);
  });
});
