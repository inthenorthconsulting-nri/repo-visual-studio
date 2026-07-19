import { describe, expect, it } from "vitest";
import { proofPointId } from "../ids.js";
import { buildExecutiveNarrative } from "../narrative.js";
import { makeProductClaim, makeProductIdentity } from "./fixtures.js";

describe("buildExecutiveNarrative", () => {
  it("splits approved, rejected, and runtime-verification-required claims into their respective buckets", () => {
    const approved = makeProductClaim({ id: "prodintel:claim:identity:identity", status: "approved" });
    const qualified = makeProductClaim({ id: "prodintel:claim:capability:a", status: "approved_with_qualification", claimType: "capability" });
    const rejected = makeProductClaim({ id: "prodintel:claim:purpose:purpose", status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_GENERIC_MARKETING"] });
    const runtime = makeProductClaim({ id: "prodintel:claim:adoption:x", status: "runtime_verification_required", claimType: "adoption" });

    const narrative = buildExecutiveNarrative(makeProductIdentity(), [approved, qualified, rejected, runtime], "executive");
    expect(narrative.approvedClaims.map((c) => c.id)).toEqual([approved.id, qualified.id].sort());
    expect(narrative.rejectedClaims.map((c) => c.id)).toEqual([rejected.id]);
    expect(narrative.runtimeVerificationClaims.map((c) => c.id)).toEqual([runtime.id]);
  });

  it("splits the problem statement off identity.purpose at the first ' by providing ' delimiter", () => {
    const identity = makeProductIdentity({ purpose: "Teams lack a governed way to operate widgets by providing governance oversight for compliance officers." });
    const narrative = buildExecutiveNarrative(identity, [], "executive");
    expect(narrative.problemStatement).toBe("Teams lack a governed way to operate widgets");
  });

  it("uses the full purpose as the problem statement when there is no ' by providing ' delimiter", () => {
    const identity = makeProductIdentity({ purpose: "Teams lack a governed way to operate widgets." });
    const narrative = buildExecutiveNarrative(identity, [], "executive");
    expect(narrative.problemStatement).toBe("Teams lack a governed way to operate widgets.");
  });

  it("builds proof points only from approved maturity/outcome/differentiator claims, never identity/purpose/capability claims", () => {
    const maturity = makeProductClaim({ id: "prodintel:claim:maturity:maturity", status: "approved", claimType: "maturity", text: "3 of 5 evaluated capabilities are currently included." });
    const outcome = makeProductClaim({ id: "prodintel:claim:outcome:a", status: "approved", claimType: "outcome" });
    const differentiator = makeProductClaim({ id: "prodintel:claim:differentiator:a", status: "approved", claimType: "differentiator" });
    const identityClaim = makeProductClaim({ id: "prodintel:claim:identity:identity", status: "approved", claimType: "identity" });
    const capabilityClaim = makeProductClaim({ id: "prodintel:claim:capability:a", status: "approved", claimType: "capability" });

    const narrative = buildExecutiveNarrative(makeProductIdentity(), [maturity, outcome, differentiator, identityClaim, capabilityClaim], "executive");
    expect(narrative.proofPoints).toHaveLength(3);
    expect(narrative.proofPoints.map((p) => p.label).sort()).toEqual(["differentiator", "maturity", "outcome"]);
  });

  it("caps proof points at MAX_PROOF_POINTS (6) even when more qualifying claims are approved", () => {
    const claims = Array.from({ length: 8 }, (_, i) => makeProductClaim({ id: `prodintel:claim:outcome:${i}`, status: "approved", claimType: "outcome", text: `Outcome ${i}` }));
    const narrative = buildExecutiveNarrative(makeProductIdentity(), claims, "executive");
    expect(narrative.proofPoints).toHaveLength(6);
  });

  it("maps claim status to ShowcaseMetricStatus: approved -> confirmed, approved_with_qualification -> derived", () => {
    const approved = makeProductClaim({ id: "prodintel:claim:outcome:a", status: "approved", claimType: "outcome" });
    const qualified = makeProductClaim({ id: "prodintel:claim:outcome:b", status: "approved_with_qualification", claimType: "outcome" });
    const narrative = buildExecutiveNarrative(makeProductIdentity(), [approved, qualified], "executive");
    const byId = new Map(narrative.proofPoints.map((p) => [p.id, p.status]));
    expect(byId.get(proofPointId(approved.id))).toBe("confirmed");
    expect(byId.get(proofPointId(qualified.id))).toBe("derived");
  });

  it("collects limitations from both identity.limitations and every approved claim's qualifiers, deduplicated and sorted", () => {
    const identity = makeProductIdentity({ limitations: ["No multi-region support yet."] });
    const qualified = makeProductClaim({ id: "prodintel:claim:capability:a", status: "approved_with_qualification", claimType: "capability", qualifiers: ["Evidence for this capability is partial; treat as qualified, not fully verified."] });
    const duplicateQualified = makeProductClaim({ id: "prodintel:claim:capability:b", status: "approved_with_qualification", claimType: "capability", qualifiers: ["Evidence for this capability is partial; treat as qualified, not fully verified."] });

    const narrative = buildExecutiveNarrative(identity, [qualified, duplicateQualified], "executive");
    expect(narrative.limitations).toEqual(["Evidence for this capability is partial; treat as qualified, not fully verified.", "No multi-region support yet."].sort((a, b) => a.localeCompare(b)));
  });

  it("does not pull qualifiers from rejected or runtime-verification-required claims into limitations", () => {
    const rejected = makeProductClaim({ id: "prodintel:claim:purpose:purpose", status: "rejected", rejectionReasons: ["SHOWCASE_CLAIM_GENERIC_MARKETING"], qualifiers: ["should not appear"] });
    const narrative = buildExecutiveNarrative(makeProductIdentity({ limitations: [] }), [rejected], "executive");
    expect(narrative.limitations).toEqual([]);
  });

  it("truncates centralMessage to 24 words from identity.shortPromise", () => {
    const longPromise = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const identity = makeProductIdentity({ shortPromise: longPromise });
    const narrative = buildExecutiveNarrative(identity, [], "executive");
    expect(narrative.centralMessage.split(/\s+/)).toHaveLength(24);
  });

  it("formats objective by replacing underscores in the audience with spaces", () => {
    const narrative = buildExecutiveNarrative(makeProductIdentity(), [], "product_leader");
    expect(narrative.objective).toContain("product leader stakeholders");
  });

  it("includes a fixed closing message referencing the product's display name", () => {
    const identity = makeProductIdentity({ displayName: "Widget Platform" });
    const narrative = buildExecutiveNarrative(identity, [], "executive");
    expect(narrative.closingMessage).toContain("Widget Platform is presented here strictly by what is currently proven");
  });

  it("passes through identity.valuePillars and identity.differentiators unchanged", () => {
    const identity = makeProductIdentity();
    const narrative = buildExecutiveNarrative(identity, [], "executive");
    expect(narrative.valuePillars).toEqual(identity.valuePillars);
    expect(narrative.differentiators).toEqual(identity.differentiators);
  });

  it("is deterministic: two builds of the same input produce byte-identical output", () => {
    const identity = makeProductIdentity();
    const claims = [makeProductClaim()];
    const a = buildExecutiveNarrative(identity, claims, "executive");
    const b = buildExecutiveNarrative(identity, claims, "executive");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
