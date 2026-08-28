import { describe, expect, it } from "vitest";
import {
  DETAIL_MODES,
  TERMINOLOGY_INVARIANTS,
  VISUAL_AUDIENCES,
  audiencePolicyFor,
  type DetailMode,
  type VisualAudience,
} from "@rvs/visual-intelligence";
import { composeVisualDocument } from "../compose.js";
import { estateModel, flatModel, tinyModel } from "./fixtures.js";

const compose = (audience: VisualAudience, detail: DetailMode, m = estateModel()) =>
  composeVisualDocument({
    producer: "test",
    subject: "estate",
    semantic_intent: "architecture",
    model: m,
    audience,
    detail_mode: detail,
    format: "slide",
    focal_entity_ids: ["n000"],
  });

const drawn = (doc: ReturnType<typeof compose>) =>
  [...doc.coverage.primary_entity_ids, ...doc.coverage.detail_entity_ids].sort();

/**
 * A name for a drawn box that means the same thing in every audience's copy.
 *
 * A real node's id already does. A stand-in's does not: a collapsed group is
 * scoped to the spec that produced it, and a spec is per-audience, so the
 * same collapsed set gets a different synthetic id in each copy. What is
 * genuinely the same across audiences is *which entities went behind it*, so
 * that is what a stand-in is keyed by here.
 */
const keyOf = (doc: ReturnType<typeof compose>) => {
  const placeholders = new Map(
    doc.primary.audience.model.nodes
      .filter((n) => n.placeholder_for !== undefined)
      .map((n) => [n.id, `stand-in:${n.placeholder_for!.source_entity_ids.join(",")}`] as const),
  );
  return (nodeId: string) => placeholders.get(nodeId) ?? nodeId;
};

describe("audience and detail are independent dimensions", () => {
  it("draws the same entities for every audience at one detail mode", () => {
    // This is the whole claim of the slice. If audience could change what
    // survives, then "the executive version" and "the engineering version"
    // would be two different accounts of the same system, and a disagreement
    // between two readers would be unresolvable by looking.
    for (const detail of DETAIL_MODES) {
      const baseline = drawn(compose("engineering", detail));
      for (const audience of VISUAL_AUDIENCES) {
        expect(drawn(compose(audience, detail)), `${audience}/${detail}`).toEqual(baseline);
      }
    }
  });

  it("gives every audience the same structure, in the same reading order", () => {
    // Not the same *geometry*: an audience whose policy draws stable ids has
    // longer labels, and a box wide enough to hold its label is the correct
    // response to that. What must not move is which boxes exist and the order
    // a reader -- or a screen reader -- meets them in.
    const structure = (a: VisualAudience) => {
      const doc = compose(a, "balanced");
      const key = keyOf(doc);
      return doc.primary.render.boxes.map((b) => key(b.node_id));
    };
    const baseline = JSON.stringify(structure("engineering"));
    for (const audience of VISUAL_AUDIENCES) {
      expect(JSON.stringify(structure(audience)), audience).toBe(baseline);
    }
  });

  it("gives audiences that word things identically an identical geometry", () => {
    // The narrower claim, where it genuinely holds: same words, same drawing.
    const geometry = (a: VisualAudience) => {
      const doc = compose(a, "balanced");
      const key = keyOf(doc);
      return JSON.stringify(doc.primary.render.boxes.map((b) => [key(b.node_id), b.rect.x, b.rect.y]));
    };
    const byExposure = new Map<string, VisualAudience[]>();
    for (const audience of VISUAL_AUDIENCES) {
      const key = audiencePolicyFor(audience).identifier_exposure;
      byExposure.set(key, [...(byExposure.get(key) ?? []), audience]);
    }
    for (const [exposure, group] of byExposure) {
      const baseline = geometry(group[0]);
      for (const audience of group) expect(geometry(audience), `${exposure}/${audience}`).toBe(baseline);
    }
  });

  it("changes how much survives when the detail mode changes", () => {
    // Counted in entities rather than boxes: a stand-in is a box, but it is
    // not something that survived.
    const counts = DETAIL_MODES.map(
      (d) => compose("engineering", d, flatModel()).coverage.primary_entity_ids.length,
    );
    // Not merely different: monotonically non-increasing from faithful to
    // simplified, in the published order of DETAIL_MODES.
    expect(counts[0]).toBeGreaterThanOrEqual(counts[1]);
    expect(counts[1]).toBeGreaterThanOrEqual(counts[2]);
    expect(counts[0]).toBeGreaterThan(counts[2]);
  });

  it("does not treat executive as a synonym for simplified", () => {
    // The forbidden shortcut, stated as a test. An executive reading an
    // incident review asks for every node; an engineer orienting on an
    // unfamiliar system asks for the map. Both are ordinary requests.
    const executiveFaithful = compose("executive", "faithful", flatModel()).coverage.primary_entity_ids.length;
    const engineeringSimplified = compose("engineering", "simplified", flatModel()).coverage
      .primary_entity_ids.length;
    expect(executiveFaithful).toBeGreaterThan(engineeringSimplified);
  });

  it("supports every audience/detail pairing without a validation finding", () => {
    for (const audience of VISUAL_AUDIENCES) {
      for (const detail of DETAIL_MODES) {
        const doc = compose(audience, detail);
        expect(doc.validation, `${audience}/${detail}`).toEqual([]);
      }
    }
  });
});

