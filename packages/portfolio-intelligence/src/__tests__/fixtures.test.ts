import { describe, expect, it } from "vitest";
import { makeCapability, makeCapabilityModel, makePortfolioConfig, makePortfolioProduct, makeProductIdentityModel } from "./fixtures.js";

describe("fixtures", () => {
  it("build structurally valid baseline objects", () => {
    expect(makeCapability().id).toBeTruthy();
    expect(makeCapabilityModel().includedCapabilities.length).toBe(1);
    expect(makeProductIdentityModel().identity.displayName).toBe("Widget Platform");
    expect(makePortfolioProduct().id).toBe("portfolio:product:governance-cli");
    expect(makePortfolioConfig().products.length).toBe(1);
  });
});
