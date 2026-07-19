import type { ArchitectureIntelligence, InferenceClass, InferredStatement, NormalizedLabel } from "@rvs/architecture-intelligence";
import type { EvidenceManifest } from "@rvs/core";
import type { RepositoryModel } from "@rvs/repository-model";
import { renderVisualDocToHtml } from "@rvs/renderer-html";
import type { DesignTokens } from "@rvs/renderer-html";
import type { ArchitectureSceneKind, VisualDoc } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import {
  checkLevel1LeaksImplementationDetail,
  checkSceneWordBudget,
  checkStaleInput,
  checkSuggestedClaimsUnlabeled,
  checkUnresolvedClaimsInLevel1,
  runArchitectureIntelligenceChecks,
} from "../architecture-intelligence-checks.js";

function label(s: string): NormalizedLabel {
  return { sourceLabel: s, displayLabel: s, shortLabel: s };
}

function statement(value: string, inference: InferenceClass): InferredStatement {
  return { value, inference, evidence: inference === "unresolved" ? [] : [{ path: "README.md" }], rationale: "test fixture" };
}

function baseArtifact(): ArchitectureIntelligence {
  return {
    version: 1,
    identity: {
      id: "arch:identity:sample",
      name: label("Sample Platform"),
      oneLineDescription: statement("Sample Platform automates release governance for internal services.", "confirmed"),
      repositoryKind: "single-service",
      evidence: [{ path: "README.md" }],
    },
    purpose: {
      problemStatement: statement("Manual releases are slow and error-prone.", "confirmed"),
      targetUsers: [statement("Platform engineers", "derived")],
      scopeBoundaries: [statement("Does not manage multi-region deployments.", "confirmed")],
    },
    responsibilities: [],
    capabilityDomains: [
      {
        id: "arch:capability:release",
        label: label("Release management"),
        summary: statement("Coordinates releases across services.", "confirmed"),
        responsibilityIds: [],
        componentIds: [],
        workflowFamilyIds: [],
      },
    ],
    components: [],
    actors: [],
    externalSystems: [],
    flows: [],
    boundaries: [],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [{ id: "arch:outcome:1", statement: statement("Releases ship with fewer manual steps.", "confirmed") }],
    risks: [],
    dependencies: [],
    questions: [],
    workflowFamilies: [
      { id: "arch:family:release", label: label("Release"), description: statement("Automates the release pipeline.", "confirmed"), workflowGraphIds: [] },
    ],
    metadata: {
      generated_at: "2026-07-01T00:00:00.000Z",
      git_commit: "abc1234",
      schema_version: 1,
      source_repository_model_generated_at: "2026-07-01T00:00:00.000Z",
      workflow_graph_count: 0,
      terraform_topology_count: 0,
      assist_used: false,
      confidence: { confirmed: 5, derived: 1, suggested: 0, unresolved: 0, total: 6 },
    },
  };
}

function buildRepositoryModel(generatedAt: string): RepositoryModel {
  return {
    generated_at: generatedAt,
    repo_root: "/repo",
    project_name: "sample-platform",
    git: { commit: "abc1234", branch: "main", recentCommits: [], contributorCount: 3, commitsLast90Days: 12 },
    files: { total: 2, byExtension: { ".ts": 1, ".md": 1 }, sampledPaths: ["src/index.ts", "README.md"] },
    tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: [], manifestFile: "package.json" },
    workspace_packages: [],
    markdown_documents: [],
    ci_workflows: [],
  };
}

function buildDoc(kind: ArchitectureSceneKind, artifactId: string, focusIds: string[] = []): VisualDoc {
  return {
    version: 1,
    document: { type: "presentation", title: "Architecture review", aspect_ratio: "16:9", audience: "architecture-review", theme: "executive-dark" },
    scenes: [{ id: `scene-${kind}`, type: "architecture-intelligence", headline: `Scene: ${kind}`, evidence: [], artifact_id: artifactId, kind, focus_ids: focusIds }],
  };
}

const tokens: DesignTokens = {
  name: "executive-dark",
  version: "1.0.0",
  colors: { background: "#000", surface: "#111", text_primary: "#fff", text_secondary: "#aaa", accent: "#5b8cff", border: "#333", success: "#0f0", warning: "#ff0" },
  typography: { display: "serif", heading: "sans", body: "sans", code: "mono" },
  spacing: { unit: 8 },
  motion: { fast: 100, normal: 200, slow: 300 },
};

const emptyEvidence: EvidenceManifest = { generated_at: "2026-01-01T00:00:00.000Z", git_commit: "abc123", claims: [] };

