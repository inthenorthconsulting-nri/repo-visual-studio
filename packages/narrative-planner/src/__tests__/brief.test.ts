import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "@rvs/core";
import { buildEvidenceManifest, buildRepositoryModel } from "@rvs/repository-model";
import { describe, expect, it } from "vitest";
import { buildNarrativeBrief } from "../brief.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(here, "../../../../examples/fixture-repo");

describe("buildNarrativeBrief", () => {
  it("builds a deterministic executive brief with a decision section", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);

    const brief = buildNarrativeBrief(model, evidence, "executive");

    expect(brief.title).toBe("order-service");
    expect(brief.sections.map((s) => s.id)).toEqual(["context", "target_state", "status", "decision"]);
    expect(brief.core_message).toContain("accepts customer orders");
    const status = brief.sections.find((s) => s.id === "status");
    expect(status?.text).toContain("contributor(s)");
  });

  it("builds an architecture-review brief without a decision section", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const evidence = buildEvidenceManifest(model);

    const brief = buildNarrativeBrief(model, evidence, "architecture-review");

    expect(brief.decision_required).toBe(false);
    expect(brief.sections.map((s) => s.id)).toEqual(["context", "architecture", "status"]);
  });
});
