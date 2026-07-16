import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "@rvs/core";
import { describe, expect, it } from "vitest";
import { buildEvidenceManifest } from "../evidence.js";
import { buildRepositoryModel } from "../repository-model.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(here, "../../../../examples/fixture-repo");

describe("buildRepositoryModel", () => {
  it("scans the fixture repo and detects its tech stack, docs, and CI", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);

    expect(model.tech_stack.primaryLanguage).toBe("TypeScript");
    expect(model.tech_stack.manifestFile).toBe("package.json");
    expect(model.tech_stack.frameworks).toContain("zod");

    expect(model.ci_workflows).toHaveLength(1);
    expect(model.ci_workflows[0].path).toBe(".github/workflows/deploy.yml");

    expect(model.markdown_documents).toHaveLength(1);
    const readme = model.markdown_documents[0];
    expect(readme.title).toBe("Order Service");
    const headings = readme.sections.map((s) => s.heading);
    expect(headings).toEqual(["Architecture", "Deployment", "Testing"]);
  });
});

describe("buildEvidenceManifest", () => {
  it("produces source-traceable claims for markdown sections, tech stack, and CI", async () => {
    const config = defaultConfig("order-service");
    const model = await buildRepositoryModel(fixtureRepo, config);
    const manifest = buildEvidenceManifest(model);

    const deploymentClaim = manifest.claims.find((c) => c.claim.startsWith("Deployment:"));
    expect(deploymentClaim).toBeDefined();
    expect(deploymentClaim?.sources[0]).toEqual({ path: "README.md", lines: expect.any(String) });
    expect(deploymentClaim?.confidence).toBe("confirmed");

    const languageClaim = manifest.claims.find((c) => c.claim.startsWith("Primary language"));
    expect(languageClaim?.sources[0]).toEqual({ path: "package.json" });

    const ciClaim = manifest.claims.find((c) => c.claim.includes("GitHub Actions"));
    expect(ciClaim?.sources[0]).toEqual({ path: ".github/workflows/deploy.yml" });
  });
});