describe("an audience policy restates nothing that upstream owns", () => {
  it("carries severity, decision status, resolution, and confidence through unchanged", () => {
    // Read from the invariant list itself rather than hard-coded here, so
    // adding an invariant upstream without honouring it fails this test.
    expect([...TERMINOLOGY_INVARIANTS].sort()).toEqual(
      ["confidence", "decision_status", "governance_severity", "resolution_status"].sort(),
    );

    // Stand-ins are excluded: they are not entities, they carry no upstream
    // state to preserve, and their synthetic ids embed the spec digest, which
    // legitimately differs between audiences.
    const stateOf = (audience: VisualAudience) =>
      compose(audience, "faithful")
        .primary.audience.model.nodes.filter((n) => n.placeholder_for === undefined)
        .map((n) => ({
          id: n.id,
          governance_severity: n.severity,
          decision_status: n.decision_status,
          resolution_status: n.resolution,
          confidence: n.confidence,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));

    const baseline = JSON.stringify(stateOf("engineering"));
    for (const audience of VISUAL_AUDIENCES) {
      expect(JSON.stringify(stateOf(audience)), audience).toBe(baseline);
    }
  });

  it("draws stable ids only where the policy exposes them", () => {
    for (const audience of VISUAL_AUDIENCES) {
      const policy = audiencePolicyFor(audience);
      const doc = compose(audience, "balanced");
      const labels = doc.primary.audience.model.nodes.map((n) => n.label);
      const drawsIds = labels.some((l) => l.includes("(n0"));
      expect(drawsIds, audience).toBe(policy.identifier_exposure === "label-and-id");
    }
  });

  it("keeps the id reachable as data even when the policy does not draw it", () => {
    // "Not drawn" is a presentation choice, not a redaction. The inspector
    // and any downstream tooling still need to resolve a box to an entity.
    const svg = compose("executive", "balanced").primary.render.svg;
    expect(svg).toContain('data-rvs-entity="n000"');
    expect(svg).not.toContain("(n000)");
  });

  it("discloses an annotation it did not draw, rather than quietly dropping it", () => {
    const doc = compose("executive", "faithful");
    const reduced = doc.audience_adjustments.find((a) => a.code === "AUDIENCE_ANNOTATIONS_REDUCED");
    expect(reduced, "minimal annotation depth should reduce and say so").toBeTruthy();
    expect(reduced!.subject_ids.length).toBeGreaterThan(0);
    expect(reduced!.detail).toContain("No entity was removed");
    // And the full-depth audience keeps them all, with nothing to disclose.
    expect(
      compose("engineering", "faithful").audience_adjustments.find(
        (a) => a.code === "AUDIENCE_ANNOTATIONS_REDUCED",
      ),
    ).toBeUndefined();
  });

  it("summarises evidence for the audiences whose policy summarises it", () => {
    for (const audience of VISUAL_AUDIENCES) {
      const policy = audiencePolicyFor(audience);
      const caption = compose(audience, "balanced").primary.audience.evidence_caption;
      expect(caption !== undefined, audience).toBe(policy.evidence_visibility === "summarised");
    }
  });

  it("carries evidence refs through for every audience, drawn or not", () => {
    for (const audience of VISUAL_AUDIENCES) {
      const nodes = compose(audience, "faithful").primary.audience.model.nodes.filter(
        (n) => n.placeholder_for === undefined,
      );
      expect(nodes.length, audience).toBeGreaterThan(0);
      expect(nodes.every((n) => n.evidence_refs.length > 0), audience).toBe(true);
    }
  });
});

describe("a view that reduced nothing still says so", () => {
  it("marks the receipt as not required when every entity was drawn", () => {
    const doc = composeVisualDocument({
      producer: "test",
      subject: "tiny",
      semantic_intent: "architecture",
      model: tinyModel(),
      audience: "engineering",
      detail_mode: "faithful",
      format: "slide",
    });
    expect(doc.receipt_required).toBe(false);
    expect(doc.receipt.reason_codes).toEqual(["FIDELITY_NO_REDUCTION"]);
    expect(doc.coverage.hidden_entity_ids).toEqual([]);
    expect(doc.coverage.unaccounted_entity_ids).toEqual([]);
  });
});
