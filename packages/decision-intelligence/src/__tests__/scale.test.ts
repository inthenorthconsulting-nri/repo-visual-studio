import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../snapshot.js";
import { buildDecisionSupersession } from "../supersession.js";
import { buildDecisionConflicts } from "../conflicts.js";
import { buildDecisionDependencies, type DeclaredDependency } from "../dependencies.js";
import { classifyDecisionCriticality } from "../criticality.js";
import { assessDecisionBlastRadius, type BlastRadiusInputs } from "../blast-radius.js";
import type { ArchitectureDecision, DecisionLink, DecisionStatus, EvidenceRef } from "../contracts.js";
import { architectureDecision, decisionAssumption, decisionConsequence, decisionLink, GENERATED_AT } from "./decision-fixtures.js";

const CHAIN_PAIR_COUNT = 50;
const CONFLICT_PAIR_COUNT = 25;
const CHAIN_BLOCK_SIZE = CHAIN_PAIR_COUNT * 2;
const CONFLICT_BLOCK_SIZE = CONFLICT_PAIR_COUNT * 2;
const GENERAL_START = CHAIN_BLOCK_SIZE + CONFLICT_BLOCK_SIZE;
const GENERAL_COUNT = 110;
const DECISION_COUNT = GENERAL_START + GENERAL_COUNT;
const ASSUMPTION_CONSEQUENCE_COUNT = 210;
const GENERAL_STATUS_ROTATION: DecisionStatus[] = ["accepted", "implemented", "proposed"];

function buildScaleDecisions(): ArchitectureDecision[] {
  const decisions: ArchitectureDecision[] = new Array(DECISION_COUNT);

  for (let pair = 0; pair < CHAIN_PAIR_COUNT; pair += 1) {
    const oldIndex = pair * 2;
    const newIndex = pair * 2 + 1;
    const oldId = `decision:scale-${oldIndex}`;
    const newId = `decision:scale-${newIndex}`;
    decisions[oldIndex] = architectureDecision({ id: oldId, decision_status: "superseded", implementation_status: "superseded", superseded_by: [newId] });
    decisions[newIndex] = architectureDecision({ id: newId, decision_status: "accepted", implementation_status: "implemented", supersedes: [oldId] });
  }

  for (let pair = 0; pair < CONFLICT_PAIR_COUNT; pair += 1) {
    const targetIndex = CHAIN_BLOCK_SIZE + pair * 2;
    const supersederIndex = CHAIN_BLOCK_SIZE + pair * 2 + 1;
    const targetId = `decision:scale-${targetIndex}`;
    const supersederId = `decision:scale-${supersederIndex}`;
    decisions[targetIndex] = architectureDecision({ id: targetId, decision_status: "accepted", implementation_status: "implemented", superseded_by: [supersederId] });
    decisions[supersederIndex] = architectureDecision({ id: supersederId, decision_status: "accepted", implementation_status: "implemented", supersedes: [targetId] });
  }

  for (let i = 0; i < GENERAL_COUNT; i += 1) {
    const index = GENERAL_START + i;
    const status = GENERAL_STATUS_ROTATION[index % GENERAL_STATUS_ROTATION.length]!;
    decisions[index] = architectureDecision({ id: `decision:scale-${index}`, decision_status: status, implementation_status: status === "implemented" ? "implemented" : "not_started" });
  }

  return decisions;
}

function buildScaleLinks(decisions: ArchitectureDecision[]): DecisionLink[] {
  const domains: DecisionLink["target_domain"][] = ["architecture", "capability", "product", "portfolio"];
  const links: DecisionLink[] = [];
  decisions.forEach((decision, index) => {
    const domainA = domains[index % domains.length]!;
    const domainB = domains[(index + 1) % domains.length]!;
    links.push(decisionLink({ decision_id: decision.id, link_type: "governs", target_domain: domainA, target_id: `entity:${index}-a`, resolution: "resolved" }));
    links.push(decisionLink({ decision_id: decision.id, link_type: "references", target_domain: domainB, target_id: `entity:${index}-b`, resolution: "resolved" }));
  });
  return links;
}

