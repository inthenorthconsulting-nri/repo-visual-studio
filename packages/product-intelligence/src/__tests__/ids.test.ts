import { describe, expect, it } from "vitest";
import { claimId, differentiatorId, productCandidateId, productEvidenceId, proofPointId, showcaseMetricId, showcaseSceneId, valuePillarId } from "../ids.js";

describe("id generator functions", () => {
  it("productEvidenceId composes sourceType, sourceId, and index in order", () => {
    expect(productEvidenceId("capability", "capintel:capability:widget-sync", 2)).toBe("prodintel:evidence:capability:capintel-capability-widget-sync:2");
  });

  it("productCandidateId sanitizes the archetype into the id", () => {
    expect(productCandidateId("governance_platform")).toBe("prodintel:candidate:governance_platform");
  });

  it("valuePillarId lowercases the title before sanitizing", () => {
    expect(valuePillarId("Widget Operations")).toBe("prodintel:pillar:widget-operations");
  });

  it("differentiatorId lowercases the title before sanitizing", () => {
    expect(differentiatorId("Shared Platform Core Across The Platform")).toBe("prodintel:differentiator:shared-platform-core-across-the-platform");
  });

  it("proofPointId lowercases the label before sanitizing", () => {
    expect(proofPointId("Widget Sync Uptime")).toBe("prodintel:proof:widget-sync-uptime");
  });

  it("claimId composes claimType and subjectId, sanitizing both", () => {
    expect(claimId("purpose", "purpose")).toBe("prodintel:claim:purpose:purpose");
    expect(claimId("capability", "capintel:capability:widget-sync")).toBe("prodintel:claim:capability:capintel-capability-widget-sync");
  });

  it("showcaseSceneId composes type and index", () => {
    expect(showcaseSceneId("showcase-hero", 0)).toBe("showcase:scene:showcase-hero:0");
  });

  it("showcaseMetricId lowercases the label before sanitizing", () => {
    expect(showcaseMetricId("Widget Sync Uptime")).toBe("showcase:metric:widget-sync-uptime");
  });

  it("sanitizes every character outside [a-zA-Z0-9_.-] to a dash, across all id functions", () => {
    expect(productEvidenceId("cap ability!", "id@#$", 0)).toBe("prodintel:evidence:cap-ability-:id---:0");
  });

  it("is a pure function of its inputs: same inputs always produce the same id", () => {
    expect(claimId("capability", "capintel:capability:widget-sync")).toBe(claimId("capability", "capintel:capability:widget-sync"));
  });
});