function renderScene(kind: ArchitectureSceneKind, artifact: ArchitectureIntelligence): { doc: VisualDoc; html: string } {
  const doc = buildDoc(kind, artifact.identity.id);
  const html = renderVisualDocToHtml(doc, tokens, emptyEvidence, { gitCommit: "abc123" }, [], [], [artifact]);
  return { doc, html };
}

// A hand-crafted HTML fragment shaped like renderer-html's real section
// wrapper, standing in for what a *broken* renderer might emit (missing the
// inference qualifier) — used to prove the label-integrity checks actually
// audit rendered text rather than re-deriving their own expectation.
function fakeSceneHtml(sceneId: string, innerText: string): string {
  return `<section class="scene" id="scene-0" data-scene-index="0" data-scene-id="${sceneId}" data-scene-type="architecture-intelligence"><div class="scene-inner"><p>${innerText}</p></div></section>`;
}

describe("checkUnresolvedClaimsInLevel1", () => {
  it("is silent when the real renderer correctly qualifies an unresolved Level 1 statement", () => {
    const artifact = baseArtifact();
    artifact.capabilityDomains[0]!.summary = statement("Coordinates releases across services.", "unresolved");
    const { doc, html } = renderScene("capability-map", artifact);
    expect(checkUnresolvedClaimsInLevel1(doc, artifact, html)).toEqual([]);
  });

  it("flags a Level 1 scene whose rendered HTML omits the Unconfirmed qualifier for an unresolved statement", () => {
    const artifact = baseArtifact();
    artifact.capabilityDomains[0]!.summary = statement("Coordinates releases across services.", "unresolved");
    const doc = buildDoc("capability-map", artifact.identity.id);
    const brokenHtml = fakeSceneHtml("scene-capability-map", "Coordinates releases across services.");
    const warnings = checkUnresolvedClaimsInLevel1(doc, artifact, brokenHtml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_UNRESOLVED_CLAIM_IN_LEVEL1");
    expect(warnings[0]!.severity).toBe("error");
  });

  it("never flags decision-or-next-step even though it is a Level 1 kind, since open questions are deliberately unresolved", () => {
    const artifact = baseArtifact();
    artifact.questions.push({ id: "arch:question:1", question: "Which team owns rollback approval?", relatedEntityIds: [], reason: "unresolved-claim" });
    const doc = buildDoc("decision-or-next-step", artifact.identity.id);
    const brokenHtml = fakeSceneHtml("scene-decision-or-next-step", "Which team owns rollback approval?");
    expect(checkUnresolvedClaimsInLevel1(doc, artifact, brokenHtml)).toEqual([]);
  });

  it("is silent for a Level 2/3 kind not in the Level 1 set, even with an unqualified unresolved statement", () => {
    const artifact = baseArtifact();
    artifact.workflowFamilies[0]!.description = statement("Automates the release pipeline.", "unresolved");
    const doc = buildDoc("workflow-family-map", artifact.identity.id);
    const brokenHtml = fakeSceneHtml("scene-workflow-family-map", "Automates the release pipeline.");
    expect(checkUnresolvedClaimsInLevel1(doc, artifact, brokenHtml)).toEqual([]);
  });
});

describe("checkSuggestedClaimsUnlabeled", () => {
  it("is silent when the real renderer correctly qualifies a suggested statement", () => {
    const artifact = baseArtifact();
    artifact.purpose.problemStatement = statement("Manual releases are slow and error-prone.", "suggested");
    const { doc, html } = renderScene("problem-and-response", artifact);
    expect(checkSuggestedClaimsUnlabeled(doc, artifact, html)).toEqual([]);
  });

  it("flags an unqualified suggested statement outside the Level 1 set too (broader scope than the unresolved check)", () => {
    const artifact = baseArtifact();
    artifact.workflowFamilies[0]!.description = statement("Automates the release pipeline.", "suggested");
    const doc = buildDoc("workflow-family-map", artifact.identity.id);
    const brokenHtml = fakeSceneHtml("scene-workflow-family-map", "Automates the release pipeline.");
    const warnings = checkSuggestedClaimsUnlabeled(doc, artifact, brokenHtml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED");
  });

  // boundary-map renders as an .arch-card grid of boundary descriptions (see
  // renderer-html/scenes/architecture-intelligence/maps.ts), the same prose
  // mechanism as capability-map/workflow-family-map — despite superficially
  // looking like a "diagram" scene kind, its statements must be covered by
  // this check too, or a suggested boundary claim could render unqualified
  // with nothing catching it.
  it("flags an unqualified suggested statement in boundary-map, which is prose-based despite its diagram-like name", () => {
    const artifact = baseArtifact();
    artifact.boundaries.push({
      id: "arch:boundary:prod",
      label: label("Production"),
      kind: "deployment-environment",
      containedComponentIds: [],
      description: statement("Isolates production data from staging.", "suggested"),
      evidence: [{ path: "README.md" }],
    });
    const doc = buildDoc("boundary-map", artifact.identity.id);
    const brokenHtml = fakeSceneHtml("scene-boundary-map", "Isolates production data from staging.");
    const warnings = checkSuggestedClaimsUnlabeled(doc, artifact, brokenHtml);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_SUGGESTED_CLAIM_UNLABELED");
  });
});

describe("checkSceneWordBudget", () => {
  it("is silent when the rendered scene stays within its word budget", () => {
    const doc = buildDoc("executive-title", "arch:identity:sample");
    const html = fakeSceneHtml("scene-executive-title", "Sample Platform automates release governance.");
    expect(checkSceneWordBudget(doc, html)).toEqual([]);
  });

  it("flags a scene whose rendered text exceeds its per-kind word budget", () => {
    const doc = buildDoc("executive-title", "arch:identity:sample");
    const html = fakeSceneHtml("scene-executive-title", Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "));
    const warnings = checkSceneWordBudget(doc, html);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED");
    expect(warnings[0]!.severity).toBe("warning");
  });

  it("does not enforce a budget for diagram-kind scenes (documented scope limitation)", () => {
    const doc = buildDoc("system-context", "arch:identity:sample");
    const html = fakeSceneHtml("scene-system-context", Array.from({ length: 500 }, (_, i) => `word${i}`).join(" "));
    expect(checkSceneWordBudget(doc, html)).toEqual([]);
  });

  it("does enforce a 150-word budget for boundary-map, unlike the true diagram kinds above", () => {
    const doc = buildDoc("boundary-map", "arch:identity:sample");
    const html = fakeSceneHtml("scene-boundary-map", Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "));
    const warnings = checkSceneWordBudget(doc, html);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_SCENE_WORD_BUDGET_EXCEEDED");
  });
});

describe("checkLevel1LeaksImplementationDetail", () => {
  it("is silent when a Level 1 statement stays free of raw file paths", () => {
    const artifact = baseArtifact();
    const doc = buildDoc("executive-title", artifact.identity.id);
    expect(checkLevel1LeaksImplementationDetail(doc, artifact)).toEqual([]);
  });

  it("flags a Level 1 statement whose value contains what looks like a raw source file path", () => {
    const artifact = baseArtifact();
    artifact.identity.oneLineDescription = statement("Implemented in src/index.ts and configured via .github/workflows/release.yml.", "confirmed");
    const doc = buildDoc("executive-title", artifact.identity.id);
    const warnings = checkLevel1LeaksImplementationDetail(doc, artifact);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_LEVEL1_LEAKS_IMPLEMENTATION_DETAIL");
    expect(warnings[0]!.severity).toBe("warning");
  });

  it("does not check kinds outside the Level 1 set", () => {
    const artifact = baseArtifact();
    artifact.workflowFamilies[0]!.description = statement("Implemented in src/index.ts.", "confirmed");
    const doc = buildDoc("workflow-family-map", artifact.identity.id);
    expect(checkLevel1LeaksImplementationDetail(doc, artifact)).toEqual([]);
  });
});

describe("checkStaleInput", () => {
  it("is silent when the artifact's source snapshot matches the current repository model", () => {
    const artifact = baseArtifact();
    const model = buildRepositoryModel(artifact.metadata.source_repository_model_generated_at);
    expect(checkStaleInput(artifact, model)).toEqual([]);
  });

  it("flags a stale artifact whose source snapshot predates the current repository model", () => {
    const artifact = baseArtifact();
    const model = buildRepositoryModel("2026-08-01T00:00:00.000Z");
    const warnings = checkStaleInput(artifact, model);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("ARCH_INTEL_STALE_INPUT");
    expect(warnings[0]!.severity).toBe("warning");
  });
});

describe("runArchitectureIntelligenceChecks", () => {
  it("aggregates all five checks and is silent for a clean, correctly-rendered artifact", () => {
    const artifact = baseArtifact();
    const { doc, html } = renderScene("executive-title", artifact);
    const model = buildRepositoryModel(artifact.metadata.source_repository_model_generated_at);
    expect(runArchitectureIntelligenceChecks({ doc, artifact, html, currentModel: model })).toEqual([]);
  });

  it("surfaces a stale-input warning even when the rendered scene is otherwise clean", () => {
    const artifact = baseArtifact();
    const { doc, html } = renderScene("executive-title", artifact);
    const model = buildRepositoryModel("2026-08-01T00:00:00.000Z");
    const warnings = runArchitectureIntelligenceChecks({ doc, artifact, html, currentModel: model });
    expect(warnings.map((w) => w.code)).toEqual(["ARCH_INTEL_STALE_INPUT"]);
  });
});
