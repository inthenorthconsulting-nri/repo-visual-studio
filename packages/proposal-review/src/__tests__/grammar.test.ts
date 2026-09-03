// Core behavioral proof for buildProposalVisualGrammar() (Milestone 11.3.2).
// Covers: determinism, exhaustive per-entity/relation provenance mapping
// (proposed/modified/removed/confirmed), the not_built-vs-built-without-
// overlay distinction, topology-status and freshness passthrough matrices,
// governance/decision/impact basis-wrapping (with an explicit
// VisualDecisionStatus-collision regression), a VisualConfidence-collision
// regression, color-independence, a reduced-motion narrow proof, an
// adaptive-detail narrow proof, and a forbidden-wording sweep over the full
// serialized output.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangeWorkbenchProjectionOutcome } from "@rvs/change-workbench";
import { FORBIDDEN_PROPOSAL_TRUTH_WORDING, buildProposalTruthDisclosure, resolveProposalEntityProvenance, validateColorIndependence } from "@rvs/visual-intelligence";
import type { ProposalAdvisoryFreshness, ProposalTopologyDisclosureStatus, ProposalTruthDisclosure } from "@rvs/visual-intelligence";

import { buildProposalReviewVisualInput } from "../adapter.js";
import { buildProposalVisualGrammar } from "../grammar.js";
import type { ProposalReviewVisualInput } from "../contracts.js";
import { BASE_SNAPSHOT_DIGEST, compatibleObservedBaseline, invalidEvaluation, mixedProvenanceEvaluation, validEvaluation } from "./fixtures.js";

function okInput(evaluation: ReturnType<typeof validEvaluation>, freshness: ProposalAdvisoryFreshness = "current"): ProposalReviewVisualInput {
  const result = buildProposalReviewVisualInput({ evaluation, observedBaseline: compatibleObservedBaseline(BASE_SNAPSHOT_DIGEST), advisoryFreshness: freshness });
  if (result.status !== "ok") throw new Error("fixture setup error: expected buildProposalReviewVisualInput to succeed");
  return result.input;
}

describe("buildProposalVisualGrammar: determinism", () => {
  it("the same input produces a byte-identical result across repeated calls", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const first = buildProposalVisualGrammar(input);
    const second = buildProposalVisualGrammar(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("buildProposalVisualGrammar: per-entity/relation provenance mapping", () => {
  it("maps all four OverlayEntityProvenance values from a mixed proposal onto resolveProposalEntityProvenance's presentations", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);

    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const allEntries = [...grammar.projection.entities, ...grammar.projection.relations];
    const observedProvenances = new Set(allEntries.map((entry) => entry.presentation.provenance));
    expect(observedProvenances.has("confirmed")).toBe(true);
    expect(observedProvenances.has("proposed")).toBe(true);
    expect(observedProvenances.has("modified")).toBe(true);
    expect(observedProvenances.has("removed")).toBe(true);

    for (const entry of allEntries) {
      expect(entry.presentation).toEqual(resolveProposalEntityProvenance(entry.presentation.provenance));
    }
  });

  it("a proposed (added) entity carries visual_state ['added'] and a 'not observed' badge, never a fabricated diff", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const proposedEntity = grammar.projection.entities.find((entry) => entry.presentation.provenance === "proposed");
    expect(proposedEntity).toBeDefined();
    expect(proposedEntity!.presentation.visual_state).toEqual(["added"]);
    expect(proposedEntity!.presentation.badge).toMatch(/not observed/i);
    expect(Object.keys(proposedEntity!)).toEqual(["id", "presentation"]);
  });

  it("a modified entity carries visual_state ['changed'] and a 'not observed' badge -- observed identity retained, proposed change layered on top", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const modifiedEntity = grammar.projection.entities.find((entry) => entry.presentation.provenance === "modified");
    expect(modifiedEntity).toBeDefined();
    expect(modifiedEntity!.presentation.visual_state).toEqual(["changed"]);
    expect(modifiedEntity!.presentation.badge).toMatch(/not observed/i);
  });

  it("a removed entity carries visual_state ['removed'] and a 'not observed' badge, and is absent from overlay.nodes while present in the grammar's provenance manifest -- the removal marker never becomes projected topology", () => {
    const input = okInput(mixedProvenanceEvaluation());
    expect(input.projection.status).toBe("built");
    if (input.projection.status !== "built") return;
    const overlay = input.projection.result.overlay!;

    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const removedEntity = grammar.projection.entities.find((entry) => entry.presentation.provenance === "removed");
    expect(removedEntity).toBeDefined();
    expect(removedEntity!.presentation.visual_state).toEqual(["removed"]);
    expect(removedEntity!.presentation.badge).toMatch(/not observed/i);
    // Structurally absent from the overlay's own node list (the observed
    // review subject, minus its proposed removal, is not a live node) --
    // the grammar model carries no node/edge connectivity of its own, so a
    // removed entity can never be inserted into "projected topology" here.
    expect(overlay.nodes.some((node) => node.id === removedEntity!.id)).toBe(false);
  });

  it("a confirmed entity is unmarked -- empty visual_state, no badge -- unchanged entities are not decorated", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const confirmedEntity = grammar.projection.entities.find((entry) => entry.presentation.provenance === "confirmed");
    expect(confirmedEntity).toBeDefined();
    expect(confirmedEntity!.presentation.visual_state).toEqual([]);
    expect(confirmedEntity!.presentation.badge).toBeUndefined();
  });

  it("entities and relations are sorted by id, independent of the source record's own key order", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;

    const entityIds = grammar.projection.entities.map((entry) => entry.id);
    expect(entityIds).toEqual([...entityIds].sort());
    const relationIds = grammar.projection.relations.map((entry) => entry.id);
    expect(relationIds).toEqual([...relationIds].sort());
  });
});

