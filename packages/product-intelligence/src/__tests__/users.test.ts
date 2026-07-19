import { describe, expect, it } from "vitest";
import { deriveUsers } from "../users.js";
import { makeActor, makeArchitectureFixture, makeCapability, makeEmptyCapabilityModel } from "./fixtures.js";

describe("deriveUsers", () => {
  it("weights a human-role Actor at 3 points", () => {
    const arch = makeArchitectureFixture({ actors: [makeActor("Compliance Officer", "human-role")] });
    const { primaryUsers } = deriveUsers(makeEmptyCapabilityModel(), arch);
    expect(primaryUsers).toEqual(["Compliance Officer"]);
  });

  it("ignores non-human-role actors entirely (e.g. external-service, system)", () => {
    const arch = makeArchitectureFixture({ actors: [makeActor("External Auditing Service", "external-service")] });
    const { primaryUsers, secondaryUsers } = deriveUsers(makeEmptyCapabilityModel(), arch);
    expect(primaryUsers).toEqual([]);
    expect(secondaryUsers).toEqual([]);
  });

  it("weights an included capability's actor mentions at 2 points and a qualified capability's at 1 point", () => {
    const included = makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include", actors: ["Platform Operator"] });
    const qualified = makeCapability({ sourceLabel: "Widget Report Export", inclusion: "include_with_qualification", actors: ["Analyst"] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [included], qualifiedCapabilities: [qualified] });

    const { primaryUsers } = deriveUsers(model, makeArchitectureFixture());
    // "Platform Operator" (weight 2) outranks "Analyst" (weight 1).
    expect(primaryUsers).toEqual(["Platform Operator", "Analyst"]);
  });

  it("sums weights across multiple sources for the same user label", () => {
    const arch = makeArchitectureFixture({ actors: [makeActor("Compliance Officer", "human-role")] });
    const cap = makeCapability({ sourceLabel: "Widget Sync Service", inclusion: "include", actors: ["Compliance Officer"] });
    const model = makeEmptyCapabilityModel({ includedCapabilities: [cap] });

    const { primaryUsers } = deriveUsers(model, arch);
    // Human-role Actor (3) + included-capability actor mention (2) = 5, still ranked first and only once.
    expect(primaryUsers).toEqual(["Compliance Officer"]);
  });

  it("never derives users from AudienceType or any showcase-facing concept — only Actors and capability.actors are read", () => {
    // There is no AudienceType parameter on deriveUsers at all; this is
    // structurally guaranteed by its signature (model, arch) -> users.
    expect(deriveUsers.length).toBe(2);
  });

  it("breaks a tied weight alphabetically by label", () => {
    const arch = makeArchitectureFixture({ actors: [makeActor("Zeta Role", "human-role"), makeActor("Alpha Role", "human-role")] });
    const { primaryUsers } = deriveUsers(makeEmptyCapabilityModel(), arch);
    expect(primaryUsers).toEqual(["Alpha Role", "Zeta Role"]);
  });

  it("caps primaryUsers at 3 and secondaryUsers at the next 4 (slots 4-7)", () => {
    // Note: "Role B".."Role H" are used deliberately (not "Role A") — normalizeLabel
    // lowercases single-letter words that collide with English articles/prepositions
    // (e.g. the standalone word "A" is treated as the indefinite article "a" and
    // lowercased), so "Role A" would normalize to "Role a", not "Role A".
    const actors = ["Role B", "Role C", "Role D", "Role E", "Role F", "Role G", "Role H", "Role I"].map((n) => makeActor(n, "human-role"));
    const arch = makeArchitectureFixture({ actors });
    const { primaryUsers, secondaryUsers } = deriveUsers(makeEmptyCapabilityModel(), arch);
    expect(primaryUsers).toHaveLength(3);
    expect(secondaryUsers).toHaveLength(4);
    expect(primaryUsers).toEqual(["Role B", "Role C", "Role D"]);
    expect(secondaryUsers).toEqual(["Role E", "Role F", "Role G", "Role H"]);
  });

  it("is deterministic: two derivations of the same input produce identical output", () => {
    const arch = makeArchitectureFixture({ actors: [makeActor("Compliance Officer", "human-role")] });
    const model = makeEmptyCapabilityModel();
    const a = deriveUsers(model, arch);
    const b = deriveUsers(model, arch);
    expect(a).toEqual(b);
  });
});
