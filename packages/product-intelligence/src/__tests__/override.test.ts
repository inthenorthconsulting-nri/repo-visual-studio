import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProductIdentityOverride, productOverridePath, ProductIdentityOverrideSchema, validateProductIdentityOverride } from "../override.js";

describe("ProductIdentityOverrideSchema", () => {
  it("parses a minimal valid override with only schema_version", () => {
    const result = ProductIdentityOverrideSchema.parse({ schema_version: 1 });
    expect(result.schema_version).toBe(1);
  });

  it("parses a fully populated valid override", () => {
    const raw = {
      schema_version: 1,
      display_name: "Widget Platform",
      descriptor_override: "Governance platform",
      purpose_override: "Governs widget operations for compliance teams across environments.",
      primary_users: ["Compliance Officer", "Platform Operator"],
      approved_terms: ["governed"],
      disallowed_terms: ["seamless"],
      runtime_claims: ["Adopted by 40 internal teams."],
    };
    const result = ProductIdentityOverrideSchema.parse(raw);
    expect(result).toEqual(raw);
  });

  it("rejects a schema_version other than 1", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 2 })).toThrow();
  });

  it("rejects display_name longer than 80 characters", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 1, display_name: "x".repeat(81) })).toThrow();
  });

  it("rejects descriptor_override longer than 120 characters", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 1, descriptor_override: "x".repeat(121) })).toThrow();
  });

  it("rejects purpose_override longer than 400 characters", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 1, purpose_override: "x".repeat(401) })).toThrow();
  });

  it("rejects more than 3 primary_users", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 1, primary_users: ["a", "b", "c", "d"] })).toThrow();
  });

  it("rejects an empty-string display_name", () => {
    expect(() => ProductIdentityOverrideSchema.parse({ schema_version: 1, display_name: "" })).toThrow();
  });
});

describe("validateProductIdentityOverride", () => {
  it("returns no errors for a clean override with no text fields set", () => {
    expect(validateProductIdentityOverride({ schema_version: 1 })).toEqual([]);
  });

  it("returns no errors when display_name/descriptor_override/purpose_override contain no marketing or absolute language", () => {
    const errors = validateProductIdentityOverride({
      schema_version: 1,
      display_name: "Widget Platform",
      descriptor_override: "Governance platform",
      purpose_override: "Governs widget operations for compliance teams.",
    });
    expect(errors).toEqual([]);
  });

  it("flags generic marketing language in display_name", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, display_name: "AI-Powered Widget Platform" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("display_name");
    expect(errors[0]!.message).toContain("ai-powered");
  });

  it("flags absolute superiority language in descriptor_override", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, descriptor_override: "The only governance platform" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("descriptor_override");
    expect(errors[0]!.message).toContain("the only");
  });

  it("flags both a marketing term and an absolute term in the same field as two separate errors", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, purpose_override: "The only next-generation governance platform for compliance teams." });
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.field)).toEqual(["purpose_override", "purpose_override"]);
  });

  it("approved_terms lifts a marketing-language error for a human-cleared term", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, display_name: "AI-Powered Widget Platform", approved_terms: ["ai-powered"] });
    expect(errors).toEqual([]);
  });

  it("approved_terms lifts an absolute-superiority error for a human-cleared term", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, descriptor_override: "The only governance platform", approved_terms: ["the only"] });
    expect(errors).toEqual([]);
  });

  it("approved_terms does not lift an error for an unapproved term in the same field", () => {
    const errors = validateProductIdentityOverride({ schema_version: 1, display_name: "Revolutionary Widget Platform", approved_terms: ["ai-powered"] });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("revolutionary");
  });

  it("checks all three text fields independently", () => {
    const errors = validateProductIdentityOverride({
      schema_version: 1,
      display_name: "Revolutionary Widget Platform",
      descriptor_override: "Cutting-edge governance platform",
      purpose_override: "Governs widget operations for compliance teams.",
    });
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.field).sort()).toEqual(["descriptor_override", "display_name"]);
  });
});

describe("productOverridePath", () => {
  it("resolves to <repoRoot>/.rvs/product.yml", () => {
    expect(productOverridePath("/repo")).toBe(join("/repo", ".rvs", "product.yml"));
  });
});

describe("loadProductIdentityOverride", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-product-override-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns undefined when no .rvs/product.yml file exists — optionality is load-bearing, not an error", () => {
    expect(loadProductIdentityOverride(repoRoot)).toBeUndefined();
  });

  it("returns the parsed override when a valid .rvs/product.yml file exists", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(join(repoRoot, ".rvs", "product.yml"), "schema_version: 1\ndisplay_name: Widget Platform\n", "utf8");
    const override = loadProductIdentityOverride(repoRoot);
    expect(override).toEqual({ schema_version: 1, display_name: "Widget Platform" });
  });

  it("throws when the file is schema-valid YAML but fails content validation (marketing language)", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(join(repoRoot, ".rvs", "product.yml"), "schema_version: 1\ndisplay_name: AI-Powered Widget Platform\n", "utf8");
    expect(() => loadProductIdentityOverride(repoRoot)).toThrow(/Invalid \.rvs\/product\.yml/);
  });

  it("throws when the file fails schema parsing entirely (bad schema_version)", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(join(repoRoot, ".rvs", "product.yml"), "schema_version: 2\n", "utf8");
    expect(() => loadProductIdentityOverride(repoRoot)).toThrow();
  });

  it("applies overrideApplied-triggering fields correctly when fully valid, including runtime_claims", () => {
    mkdirSync(join(repoRoot, ".rvs"), { recursive: true });
    writeFileSync(
      join(repoRoot, ".rvs", "product.yml"),
      "schema_version: 1\ndisplay_name: Widget Platform\nruntime_claims:\n  - Adopted by 40 internal teams.\n",
      "utf8",
    );
    const override = loadProductIdentityOverride(repoRoot);
    expect(override?.runtime_claims).toEqual(["Adopted by 40 internal teams."]);
  });
});
