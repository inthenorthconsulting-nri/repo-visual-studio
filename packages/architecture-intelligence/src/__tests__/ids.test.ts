import { describe, expect, it } from "vitest";
import { actorId, componentId, flowId, workflowFamilyId } from "../ids.js";

describe("ids", () => {
  it("is a pure function of its inputs (same inputs -> same id)", () => {
    expect(workflowFamilyId("Governance")).toBe(workflowFamilyId("Governance"));
    expect(componentId("packages/cli")).toBe(componentId("packages/cli"));
  });

  it("sanitizes unsafe characters", () => {
    expect(actorId("Approver (release manager)")).toBe("arch:actor:Approver--release-manager-");
  });

  it("produces distinct ids for distinct inputs", () => {
    expect(workflowFamilyId("Governance")).not.toBe(workflowFamilyId("Onboarding"));
  });

  it("composes flow ids from kind + endpoints so distinct flows never collide", () => {
    const a = flowId("approval", "arch:actor:approver", "arch:component:release");
    const b = flowId("trigger", "arch:actor:approver", "arch:component:release");
    expect(a).not.toBe(b);
  });
});
