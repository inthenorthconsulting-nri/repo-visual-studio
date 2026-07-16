import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWorkflowText } from "../parse-workflow.js";
import { buildRepositoryIndex } from "../repository-index.js";

function loadFixture(name: string): string {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

describe("buildRepositoryIndex", () => {
  it("summarizes multiple parsed workflows, sorted by source path", () => {
    const a = parseWorkflowText(loadFixture("linear-chain.yml"), ".github/workflows/linear-chain.yml");
    const b = parseWorkflowText(loadFixture("single-job.yml"), ".github/workflows/single-job.yml");
    const index = buildRepositoryIndex([b, a], "2026-07-16T00:00:00.000Z");

    expect(index.generated_at).toBe("2026-07-16T00:00:00.000Z");
    expect(index.workflows.map((w) => w.sourcePath)).toEqual([
      ".github/workflows/linear-chain.yml",
      ".github/workflows/single-job.yml",
    ]);
    expect(index.workflows[0]).toMatchObject({ id: "workflow:Linear-Chain", jobCount: 3, triggerCount: 1, warningCount: 0 });
    expect(index.workflows[1]).toMatchObject({ id: "workflow:Single-Job", jobCount: 1, triggerCount: 1, warningCount: 0 });
  });

  it("is deterministic regardless of input order", () => {
    const a = parseWorkflowText(loadFixture("linear-chain.yml"), ".github/workflows/linear-chain.yml");
    const b = parseWorkflowText(loadFixture("single-job.yml"), ".github/workflows/single-job.yml");
    const first = buildRepositoryIndex([a, b], "2026-07-16T00:00:00.000Z");
    const second = buildRepositoryIndex([b, a], "2026-07-16T00:00:00.000Z");
    expect(first).toEqual(second);
  });

  it("carries the warning count from unresolved needs references", () => {
    const invalid = parseWorkflowText(loadFixture("invalid-needs.yml"), ".github/workflows/invalid-needs.yml");
    const index = buildRepositoryIndex([invalid], "2026-07-16T00:00:00.000Z");
    expect(index.workflows[0]?.warningCount).toBe(1);
  });
});
