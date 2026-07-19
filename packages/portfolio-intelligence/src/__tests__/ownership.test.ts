import { describe, expect, it } from "vitest";
import type { PortfolioProductRole } from "../contracts.js";
import { defaultDecisionOwnerType, isOwnershipResolved } from "../ownership.js";
import { makePortfolioCapability, makePortfolioCapabilityParticipation } from "./fixtures.js";

describe("isOwnershipResolved", () => {
  it("single_product coverage is always resolved, regardless of participation shape", () => {
    const capability = makePortfolioCapability({
      coverage: "single_product",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: false }),
      ],
    });
    expect(isOwnershipResolved(capability)).toBe(true);
  });

  it("shared coverage with exactly one non-qualified participant is resolved", () => {
    const capability = makePortfolioCapability({
      coverage: "shared",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: true }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:c", qualified: true }),
      ],
    });
    expect(isOwnershipResolved(capability)).toBe(true);
  });

  it("shared coverage with zero non-qualified participants is NOT resolved", () => {
    const capability = makePortfolioCapability({
      coverage: "shared",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: true }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: true }),
      ],
    });
    expect(isOwnershipResolved(capability)).toBe(false);
  });

  it("shared coverage with two or more non-qualified participants is NOT resolved", () => {
    const capability = makePortfolioCapability({
      coverage: "shared",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: false }),
      ],
    });
    expect(isOwnershipResolved(capability)).toBe(false);
  });

  it("overlapping coverage follows the same one-non-qualified-participant rule as shared", () => {
    const resolved = makePortfolioCapability({
      coverage: "overlapping",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: true }),
      ],
    });
    expect(isOwnershipResolved(resolved)).toBe(true);

    const unresolved = makePortfolioCapability({
      coverage: "overlapping",
      participation: [
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:a", qualified: false }),
        makePortfolioCapabilityParticipation({ productId: "portfolio:product:b", qualified: false }),
      ],
    });
    expect(isOwnershipResolved(unresolved)).toBe(false);
  });
});

describe("defaultDecisionOwnerType", () => {
  it.each<[PortfolioProductRole, ReturnType<typeof defaultDecisionOwnerType>]>([
    ["control_plane", "architecture_council"],
    ["governance_system", "platform_leadership"],
    ["operations_system", "operations_owner"],
    ["developer_tool", "product_owner"],
    ["reliability_system", "operations_owner"],
    ["migration_system", "architecture_council"],
    ["metadata_system", "architecture_council"],
    ["presentation_system", "product_owner"],
    ["integration_layer", "architecture_council"],
    ["shared_library", "architecture_council"],
    ["domain_product", "product_owner"],
    ["unknown", "platform_leadership"],
  ])("maps role %s to owner type %s", (role, expected) => {
    expect(defaultDecisionOwnerType(role)).toBe(expected);
  });
});
