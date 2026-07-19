import { describe, expect, it } from "vitest";
import type { CapabilityModel, ExcludedCapabilityCandidate } from "../contracts.js";
import { exportCapabilitiesMarkdown, exportCapabilityCandidatesJson, exportCapabilityExclusionsJson, exportCapabilityModelJson } from "../exporter.js";
import { makeCapability, makeCapabilityCandidate, makeCleanCapabilityModel, makeReadiness, stmt } from "./fixtures.js";

function modelWithEveryBucket(): CapabilityModel {
  const clean = makeCleanCapabilityModel();
  const domainId = clean.domains[0]!.id;
  const gapCap = makeCapability({
    sourceLabel: "Widget Disaster Recovery",
    domainId,
    status: "unknown",
    inclusion: "gap_only",
    gapStatement: stmt("No disaster-recovery runbook exists for widget synchronization failures."),
  });
  const roadmapCap = makeCapability({
    sourceLabel: "Widget Multi-Region Rollout",
    domainId,
    status: "planned",
    inclusion: "roadmap_only",
    roadmapStatement: stmt("Multi-region widget replication is planned for a future release."),
  });
  const excluded: ExcludedCapabilityCandidate = {
    id: "cap:capability:Widget-Scratch-Prototype",
    displayName: "Widget Scratch Prototype",
    domainId,
    sourceLabel: "Widget Scratch Prototype",
    granularity: "capability",
    status: "scaffolded",
    confidence: "unresolved",
    readiness: makeReadiness({ score: 5 }),
    reasonCodes: ["SCAFFOLD_ONLY"],
    reasonSummary: "Only a scaffold with no real implementation was found.",
    evidence: [],
  };
  return { ...clean, gapCapabilities: [gapCap], roadmapCapabilities: [roadmapCap], excludedCandidates: [excluded] };
}

describe("exportCapabilitiesMarkdown — default options are conservative: roadmap and excluded candidates are never shown by default", () => {
  it("never mentions a roadmap-only or excluded candidate's display name anywhere in the default-options document", () => {
    const model = modelWithEveryBucket();
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).not.toContain("Widget Multi-Region Rollout");
    expect(markdown).not.toContain("Widget Scratch Prototype");
    expect(markdown).not.toContain("## Roadmap");
    expect(markdown).not.toContain("## Excluded candidates");
  });

  it("renders the platform header, purpose, and capability summary table", () => {
    const model = makeCleanCapabilityModel();
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain(`# ${model.systemIdentity.displayName} — Capabilities`);
    expect(markdown).toContain("## Capability summary");
    expect(markdown).toContain("## Capability domains");
  });

  it("renders only fully-'include' capabilities inside a domain's capability block, never an include_with_qualification capability", () => {
    const model = makeCleanCapabilityModel();
    const markdown = exportCapabilitiesMarkdown(model);
    const domainSection = markdown.split("## Capability domains")[1]!.split("## Available with limitations")[0]!;
    expect(domainSection).toContain(model.includedCapabilities[0]!.displayName);
    expect(domainSection).not.toContain(model.qualifiedCapabilities[0]!.displayName);
  });

  it("renders qualified capabilities under 'Available with limitations' by default", () => {
    const model = makeCleanCapabilityModel();
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain("## Available with limitations");
    expect(markdown).toContain(model.qualifiedCapabilities[0]!.displayName);
  });

  it("omits 'Available with limitations' entirely when there are no qualified capabilities", () => {
    const model = { ...makeCleanCapabilityModel(), qualifiedCapabilities: [] };
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).not.toContain("## Available with limitations");
  });

  it("renders known capability gaps using the gapStatement, not a generic label", () => {
    const model = modelWithEveryBucket();
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain("## Known capability gaps");
    expect(markdown).toContain("No disaster-recovery runbook exists for widget synchronization failures.");
  });
});

describe("exportCapabilitiesMarkdown — opt-in sections", () => {
  it("renders roadmap items only when includeRoadmap is explicitly true, using the roadmapStatement", () => {
    const model = modelWithEveryBucket();
    const markdown = exportCapabilitiesMarkdown(model, { includePartial: true, includeGaps: true, includeRoadmap: true, includeExcluded: false });
    expect(markdown).toContain("## Roadmap");
    expect(markdown).toContain("Multi-region widget replication is planned for a future release.");
  });

  it("renders excluded candidates only when includeExcluded is explicitly true, including their reason codes", () => {
    const model = modelWithEveryBucket();
    const markdown = exportCapabilitiesMarkdown(model, { includePartial: true, includeGaps: true, includeRoadmap: false, includeExcluded: true });
    expect(markdown).toContain("## Excluded candidates");
    expect(markdown).toContain("Widget Scratch Prototype");
    expect(markdown).toContain("SCAFFOLD_ONLY");
  });

  it("renders '—' for an excluded candidate's reason codes when its reasonCodes array is empty", () => {
    const clean = makeCleanCapabilityModel();
    const excluded: ExcludedCapabilityCandidate = {
      id: "cap:capability:No-Reason-Code",
      displayName: "No Reason Code Candidate",
      domainId: clean.domains[0]!.id,
      sourceLabel: "No Reason Code Candidate",
      granularity: "capability",
      status: "unknown",
      confidence: "unresolved",
      readiness: makeReadiness({ score: 0 }),
      reasonCodes: [],
      reasonSummary: "Excluded for diagnostic purposes.",
      evidence: [],
    };
    const model = { ...clean, excludedCandidates: [excluded] };
    const markdown = exportCapabilitiesMarkdown(model, { includePartial: true, includeGaps: true, includeRoadmap: false, includeExcluded: true });
    expect(markdown).toContain("| No Reason Code Candidate | unknown | — | Excluded for diagnostic purposes. |");
  });
});

describe("exportCapabilitiesMarkdown — generation metadata footer", () => {
  it("reports schema version, generation provenance, and evidence disposition counts", () => {
    const model = makeCleanCapabilityModel();
    const markdown = exportCapabilitiesMarkdown(model);
    expect(markdown).toContain(`Schema version: ${model.generationMetadata.schema_version}`);
    expect(markdown).toContain(`Git commit: \`${model.generationMetadata.git_commit}\``);
    expect(markdown).toContain(`External model used: no`);
    expect(markdown).toContain(`Candidates discovered: ${model.generationMetadata.candidateCount}`);
    expect(markdown).toContain(`${model.evidenceSummary.includedCount} included`);
  });
});

describe("JSON exporters", () => {
  it("exportCapabilityModelJson round-trips the full model", () => {
    const model = makeCleanCapabilityModel();
    expect(JSON.parse(exportCapabilityModelJson(model))).toEqual(model);
  });

  it("exportCapabilityCandidatesJson round-trips a candidate array", () => {
    const candidates = [makeCapabilityCandidate({ sourceLabel: "Widget Sync Service" })];
    expect(JSON.parse(exportCapabilityCandidatesJson(candidates))).toEqual(candidates);
  });

  it("exportCapabilityExclusionsJson emits only the model's excludedCandidates, not the included/qualified capabilities", () => {
    const model = modelWithEveryBucket();
    const parsed = JSON.parse(exportCapabilityExclusionsJson(model));
    expect(parsed).toEqual(model.excludedCandidates);
    expect(JSON.stringify(parsed)).not.toContain(model.includedCapabilities[0]!.id);
  });
});
