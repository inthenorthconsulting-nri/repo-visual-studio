import type { ArchitectureIntelligence, ArchitectureRisk } from "@rvs/architecture-intelligence";
import type { ArchitectureIntelligenceScene } from "@rvs/visualdoc-schema";
import { describe, expect, it } from "vitest";
import { renderRiskSummary } from "../scenes/architecture-intelligence/text.js";

function makeRisk(id: string, severity: ArchitectureRisk["severity"], displayLabel: string): ArchitectureRisk {
  return {
    id,
    severity,
    label: { sourceLabel: displayLabel, displayLabel, shortLabel: displayLabel },
    description: { value: `${displayLabel} description.`, inference: "derived", evidence: [] },
    relatedComponentIds: [],
  };
}

const scene: ArchitectureIntelligenceScene = {
  id: "scene-risk-summary",
  type: "architecture-intelligence",
  headline: "Risks",
  evidence: [],
  artifact_id: "arch:identity:sample",
  kind: "risk-summary",
  focus_ids: [],
};

describe("renderRiskSummary", () => {
  it("orders same-severity risks by id ascending, deterministically, regardless of input order", () => {
    // §4 determinism audit: SEVERITY_ORDER alone has no tiebreaker among
    // same-severity risks, which is the common case (most warnings map to
    // "medium" severity) — this proves the id tiebreak keeps ordering stable
    // no matter what order the caller supplies risks in.
    const risksAscending: ArchitectureRisk[] = [makeRisk("arch:risk:alpha", "medium", "Alpha risk"), makeRisk("arch:risk:beta", "medium", "Beta risk"), makeRisk("arch:risk:zeta", "high", "Zeta risk")];
    const risksReversed = [...risksAscending].reverse();

    const artifactAscending = { risks: risksAscending, dependencies: [] } as unknown as ArchitectureIntelligence;
    const artifactReversed = { risks: risksReversed, dependencies: [] } as unknown as ArchitectureIntelligence;

    const htmlAscending = renderRiskSummary(scene, artifactAscending, false);
    const htmlReversed = renderRiskSummary(scene, artifactReversed, false);

    expect(htmlAscending).toBe(htmlReversed);
    // "high" sorts before "medium", and within "medium" the ids are ascending: alpha before beta.
    const zetaIndex = htmlAscending.indexOf("Zeta risk");
    const alphaIndex = htmlAscending.indexOf("Alpha risk");
    const betaIndex = htmlAscending.indexOf("Beta risk");
    expect(zetaIndex).toBeLessThan(alphaIndex);
    expect(alphaIndex).toBeLessThan(betaIndex);
  });
});
