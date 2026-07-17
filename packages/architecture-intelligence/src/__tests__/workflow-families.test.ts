import { parseWorkflowText } from "@rvs/workflow-graph";
import { describe, expect, it } from "vitest";
import { buildWorkflowFamilies } from "../synthesize/workflow-families.js";

const MINIMAL_YAML = "name: %NAME%\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

function graph(name: string, sourcePath: string) {
  return parseWorkflowText(MINIMAL_YAML.replace("%NAME%", name), sourcePath).graph;
}

describe("buildWorkflowFamilies", () => {
  it("classifies workflows into named families by keyword match on name/path", () => {
    const families = buildWorkflowFamilies([
      graph("Governance Policy Check", ".github/workflows/governance-policy-check.yml"),
      graph("Onboard New User", ".github/workflows/onboard-new-user.yml"),
      graph("Rotate Credentials", ".github/workflows/rotate-credentials.yml"),
      graph("Something Unrelated", ".github/workflows/something-unrelated.yml"),
    ]);

    const labels = families.map((f) => f.label.sourceLabel).sort();
    expect(labels).toEqual(["Credentials", "Governance", "Onboarding", "Other automation"]);
  });

  it("is deterministic across repeated syntheses of the same input", () => {
    const graphs = [graph("Review PR", ".github/workflows/review-pr.yml"), graph("Nightly Release", ".github/workflows/nightly-release.yml")];
    expect(buildWorkflowFamilies(graphs)).toEqual(buildWorkflowFamilies(graphs));
  });

  it("sorts families alphabetically and workflow ids within a family by id", () => {
    const families = buildWorkflowFamilies([graph("Zeta Release", ".github/workflows/zeta-release.yml"), graph("Alpha Release", ".github/workflows/alpha-release.yml")]);
    expect(families).toHaveLength(1);
    expect(families[0]?.label.sourceLabel).toBe("Release and maintenance");
    expect(families[0]?.workflowGraphIds).toEqual([...families[0]!.workflowGraphIds].sort());
  });

  it("every family workflow-graph id traces back to a real evidenced workflow", () => {
    const families = buildWorkflowFamilies([graph("Diagnostics Sweep", ".github/workflows/diagnostics-sweep.yml")]);
    expect(families[0]?.description.evidence[0]?.path).toBe(".github/workflows/diagnostics-sweep.yml");
  });
});

describe("buildWorkflowFamilies representative selection", () => {
  function parse(yaml: string, sourcePath: string) {
    return parseWorkflowText(yaml, sourcePath).graph;
  }

  const PLAIN_RELEASE = `
name: Release Simple
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
`;

  const REUSABLE_RELEASE = `
name: Release Reusable
on:
  workflow_call: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
`;

  // Named/pathed to avoid tripping the "Review and approval" family rule
  // (which matches on /approv/ in the workflow's name/path, checked before
  // "Release and maintenance") — only the job key "approve" needs to match
  // /approv/ to be classified as an approval-type node.
  const APPROVAL_RELEASE = `
name: Release Production Push
on: push
jobs:
  approve:
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - run: echo "await approval"
`;

  const COMPLEX_PLAIN_RELEASE = `
name: Release Complex
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  publish:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - run: npm publish
`;

  it("prefers a workflow with an approval gate over a reusable or plain workflow", () => {
    const approval = parse(APPROVAL_RELEASE, ".github/workflows/release-production-push.yml");
    const reusable = parse(REUSABLE_RELEASE, ".github/workflows/release-reusable.yml");
    const plain = parse(PLAIN_RELEASE, ".github/workflows/release-simple.yml");
    const families = buildWorkflowFamilies([plain, reusable, approval]);
    const family = families.find((f) => f.label.sourceLabel === "Release and maintenance");
    expect(family?.representativeWorkflowGraphId).toBe(approval.id);
  });

  it("prefers a reusable (workflow_call) workflow over a plain workflow when no approval gate exists", () => {
    const reusable = parse(REUSABLE_RELEASE, ".github/workflows/release-reusable.yml");
    const plain = parse(COMPLEX_PLAIN_RELEASE, ".github/workflows/release-complex.yml");
    const families = buildWorkflowFamilies([plain, reusable]);
    const family = families.find((f) => f.label.sourceLabel === "Release and maintenance");
    expect(family?.representativeWorkflowGraphId).toBe(reusable.id);
  });

  it("falls back to the most complex graph (most nodes) when no approval gate or reusable workflow exists", () => {
    const simple = parse(PLAIN_RELEASE, ".github/workflows/release-simple.yml");
    const complex = parse(COMPLEX_PLAIN_RELEASE, ".github/workflows/release-complex.yml");
    const families = buildWorkflowFamilies([simple, complex]);
    const family = families.find((f) => f.label.sourceLabel === "Release and maintenance");
    expect(family?.representativeWorkflowGraphId).toBe(complex.id);
  });

  it("every non-empty family has a representative selected", () => {
    const families = buildWorkflowFamilies([parse(PLAIN_RELEASE, ".github/workflows/release-simple.yml")]);
    for (const family of families) {
      if (family.workflowGraphIds.length > 0) {
        expect(family.representativeWorkflowGraphId).toBeDefined();
      }
    }
  });
});
