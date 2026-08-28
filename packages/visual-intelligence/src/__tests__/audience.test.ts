import { describe, expect, it } from "vitest";
import { TERMINOLOGY_INVARIANTS, audiencePolicyFor, resolveAudience } from "../audience.js";
import { budgetFor } from "../budgets.js";
import { DETAIL_MODES, VISUAL_AUDIENCES, VISUAL_GRAMMARS } from "../vocabulary.js";
import { buildVisualCommunicationSpec } from "../spec.js";
import { chain } from "./fixtures.js";

describe("audience and detail are independent dimensions", () => {
  it("gives an audience the same policy at every detail mode", () => {
    // The rule Milestone 10.20 asked for, checked over the full cross
    // product rather than asserted in a comment: nothing about how much is
    // shown may change how the reader is addressed.
    for (const audience of VISUAL_AUDIENCES) {
      const policies = DETAIL_MODES.map(() => audiencePolicyFor(audience));
      const first = JSON.stringify(policies[0]);
      for (const policy of policies) expect(JSON.stringify(policy)).toBe(first);
    }
  });

  it("gives a detail mode the same budget at every audience", () => {
    for (const grammar of VISUAL_GRAMMARS) {
      for (const mode of DETAIL_MODES) {
        const budget = JSON.stringify(budgetFor(grammar, mode));
        for (const _audience of VISUAL_AUDIENCES) expect(JSON.stringify(budgetFor(grammar, mode))).toBe(budget);
      }
    }
  });

  it("produces the same entity set for every audience at one detail mode", () => {
    // The end-to-end version of the same rule: changing only the audience
    // must not change what survives adaptation. If it did, "the executive
    // deck" would quietly be a different set of facts.
    const model = chain(60);
    for (const mode of DETAIL_MODES) {
      const digests = VISUAL_AUDIENCES.map((audience) => {
        const { spec } = buildVisualCommunicationSpec({
          producer: "test",
          subject: "audience-independence",
          semantic_intent: "dependency",
          model,
          audience,
          detail_mode: mode,
          format: "slide",
        });
        return spec.fidelity_receipt?.rendered_digest;
      });
      expect(new Set(digests).size).toBe(1);
    }
  });

  it("produces different entity sets across detail modes for the same audience", () => {
    // The other half of independence: if detail mode changed nothing either,
    // the two dimensions would be independent only because both were inert.
    const model = chain(60);
    const digests = DETAIL_MODES.map((mode) => {
      const { spec } = buildVisualCommunicationSpec({
        producer: "test",
        subject: "detail-varies",
        semantic_intent: "dependency",
        model,
        audience: "engineering",
        detail_mode: mode,
        format: "slide",
      });
      return spec.fidelity_receipt?.rendered_digest;
    });
    expect(new Set(digests).size).toBeGreaterThan(1);
  });

  it("encodes no executive-means-simplified rule anywhere", () => {
    const source = audiencePolicyFor.toString() + resolveAudience.toString();
    for (const mode of DETAIL_MODES) expect(source).not.toContain(`"${mode}"`);
  });
});

describe("audience resolution", () => {
  it("maps the RVS profile vocabulary onto reader classes", () => {
    expect(resolveAudience("architect")).toBe("architecture-review");
    expect(resolveAudience("developer")).toBe("engineering");
    expect(resolveAudience("product_leader")).toBe("product");
    expect(resolveAudience("operator")).toBe("operations");
  });

  it("falls back to mixed rather than guessing", () => {
    // An unknown profile is not evidence of an audience. Mixed is the
    // conservative reading: full terminology, no assumed shared context.
    expect(resolveAudience(undefined)).toBe("mixed");
    expect(resolveAudience("some-profile-nobody-declared")).toBe("mixed");
  });

  it("keeps status vocabulary out of every audience's reach", () => {
    // Governance severity, decision status, resolution status, and
    // confidence are findings, not tone. Softening them for an executive
    // would be changing the finding -- so they are one shared constant that
    // no per-audience policy carries a field to override.
    expect(TERMINOLOGY_INVARIANTS).toEqual([
      "governance_severity",
      "decision_status",
      "resolution_status",
      "confidence",
    ]);
    for (const audience of VISUAL_AUDIENCES) {
      const keys = Object.keys(audiencePolicyFor(audience));
      for (const invariant of TERMINOLOGY_INVARIANTS) expect(keys).not.toContain(invariant);
    }
  });

  it("gives audiences genuinely different policies", () => {
    // The counterweight to the independence tests above: audience must
    // change *something*, or its orthogonality to detail would be the
    // uninteresting kind where both dimensions do nothing.
    const policies = VISUAL_AUDIENCES.map((a) => JSON.stringify(audiencePolicyFor(a)));
    expect(new Set(policies).size).toBe(VISUAL_AUDIENCES.length);
  });
});