describe("buildProposalVisualGrammar: projection availability", () => {
  it("projection.status === 'not_built' produces literally no entities/relations fields, only a reason", () => {
    const input = okInput(invalidEvaluation());
    expect(input.projection.status).toBe("not_built");

    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("not_built");
    expect("entities" in grammar.projection).toBe(false);
    expect("relations" in grammar.projection).toBe(false);
    if (grammar.projection.status === "not_built") {
      expect(typeof grammar.projection.reason).toBe("string");
      expect(grammar.projection.reason.length).toBeGreaterThan(0);
    }
  });

  it("projection.status === 'built' with no overlay (an unresolved/invalid build attempt) is treated identically to not_built, with its own distinct reason", () => {
    const input = okInput(validEvaluation());
    const tamperedProjection: ChangeWorkbenchProjectionOutcome = {
      status: "built",
      result: { status: "unresolved", overlay: undefined, issues: [{ code: "FIXTURE_SYNTHETIC_UNRESOLVED", detail: "synthetic fixture: build attempted but produced no overlay", blocking: false }] },
    };
    const tamperedInput: ProposalReviewVisualInput = { ...input, projection: tamperedProjection };

    const grammar = buildProposalVisualGrammar(tamperedInput);
    expect(grammar.projection.status).toBe("not_built");
    expect("entities" in grammar.projection).toBe(false);
    if (grammar.projection.status === "not_built") {
      expect(grammar.projection.reason).toMatch(/unresolved/i);
    }
  });

  it("emits no projected architecture for either not_built shape -- neither ever fabricates an empty 'built' overlay", () => {
    const notBuilt = buildProposalVisualGrammar(okInput(invalidEvaluation()));
    expect(notBuilt.projection.status).not.toBe("built");
  });
});

describe("buildProposalVisualGrammar: truth_disclosure passthrough (topology-status matrix)", () => {
  const STATUSES: ProposalTopologyDisclosureStatus[] = ["explicit", "not_supplied", "partial", "unresolved"];

  it.each(STATUSES)("passes topology_disclosure_status %s through byte-identical, never re-reducing it", (status) => {
    const base = okInput(validEvaluation());
    const truthDisclosure: ProposalTruthDisclosure = buildProposalTruthDisclosure({
      repository_id: base.repository_id,
      base_snapshot_digest: base.base_snapshot_digest,
      proposal_id: base.proposal_id,
      advisory_id: base.advisory.id,
      topology: [{ status }],
      advisory_freshness: "current",
    });
    const input: ProposalReviewVisualInput = { ...base, truth_disclosure: truthDisclosure };

    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.truth_disclosure).toEqual(truthDisclosure);
    expect(grammar.truth_disclosure.topology_disclosure_status).toBe(status);
  });
});

describe("buildProposalVisualGrammar: truth_disclosure passthrough (freshness matrix)", () => {
  const FRESHNESS_STATES: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];

  it.each(FRESHNESS_STATES)("passes advisory_freshness %s through byte-identical, never re-deriving it", (freshness) => {
    const input = okInput(validEvaluation(), freshness);
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.truth_disclosure).toEqual(input.truth_disclosure);
    expect(grammar.truth_disclosure.advisory_freshness).toBe(freshness);
  });
});

