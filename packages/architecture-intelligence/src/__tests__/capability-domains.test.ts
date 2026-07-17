import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { synthesizeArchitectureIntelligence } from "../synthesize/index.js";
import { makeRepositoryModel } from "./fixtures.js";

// One workflow per fine-grained family (see workflow-families.ts FAMILY_RULES),
// chosen so each name matches exactly its intended keyword rule and none of
// the earlier-checked rules. 11 distinct families should roll up into 7
// coarser capability domains (see responsibilities-capabilities.ts
// CAPABILITY_DOMAIN_ROLLUP) — proving the rollup actually coarsens, not just
// relabels 1:1.
const FAMILY_WORKFLOWS: [string, string][] = [
  ["Governance Policy Check", ".github/workflows/governance-policy-check.yml"],
  ["Change Review Gate", ".github/workflows/change-review-gate.yml"],
  ["Update IAM Role Bindings", ".github/workflows/update-iam-role-bindings.yml"],
  ["Rotate Secrets Vault", ".github/workflows/rotate-secrets-vault.yml"],
  ["Onboard New Employee", ".github/workflows/onboard-new-employee.yml"],
  ["Migrate Legacy Schema", ".github/workflows/migrate-legacy-schema.yml"],
  ["Diagnose Service Health", ".github/workflows/diagnose-service-health.yml"],
  ["Monitor Uptime Dashboard", ".github/workflows/monitor-uptime-dashboard.yml"],
  ["Refresh PDT Cache", ".github/workflows/refresh-pdt-cache.yml"],
  ["Nightly Release Job", ".github/workflows/nightly-release-job.yml"],
  ["Send Slack Notification", ".github/workflows/send-slack-notification.yml"],
];

const MINIMAL_YAML = "name: %NAME%\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

function buildModel() {
  const model = makeRepositoryModel();
  const graphs = FAMILY_WORKFLOWS.map(([name, path]) => parseWorkflowText(MINIMAL_YAML.replace("%NAME%", name), path).graph);
  return synthesizeArchitectureIntelligence({
    model,
    workflowGraphs: graphs,
    terraformTopologies: [],
    gitCommit: model.git.commit,
    generatedAt: "2026-07-01T00:00:00.000Z",
  });
}

describe("capability-domain rollup", () => {
  it("rolls 11 fine-grained workflow families up into fewer, coarser capability domains", () => {
    const result = buildModel();
    expect(result.workflowFamilies.length).toBe(11);
    expect(result.capabilityDomains.length).toBeLessThan(result.workflowFamilies.length);
    expect(result.capabilityDomains.length).toBe(7);
  });

  it("groups Governance and Review-and-approval families under one domain", () => {
    const result = buildModel();
    const domain = result.capabilityDomains.find((d) => d.label.sourceLabel === "Governance and approval");
    expect(domain).toBeDefined();
    expect(domain?.workflowFamilyIds.length).toBe(2);
  });

  it("groups Identity-and-access and Credentials families under one domain", () => {
    const result = buildModel();
    const domain = result.capabilityDomains.find((d) => d.label.sourceLabel === "Identity and access governance");
    expect(domain?.workflowFamilyIds.length).toBe(2);
  });

  it("leaves an unmapped family label as its own standalone domain", () => {
    const result = buildModel();
    const domain = result.capabilityDomains.find((d) => d.label.sourceLabel === "Query and data reliability");
    expect(domain?.workflowFamilyIds.length).toBe(1);
  });

  it("every capability domain traces back to at least one responsibility, component, or workflow family", () => {
    const result = buildModel();
    for (const domain of result.capabilityDomains) {
      expect(domain.responsibilityIds.length + domain.componentIds.length + domain.workflowFamilyIds.length).toBeGreaterThan(0);
    }
  });
});