function buildScaleDependencyMap(decisions: ArchitectureDecision[]): Map<string, DeclaredDependency[]> {
  const map = new Map<string, DeclaredDependency[]>();
  for (let index = GENERAL_START; index < DECISION_COUNT - 1; index += 1) {
    map.set(decisions[index]!.id, [{ type: "depends_on", target: decisions[index + 1]!.id }]);
  }
  return map;
}

function evidenceMapFor(decisions: ArchitectureDecision[]): Map<string, EvidenceRef[]> {
  const map = new Map<string, EvidenceRef[]>();
  for (const decision of decisions) map.set(decision.id, decision.evidence_refs);
  return map;
}

function isSorted(ids: string[]): boolean {
  for (let i = 1; i < ids.length; i += 1) {
    if (ids[i - 1]! > ids[i]!) return false;
  }
  return true;
}

function hasNoDuplicates(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe("scale: fixture volume matches the required minimums", () => {
  const decisions = buildScaleDecisions();
  const links = buildScaleLinks(decisions);

  it("decisions: 250+", () => {
    expect(decisions.length).toBeGreaterThanOrEqual(250);
    expect(hasNoDuplicates(decisions.map((d) => d.id))).toBe(true);
  });

  it("links: 500+, every link references a known decision", () => {
    expect(links.length).toBeGreaterThanOrEqual(500);
    const knownIds = new Set(decisions.map((d) => d.id));
    expect(links.every((l) => knownIds.has(l.decision_id))).toBe(true);
    expect(hasNoDuplicates(links.map((l) => l.id))).toBe(true);
  });

  it("assumptions: 200+, consequences: 200+", () => {
    const knownIds = new Set(decisions.map((d) => d.id));
    const assumptions = decisions.slice(0, ASSUMPTION_CONSEQUENCE_COUNT).map((d, i) => decisionAssumption({ decision_id: d.id, state: i % 20 === 0 ? "contradicted" : "confirmed" }));
    const consequences = decisions.slice(0, ASSUMPTION_CONSEQUENCE_COUNT).map((d, i) => decisionConsequence({ decision_id: d.id, classification: i % 3 === 0 ? "risk" : "neutral" }));
    expect(assumptions.length).toBeGreaterThanOrEqual(200);
    expect(consequences.length).toBeGreaterThanOrEqual(200);
    expect(assumptions.every((a) => knownIds.has(a.decision_id))).toBe(true);
    expect(consequences.every((c) => knownIds.has(c.decision_id))).toBe(true);
    expect(hasNoDuplicates(assumptions.map((a) => a.id))).toBe(true);
    expect(hasNoDuplicates(consequences.map((c) => c.id))).toBe(true);
  });

  it("dependencies: 100+, no cycles, every edge resolves to a known decision", () => {
    const declared = buildScaleDependencyMap(decisions);
    const evidenceMap = evidenceMapFor(decisions);
    const { dependencies, cycles } = buildDecisionDependencies(decisions, declared, evidenceMap);
    const knownIds = new Set(decisions.map((d) => d.id));

    expect(dependencies.length).toBeGreaterThanOrEqual(100);
    expect(cycles).toEqual([]);
    expect(dependencies.every((d) => knownIds.has(d.from_decision_id) && knownIds.has(d.to_decision_id))).toBe(true);
    expect(hasNoDuplicates(dependencies.map((d) => d.id))).toBe(true);
    expect(isSorted(dependencies.map((d) => d.id))).toBe(true);
  });

  it("supersession chains: 50+", () => {
    const evidenceMap = evidenceMapFor(decisions);
    const { issues, chains } = buildDecisionSupersession(decisions, evidenceMap);
    expect(issues).toEqual([]);
    expect(chains.length).toBeGreaterThanOrEqual(50);
    expect(hasNoDuplicates(chains.map((c) => c.id))).toBe(true);
    const knownIds = new Set(decisions.map((d) => d.id));
    expect(chains.every((c) => c.decision_ids_in_order.every((id) => knownIds.has(id)))).toBe(true);
    expect(chains.every((c) => c.is_valid)).toBe(true);
  });

  it("conflicts: 25+", () => {
    const evidenceMap = evidenceMapFor(decisions);
    const conflicts = buildDecisionConflicts(decisions, links, [], evidenceMap);
    expect(conflicts.length).toBeGreaterThanOrEqual(25);
    expect(hasNoDuplicates(conflicts.map((c) => c.id))).toBe(true);
    const knownIds = new Set(decisions.map((d) => d.id));
    expect(conflicts.every((c) => knownIds.has(c.decision_ids[0]) && knownIds.has(c.decision_ids[1]))).toBe(true);
    expect(conflicts.filter((c) => c.kind === "active_and_superseded_simultaneously")).toHaveLength(CONFLICT_PAIR_COUNT);
  });
});

describe("scale: structural correctness through the real pipeline functions", () => {
  it("buildDecisionSnapshot over ~260 decisions is fully sorted, digest-stable, and duplicate-free", () => {
    const decisions = buildScaleDecisions();
    const snapshot = buildDecisionSnapshot({ repositoryId: "repo-scale", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });

    expect(snapshot.decisions).toHaveLength(DECISION_COUNT);
    expect(hasNoDuplicates(snapshot.decisions.map((d) => d.id))).toBe(true);
    expect(isSorted(snapshot.decisions.map((d) => d.id))).toBe(true);
    expect(typeof snapshot.digest).toBe("string");
    expect(snapshot.digest.length).toBeGreaterThan(0);
  });

  it("classifyDecisionCriticality covers every decision exactly once, sorted by decision_id", () => {
    const decisions = buildScaleDecisions();
    const assessments = classifyDecisionCriticality(decisions, { signalsAvailable: true });

    expect(assessments).toHaveLength(DECISION_COUNT);
    expect(hasNoDuplicates(assessments.map((a) => a.decision_id))).toBe(true);
    expect(isSorted(assessments.map((a) => a.decision_id))).toBe(true);
  });

  it("assessDecisionBlastRadius covers every decision exactly once, sorted by id, with resolvable affected_entity_ids", () => {
    const decisions = buildScaleDecisions();
    const links = buildScaleLinks(decisions);
    const declared = buildScaleDependencyMap(decisions);
    const evidenceMap = evidenceMapFor(decisions);
    const { dependencies } = buildDecisionDependencies(decisions, declared, evidenceMap);

    const inputs: BlastRadiusInputs = { decisions, links, dependencies, sourceIssues: [], linksAvailable: true, dependenciesAvailable: true };
    const assessments = assessDecisionBlastRadius(inputs);
    const knownDecisionIds = new Set(decisions.map((d) => d.id));

    expect(assessments).toHaveLength(DECISION_COUNT);
    expect(hasNoDuplicates(assessments.map((a) => a.id))).toBe(true);
    expect(isSorted(assessments.map((a) => a.id))).toBe(true);
    for (const assessment of assessments) {
      for (const entityId of assessment.affected_entity_ids) {
        const isKnownDecision = knownDecisionIds.has(entityId);
        const isLinkTarget = entityId.startsWith("entity:");
        expect(isKnownDecision || isLinkTarget).toBe(true);
      }
    }
  });
});

describe("scale: determinism -- running the full pipeline twice yields byte-identical output", () => {
  it("snapshot, supersession, conflicts, criticality, and blast radius are stable across two independent runs", () => {
    const decisions = buildScaleDecisions();
    const links = buildScaleLinks(decisions);
    const declared = buildScaleDependencyMap(decisions);
    const evidenceMap = evidenceMapFor(decisions);
    const { dependencies } = buildDecisionDependencies(decisions, declared, evidenceMap);

    function runOnce() {
      const snapshot = buildDecisionSnapshot({ repositoryId: "repo-scale-det", generatedAt: GENERATED_AT, decisions, sourceIssues: [] });
      const supersession = buildDecisionSupersession(decisions, evidenceMap);
      const conflicts = buildDecisionConflicts(decisions, links, dependencies, evidenceMap);
      const criticality = classifyDecisionCriticality(decisions, { signalsAvailable: true });
      const blastRadius = assessDecisionBlastRadius({ decisions, links, dependencies, sourceIssues: [], linksAvailable: true, dependenciesAvailable: true });
      return JSON.stringify({ snapshot, supersession, conflicts, criticality, blastRadius });
    }

    const first = runOnce();
    const second = runOnce();
    expect(second).toBe(first);
  });
});