describe("buildProposalVisualGrammar: governance/decision/impact advisory basis", () => {
  it("wraps governance/decisions/impact with an explicit basis: 'proposal' marker, passing the advisory's own findings through unmodified", () => {
    const input = okInput(validEvaluation());
    const grammar = buildProposalVisualGrammar(input);

    expect(grammar.governance.basis).toBe("proposal");
    expect(grammar.governance.result).toEqual(input.advisory.governance);
    expect(grammar.decisions.basis).toBe("proposal");
    expect(grammar.decisions.result).toEqual(input.advisory.decisions);
    expect(grammar.impact.basis).toBe("proposal");
    expect(grammar.impact.result).toEqual(input.advisory.impact);
  });

  it("never introduces a 'decision_status' field, and in particular never sets one to 'proposed' -- decision lifecycle and proposal-review basis are independent axes", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    const serialized = JSON.stringify(grammar);
    expect(serialized.includes('"decision_status"')).toBe(false);
  });
});

describe("buildProposalVisualGrammar: VisualDecisionStatus / VisualConfidence collision regression (static audit)", () => {
  // Mirrors forbidden-evaluator-call.test.ts's stripComments approach: this
  // module's own header comment discusses, by name, the two types it must
  // never use in code, so the CODE text (not the prose) is what must be free
  // of them.
  const code = readFileSync(join(__dirname, "..", "grammar.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("grammar.ts's code never references VisualDecisionStatus -- proposal-review basis must never be represented as a decision lifecycle value", () => {
    expect(code.includes("VisualDecisionStatus")).toBe(false);
  });

  it("grammar.ts's code never references VisualConfidence -- proposal-derived provenance must never be substituted for Workbench OverlayEntityProvenance confidence", () => {
    expect(code.includes("VisualConfidence")).toBe(false);
  });
});

describe("buildProposalVisualGrammar: color-independence", () => {
  it("proposed/modified/removed presentations each carry a non-colour channel sufficient to pass validateColorIndependence", () => {
    for (const [provenance, colorRole] of [
      ["proposed", "added"],
      ["modified", "changed"],
      ["removed", "removed"],
    ] as const) {
      const presentation = resolveProposalEntityProvenance(provenance);
      const findings = validateColorIndependence(`fixture.${provenance}`, [{ state: provenance, color_role: colorRole, non_color_channels: presentation.non_color_channels }]);
      expect(findings).toEqual([]);
    }
  });
});

describe("buildProposalVisualGrammar: reduced-motion (narrow proof)", () => {
  it("presentations carry no motion/timing field of any kind -- there is nothing here for reduced-motion to alter, because nothing here animates", () => {
    for (const provenance of ["confirmed", "proposed", "modified", "removed"] as const) {
      const presentation = resolveProposalEntityProvenance(provenance);
      const keys = Object.keys(presentation);
      expect(keys).toEqual(keys.filter((key) => !/motion|transition|animat|duration/i.test(key)));
    }
  });
});

describe("buildProposalVisualGrammar: adaptive-detail (narrow proof)", () => {
  it("a projected entity/relation entry carries exactly {id, presentation} -- no detail-level/emphasis/resolution field, this slice does not expand into full composition", () => {
    const input = okInput(mixedProvenanceEvaluation());
    const grammar = buildProposalVisualGrammar(input);
    expect(grammar.projection.status).toBe("built");
    if (grammar.projection.status !== "built") return;
    for (const entry of [...grammar.projection.entities, ...grammar.projection.relations]) {
      expect(Object.keys(entry).sort()).toEqual(["id", "presentation"]);
    }
  });
});

describe("buildProposalVisualGrammar: forbidden-wording regression sweep", () => {
  it("the full serialized output never contains any FORBIDDEN_PROPOSAL_TRUTH_WORDING phrase, for every evaluation/freshness fixture", () => {
    const evaluations = [validEvaluation(), invalidEvaluation(), mixedProvenanceEvaluation()];
    const freshnessStates: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];

    for (const evaluation of evaluations) {
      for (const freshness of freshnessStates) {
        const input = okInput(evaluation, freshness);
        const grammar = buildProposalVisualGrammar(input);
        const serialized = JSON.stringify(grammar).toLowerCase();
        for (const phrase of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
          expect(serialized.includes(phrase.toLowerCase())).toBe(false);
        }
      }
    }
  });
});
