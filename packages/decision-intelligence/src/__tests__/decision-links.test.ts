import { describe, expect, it } from "vitest";
import { buildDecisionToDecisionLinks } from "../decision-links.js";
import { buildLinkId } from "../ids.js";
import { architectureDecision, evidenceRef } from "./decision-fixtures.js";

function frontmatterWithLink(overrides: Partial<{ type: string; domain: string; target: string }> = {}) {
  return { links: [{ type: "depends_on", domain: "decision", target: "decision:other", ...overrides }] };
}

describe("buildDecisionToDecisionLinks: declaration gating", () => {
  it("returns [] when frontmatter is undefined", () => {
    const decision = architectureDecision();
    expect(buildDecisionToDecisionLinks(decision, undefined, new Set())).toEqual([]);
  });

  it("returns [] when frontmatter has no links at all", () => {
    const decision = architectureDecision();
    expect(buildDecisionToDecisionLinks(decision, {}, new Set())).toEqual([]);
  });

  it("returns [] when declared links all target a different domain", () => {
    const decision = architectureDecision();
    const frontmatter = { links: [{ type: "requires", domain: "capability", target: "cap-1" }] };
    expect(buildDecisionToDecisionLinks(decision, frontmatter, new Set())).toEqual([]);
  });

  it("only picks up entries whose target_domain is decision, ignoring other domains declared alongside", () => {
    const decision = architectureDecision();
    const frontmatter = {
      links: [
        { type: "depends_on", domain: "decision", target: "decision:other" },
        { type: "requires", domain: "capability", target: "decision:other" },
        { type: "affects", domain: "product", target: "decision:other" },
      ],
    };
    const links = buildDecisionToDecisionLinks(decision, frontmatter, new Set(["decision:other"]));
    expect(links).toHaveLength(1);
    expect(links[0].target_domain).toBe("decision");
  });
});

describe("buildDecisionToDecisionLinks: resolution", () => {
  it("resolves a link to a real other decision id", () => {
    const decision = architectureDecision({ id: "decision:a" });
    const links = buildDecisionToDecisionLinks(decision, frontmatterWithLink(), new Set(["decision:a", "decision:other"]));
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("resolved");
    expect(links[0].target_id).toBe("decision:other");
    expect(links[0].detail).toBe('Decision "decision:a" depends_ons decision "decision:other".');
    expect(links[0].id).toBe(buildLinkId("decision:a", "depends_on", "decision:other"));
  });

  it("is unresolved when the target decision id does not exist among discovered decisions", () => {
    const decision = architectureDecision({ id: "decision:a" });
    const links = buildDecisionToDecisionLinks(decision, frontmatterWithLink(), new Set(["decision:a"]));
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
    expect(links[0].detail).toBe('Decision "decision:a" declares a "depends_on" link to decision "decision:other", which was not found among discovered decisions.');
  });

  it("is always unresolved for a self-link, with the self-link-specific detail message, even when the decision id is itself known", () => {
    const decision = architectureDecision({ id: "decision:a" });
    const frontmatter = { links: [{ type: "requires", domain: "decision", target: "decision:a" }] };
    const links = buildDecisionToDecisionLinks(decision, frontmatter, new Set(["decision:a"]));
    expect(links).toHaveLength(1);
    expect(links[0].resolution).toBe("unresolved");
    expect(links[0].target_id).toBeUndefined();
    expect(links[0].detail).toBe('Decision "decision:a" cannot link to itself.');
  });

  it("carries the decision's evidence_refs on the produced link", () => {
    const refs = [evidenceRef({ path: "docs/adr/x.md" })];
    const decision = architectureDecision({ id: "decision:a", evidence_refs: refs });
    const links = buildDecisionToDecisionLinks(decision, frontmatterWithLink(), new Set(["decision:a", "decision:other"]));
    expect(links[0].evidence_refs).toBe(refs);
  });

  it("resolves multiple declared decision-to-decision links independently", () => {
    const decision = architectureDecision({ id: "decision:a" });
    const frontmatter = {
      links: [
        { type: "depends_on", domain: "decision", target: "decision:other" },
        { type: "requires", domain: "decision", target: "decision:missing" },
        { type: "governs", domain: "decision", target: "decision:a" },
      ],
    };
    const links = buildDecisionToDecisionLinks(decision, frontmatter, new Set(["decision:a", "decision:other"]));
    expect(links).toHaveLength(3);
    const byTarget = new Map(links.map((l) => [l.id, l]));
    expect(byTarget.get(buildLinkId("decision:a", "depends_on", "decision:other"))?.resolution).toBe("resolved");
    expect(byTarget.get(buildLinkId("decision:a", "requires", "decision:missing"))?.resolution).toBe("unresolved");
    expect(byTarget.get(buildLinkId("decision:a", "governs", "decision:a"))?.detail).toBe('Decision "decision:a" cannot link to itself.');
  });
});
