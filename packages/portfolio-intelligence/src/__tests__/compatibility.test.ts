import { CAPABILITY_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/capability-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { PRODUCT_INTELLIGENCE_SCHEMA_VERSION } from "@rvs/product-intelligence";
import type { ProductIdentityModel } from "@rvs/product-intelligence";
import { describe, expect, it } from "vitest";
import { assessCompatibility } from "../compatibility.js";
import { GENERATED_AT, makeCapabilityModel, makeProductIdentityModel } from "./fixtures.js";

/** A self-consistent product-identity + capability-model pair: the identity's currentCapabilities references the capability model's only included capability id, and source_capability_model_generated_at matches the capability model's generated_at. */
function makeCompatiblePair(): { productIdentity: ProductIdentityModel; capabilityModel: CapabilityModel } {
  const capabilityModel = makeCapabilityModel();
  const productIdentity = makeProductIdentityModel();
  return { productIdentity, capabilityModel };
}

describe("assessCompatibility", () => {
  it("returns missing_required_artifact when productIdentity is absent", () => {
    const { capabilityModel } = makeCompatiblePair();
    const { status, issues } = assessCompatibility({ capabilityModel });
    expect(status).toBe("missing_required_artifact");
    expect(issues).toContainEqual(expect.objectContaining({ code: "required-input-missing", artifact: "product-identity.json" }));
  });

  it("returns missing_required_artifact when capabilityModel is absent", () => {
    const { productIdentity } = makeCompatiblePair();
    const { status, issues } = assessCompatibility({ productIdentity });
    expect(status).toBe("missing_required_artifact");
    expect(issues).toContainEqual(expect.objectContaining({ code: "required-input-missing", artifact: "capability-model.json" }));
  });

  it("returns missing_required_artifact with both issues when neither artifact is present", () => {
    const { status, issues } = assessCompatibility({});
    expect(status).toBe("missing_required_artifact");
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.artifact).sort()).toEqual(["capability-model.json", "product-identity.json"]);
  });

  it("returns unsupported_schema when product-identity.json has the wrong schema version", () => {
    const { productIdentity, capabilityModel } = makeCompatiblePair();
    const badIdentity = { ...productIdentity, schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION + 1 };
    const { status, issues } = assessCompatibility({ productIdentity: badIdentity, capabilityModel });
    expect(status).toBe("unsupported_schema");
    expect(issues).toContainEqual(expect.objectContaining({ code: "input-generated-by-unsupported-schema-version", artifact: "product-identity.json" }));
  });

  it("returns unsupported_schema when capability-model.json has the wrong schema version", () => {
    const { productIdentity, capabilityModel } = makeCompatiblePair();
    const badCapabilityModel = { ...capabilityModel, schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION + 1 };
    const { status, issues } = assessCompatibility({ productIdentity, capabilityModel: badCapabilityModel });
    expect(status).toBe("unsupported_schema");
    expect(issues).toContainEqual(expect.objectContaining({ code: "input-generated-by-unsupported-schema-version", artifact: "capability-model.json" }));
  });

  it("returns unsupported_schema (not identity_mismatch/stale) when both artifacts have wrong schema versions", () => {
    const { productIdentity, capabilityModel } = makeCompatiblePair();
    const badIdentity = { ...productIdentity, schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION + 1 };
    const badCapabilityModel = { ...capabilityModel, schemaVersion: CAPABILITY_INTELLIGENCE_SCHEMA_VERSION + 1 };
    const { status, issues } = assessCompatibility({ productIdentity: badIdentity, capabilityModel: badCapabilityModel });
    expect(status).toBe("unsupported_schema");
    expect(issues).toHaveLength(2);
  });

  it("returns identity_mismatch when the identity's capability ids share nothing with the capability model's included/qualified ids", () => {
    const { capabilityModel } = makeCompatiblePair();
    const mismatchedIdentity = makeProductIdentityModel({}, { currentCapabilities: ["capintel:capability:unrelated-thing"], qualifiedCapabilities: [] });
    const { status, issues } = assessCompatibility({ productIdentity: mismatchedIdentity, capabilityModel });
    expect(status).toBe("identity_mismatch");
    expect(issues).toContainEqual(expect.objectContaining({ code: "input-incompatible", artifact: "product-identity.json" }));
  });

  it("does not flag identity_mismatch when the identity's qualifiedCapabilities (not currentCapabilities) intersects the capability model", () => {
    const capabilityModel = makeCapabilityModel({ qualifiedCapabilities: [{ ...makeCapabilityModel().includedCapabilities[0]!, id: "capintel:capability:qualified-thing" }] });
    const identity = makeProductIdentityModel({}, { currentCapabilities: [], qualifiedCapabilities: ["capintel:capability:qualified-thing"] });
    const { status } = assessCompatibility({ productIdentity: identity, capabilityModel });
    expect(status).toBe("compatible");
  });

  it("returns stale_artifact_set when the identity's source_capability_model_generated_at does not match the capability model's generated_at", () => {
    const { productIdentity, capabilityModel } = makeCompatiblePair();
    const staleIdentity = { ...productIdentity, generationMetadata: { ...productIdentity.generationMetadata, source_capability_model_generated_at: "2020-01-01T00:00:00.000Z" } };
    const { status, issues } = assessCompatibility({ productIdentity: staleIdentity, capabilityModel });
    expect(status).toBe("stale_artifact_set");
    expect(issues).toContainEqual(expect.objectContaining({ code: "input-stale", artifact: "product-identity.json" }));
  });

  it("returns compatible with zero issues for a fully self-consistent product-identity + capability-model pair", () => {
    const { productIdentity, capabilityModel } = makeCompatiblePair();
    expect(productIdentity.identity.currentCapabilities).toContain(capabilityModel.includedCapabilities[0]!.id);
    expect(productIdentity.generationMetadata.source_capability_model_generated_at).toBe(capabilityModel.generationMetadata.generated_at);
    expect(capabilityModel.generationMetadata.generated_at).toBe(GENERATED_AT);

    const { status, issues } = assessCompatibility({ productIdentity, capabilityModel });
    expect(status).toBe("compatible");
    expect(issues).toEqual([]);
  });
});
