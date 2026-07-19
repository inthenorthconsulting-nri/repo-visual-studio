import { describe, expect, it } from "vitest";
import type { PortfolioProduct, PortfolioProductRole } from "../contracts.js";
import { buildOperatingModel } from "../operating-model.js";
import { makeCapabilityDomain, makeCapabilityModel, makePortfolioProduct } from "./fixtures.js";

function product(configId: string, role: PortfolioProductRole, overrides: Partial<PortfolioProduct> = {}): PortfolioProduct {
  return makePortfolioProduct({ source: { configId, artifactRoot: `./${configId}`, compatibility: "compatible" }, primaryRole: role, ...overrides });
}

describe("buildOperatingModel", () => {
  // -------------------------------------------------------------------------
  // ROLE_STAGE table — spot-check several distinct role -> stage mappings.
  // -------------------------------------------------------------------------
  it("maps governance_system to the govern stage", () => {
    const p = product("governance-cli", "governance_system");
    const model = buildOperatingModel([p], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["govern"]);
    expect(model.stages[0]!.productIds).toEqual([p.id]);
  });

  it("maps developer_tool to the build stage", () => {
    const p = product("dev-tool", "developer_tool");
    const model = buildOperatingModel([p], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["build"]);
  });

  it("maps migration_system to the promote stage", () => {
    const p = product("migrator", "migration_system");
    const model = buildOperatingModel([p], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["promote"]);
  });

  it("maps metadata_system to the observe stage", () => {
    const p = product("metadata-svc", "metadata_system");
    const model = buildOperatingModel([p], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["observe"]);
  });

  it("maps presentation_system to the plan stage", () => {
    const p = product("showcase-ui", "presentation_system");
    const model = buildOperatingModel([p], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["plan"]);
  });

  it("maps control_plane, shared_library, and integration_layer to govern/build/build respectively", () => {
    const control = product("control", "control_plane");
    const shared = product("shared-lib", "shared_library");
    const integration = product("integration", "integration_layer");
    const model = buildOperatingModel([control, shared, integration], new Map(), new Map());
    const stageByProductId = new Map(model.stages.flatMap((s) => s.productIds.map((id) => [id, s.stage] as const)));
    expect(stageByProductId.get(control.id)).toBe("govern");
    expect(stageByProductId.get(shared.id)).toBe("build");
    expect(stageByProductId.get(integration.id)).toBe("build");
  });

  // -------------------------------------------------------------------------
  // Roles with no ROLE_STAGE entry (and not the special-cased
  // reliability_system) land in unassignedProductIds.
  // -------------------------------------------------------------------------
  it("puts a product whose role has no stage mapping into unassignedProductIds", () => {
    const unknownProduct = product("mystery", "unknown");
    const model = buildOperatingModel([unknownProduct], new Map(), new Map());
    expect(model.unassignedProductIds).toEqual([unknownProduct.id]);
    expect(model.stages).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // reliability_system is classified via domain keyword signal rather than
  // the static ROLE_STAGE table.
  // -------------------------------------------------------------------------
  it("classifies reliability_system as validate by default, and observe when the product's capability domains suggest observability", () => {
    const validateProduct = product("validator", "reliability_system");
    const observeProduct = product("watchdog", "reliability_system");
    const observeModel = makeCapabilityModel({ domains: [makeCapabilityDomain({ sourceLabel: "Monitoring", id: "capintel:domain:monitoring" })] });
    const capabilityModelsByProductId = new Map([[observeProduct.id, observeModel]]);

    const model = buildOperatingModel([validateProduct, observeProduct], capabilityModelsByProductId, new Map());
    const stageByProductId = new Map(model.stages.flatMap((s) => s.productIds.map((id) => [id, s.stage] as const)));
    expect(stageByProductId.get(validateProduct.id)).toBe("validate");
    expect(stageByProductId.get(observeProduct.id)).toBe("observe");
  });

  // -------------------------------------------------------------------------
  // Every stage assignment and every transition is always inferred: true.
  // -------------------------------------------------------------------------
  it("marks every stage assignment and every transition as inferred: true", () => {
    const p1 = product("dev-tool", "developer_tool");
    const p2 = product("presentation", "presentation_system");
    const model = buildOperatingModel([p1, p2], new Map(), new Map());
    expect(model.stages.length).toBeGreaterThan(0);
    for (const stage of model.stages) expect(stage.inferred).toBe(true);
    expect(model.transitions.length).toBeGreaterThan(0);
    for (const transition of model.transitions) expect(transition.inferred).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Transitions only connect two ADJACENT stages (per STAGE_ORDER: plan,
  // build, validate, govern, promote, operate, observe, improve) that both
  // have at least one assigned product — never a transition that skips an
  // empty intermediate stage.
  // -------------------------------------------------------------------------
  it("emits a transition only between adjacent occupied stages, never skipping an empty intermediate stage", () => {
    // plan (presentation_system), build (developer_tool), govern (governance_system) are occupied;
    // validate and promote are not. plan->build is adjacent and both occupied: transition expected.
    // build->validate: validate empty, no transition. validate->govern: validate empty, no transition.
    // So despite both "build" and "govern" being occupied, no build->govern transition is ever emitted
    // (they are not adjacent in STAGE_ORDER).
    const planProduct = product("showcase-ui", "presentation_system");
    const buildProduct = product("dev-tool", "developer_tool");
    const governProduct = product("governance-cli", "governance_system");

    const model = buildOperatingModel([planProduct, buildProduct, governProduct], new Map(), new Map());

    expect(model.stages.map((s) => s.stage)).toEqual(["plan", "build", "govern"]);
    expect(model.transitions).toHaveLength(1);
    expect(model.transitions[0]!.fromStage).toBe("plan");
    expect(model.transitions[0]!.toStage).toBe("build");
  });

  it("emits transitions for every adjacent pair when three consecutive stages are all occupied", () => {
    const buildProduct = product("dev-tool", "developer_tool");
    const validateProduct = product("validator", "reliability_system");
    const governProduct = product("governance-cli", "governance_system");

    const model = buildOperatingModel([buildProduct, validateProduct, governProduct], new Map(), new Map());
    expect(model.stages.map((s) => s.stage)).toEqual(["build", "validate", "govern"]);
    const pairs = model.transitions.map((t) => `${t.fromStage}->${t.toStage}`);
    expect(pairs).toEqual(["build->validate", "validate->govern"]);
  });
});
