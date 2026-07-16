import { describe, expect, it } from "vitest";
import { approvalId, edgeId, environmentId, jobId, reusableWorkflowId, stepId, triggerId, workflowId } from "../ids.js";

describe("deterministic ID scheme", () => {
  it("produces stable, human-readable IDs for well-formed names", () => {
    const wf = workflowId("CI");
    expect(wf).toBe("workflow:CI");
    expect(triggerId(wf, "push")).toBe("trigger:push@workflow:CI");
    const job = jobId(wf, "build");
    expect(job).toBe("job:workflow:CI:build");
    expect(stepId(job, 3)).toBe("step:job:workflow:CI:build:3");
    expect(stepId(job, 3, "run-tests")).toBe("step:job:workflow:CI:build:3:run-tests");
    expect(reusableWorkflowId(wf, "call-shared")).toBe("reusable-workflow:workflow:CI:call-shared");
    expect(environmentId(wf, "production")).toBe("environment:production@workflow:CI");
    expect(approvalId(job)).toBe(`approval:${job}`);
    expect(edgeId("needs", "job:a", "job:b")).toBe("edge:job:a->job:b:needs");
  });

  it("sanitizes non-alphanumeric characters consistently", () => {
    const wf = workflowId("My Workflow / v2!");
    expect(wf).toMatch(/^workflow:[a-zA-Z0-9_.-]+$/);
    expect(wf).toBe(workflowId("My Workflow / v2!"));
  });

  it("is a pure function of its inputs, independent of call order", () => {
    const a = jobId(workflowId("CI"), "test");
    const b = jobId(workflowId("CI"), "test");
    expect(a).toBe(b);
  });
});
