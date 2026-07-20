import { describe, expect, it } from "vitest";
import { buildCapabilityLinks } from "../capability-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function frontmatterWithLink(overrides: Partial<{ type: string; domain: string; target: string }> = {}) {
  return { links: [{ type: "requires", domain: "capability", target: "cap-1", ...overrides }] };
}

describe("buildCapabilityLinks: declaration gating", () => {
  it("returns [] when frontmatter is undefined", () => {
    const decision = architectureDecision();
    expect(buildCapabilityLinks(decision, undefined, undefined)).toEqual([]);
  });

  it("returns [] when frontmatter has no links at all", () => {
    const decision = architectureDecision();
    expect(buildCapabilityLinks(decision, {}, undefined)).toEqual([]);
  });

  it("returns [] when declared links all target a different domain", () => {
    const decision = architectureDecision();
    const frontmatter = { links: [{ type: "governs", domain: "architecture", target: "comp-1" }] };
    expect(buildCapabilityLinks(decision, frontmatter, undefined)).toEqual([]);
  });

  it("does not infer a link from shared terminology between the decision's prose and a capability's name", () => {
    const decision = architectureDecision({ context: "This relates to checkout capability quite directly.", decision_text: "checkout is the capability at stake." });
    const snapshot = { capabilities: [{ id: "checkout" }] };
    expect(buildCapabilityLinks(decision, {}, snapshot)).toEqual([]);
    expect(buildCapabilityLinks(decision, undefined, snapshot)).toEqual([]);
  });

  it("only picks up entries whose target_domain is capability, ignoring other domains declared alongside", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "requires", domain: "capability", target: "cap-1" },
        { type: "governs", domain: "architecture", target: "cap-1" },
        { type: "affects", domain: "portfolio", target: "cap-1" },
      ],
    };
    const links = buildCapabilityLinks(decision, frontmatter, undefined);
    expect(links).toHaveLength(1);
    expect(links[0].target_domain).toBe("capability");
  });
});

describe("buildCapabilityLinks: resolution", () => {
  it("is unresolved and kept when capabilitySnapshot is undefined", () => {
    const decision = architectureDecision();
    const links = buildCapabilityLinks(decision, frontmatterWithLink(), undefined);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
  });

  it("is unresolved and kept when the snapshot does not contain the target entity id", () => {
    const decision = architectureDecision();
    const snapshot = { capabilities: [{ id: "cap-other" }] };
    const links = buildCapabilityLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].detail).toContain("could not be confirmed");
  });

  it("resolves when the snapshot structurally contains the target entity id, however nested", () => {
    const decision = architectureDecision();
    const snapshot = { groups: [{ capabilities: [{ id: "cap-1", name: "Cap One" }] }] };
    const links = buildCapabilityLinks(decision, frontmatterWithLink(), snapshot);
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("cap-1");
    expect(links[0].detail).toContain('requires capability "cap-1"');
  });

  it("derives id via buildLinkId(decision.id, link_type, target_key)", () => {
    const decision = architectureDecision({ id: "decision:test-1" });
    const links = buildCapabilityLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].id).toBe(buildLinkId("decision:test-1", "requires", "cap-1"));
  });

  it("carries the decision's evidence_refs on the produced link", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ evidence_refs: refs });
    const links = buildCapabilityLinks(decision, frontmatterWithLink(), undefined);
    expect(links[0].evidence_refs).toBe(refs);
  });

  it("resolves multiple declared capability links independently", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "requires", domain: "capability", target: "cap-1" },
        { type: "implements", domain: "capability", target: "cap-2" },
      ],
    };
    const snapshot = { capabilities: [{ id: "cap-1" }] };
    const links = buildCapabilityLinks(decision, frontmatter, snapshot);
    expect(links).toHaveLength(2);
    const byId = new Map(links.map((l) => [l.id, l]));
    expect(byId.get(buildLinkId(decision.id, "requires", "cap-1"))?.resolution).toBe("resolved");
    expect(byId.get(buildLinkId(decision.id, "implements", "cap-2"))?.resolution).toBe("unresolved");
  });
});
