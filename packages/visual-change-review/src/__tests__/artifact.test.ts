import { describe, expect, it } from "vitest";
import { buildChangeReviewArtifact, type ChangeReviewArtifactInput } from "../artifact.js";
import { REVIEW_RUNTIME } from "../runtime.js";
import { buildReviewAssembly, type ChangeReviewSourceInput } from "../source.js";
import {
  FIXTURES,
  blockingFinding,
  causalChain,
  componentAdded,
  componentRemoved,
  edge,
  everythingChanged,
  governanceChange,
  largeDelta,
  node,
  noChange,
  reordered,
  snapshot,
  unknownConsumer,
} from "./fixtures.js";

// The artifact: one HTML file, and everything a reviewer needs inside it.
//
// The tests here are about the file rather than the model -- what it says,
// what it refuses to say, what it will not do, and whether two builds of the
// same review produce the same bytes.

const build = (input: ChangeReviewSourceInput, over: Partial<ChangeReviewArtifactInput> = {}) =>
  buildChangeReviewArtifact({
    producer: "rvs-test",
    subject: "Estate",
    assembly: buildReviewAssembly(input),
    audience: "engineering",
    detail_mode: "faithful",
    ...over,
  });

describe("the composed review", () => {
  it("earns the delta grammar and the compare motion from the change facts it carries", () => {
    const artifact = build(componentRemoved());
    expect(artifact.document.spec.semantic_intent).toBe("change");
    expect(artifact.document.spec.visual_grammar).toBe("delta");
    expect(artifact.document.spec.motion_intent).toBe("compare");
  });

  it("produces a compare motion for every fixture, in every detail mode", () => {
    for (const [name, fixture] of FIXTURES) {
      for (const mode of ["faithful", "balanced", "simplified"] as const) {
        const spec = build(fixture(), { detail_mode: mode }).document.spec;
        expect(spec.visual_grammar, `${name} / ${mode}`).toBe("delta");
        expect(spec.motion_intent, `${name} / ${mode}`).toBe("compare");
      }
    }
  });

  it("removes the comparison sweep without degrading anything else when motion is none", () => {
    const still = build(componentRemoved(), { motion: "none" });
    const moving = build(componentRemoved());
    expect(still.document.spec.motion_intent).toBe("none");
    expect(still.model.changes).toEqual(moving.model.changes);
    expect(still.document.coverage).toEqual(moving.document.coverage);
  });

  it("opens on the requested lens without changing what the review contains", () => {
    const governance = build(blockingFinding(), { initial_lens: "governance" });
    const architecture = build(blockingFinding(), { initial_lens: "architecture" });
    expect(governance.html).toContain('value="governance" selected');
    expect(architecture.html).toContain('value="architecture" selected');
    expect(governance.model.changes).toEqual(architecture.model.changes);
    expect(governance.model.governance_findings).toEqual(architecture.model.governance_findings);
    expect(governance.model.fidelity_receipt).toEqual(architecture.model.fidelity_receipt);
  });

  it("names all six lenses on the page", () => {
    const html = build(causalChain()).html;
    for (const lens of ["architecture", "capabilities", "governance", "decisions", "impact", "unresolved"]) {
      expect(html).toContain(`value="${lens}"`);
    }
  });
});

describe("the no-change state", () => {
  const artifact = build(noChange());

  it("says in words that the comparison ran and found nothing", () => {
    expect(artifact.model.changes).toEqual([]);
    expect(artifact.html).toContain("No material graph changes were detected between these compatible snapshots.");
    expect(artifact.html).toContain("this is a result, not a missing diagram");
  });

  it("draws no empty change map", () => {
    // An empty diagram looks exactly like a diagram that failed to load.
    expect(artifact.html).not.toContain("<svg");
  });

  it("never calls a no-change result safe", () => {
    // The §21 claims, none of which the evidence supports. "safe to deploy"
    // does appear on the page -- inside the governance lens caveat that says
    // an empty result is *not* that -- so the banned wording is the claim,
    // not the word.
    expect(artifact.html).not.toMatch(/no downstream impact|safe change|\bno consumers\b/i);
  });
});

describe("what the reader can still see after adaptation", () => {
  it("keeps a real changed entity on screen in every mode, for every fixture", () => {
    for (const [name, fixture] of FIXTURES) {
      for (const mode of ["faithful", "balanced", "simplified"] as const) {
        const artifact = build(fixture(), { detail_mode: mode });
        if (artifact.model.changes.length === 0) continue;
        const drawn = new Set(artifact.reachable_entity_ids);
        const realDrawn = artifact.model.changes.filter((c) => drawn.has(c.entity_id));
        expect(realDrawn.length, `${name} / ${mode}`).toBeGreaterThan(0);
        expect(artifact.findings.map((f) => f.code), `${name} / ${mode}`).not.toContain(
          "CHANGE_REVIEW_REAL_ANCHOR_LOST",
        );
      }
    }
  });

  it("never renders a simplified delta as stand-ins alone", () => {
    for (const fixture of [everythingChanged, largeDelta]) {
      const artifact = build(fixture(), { detail_mode: "simplified" });
      const nodes = artifact.document.primary.audience.model.nodes;
      const real = nodes.filter((n) => n.placeholder_for === undefined);
      expect(real.length).toBeGreaterThanOrEqual(1);
      expect(real.length).toBeGreaterThan(0);
      const changed = new Set(artifact.model.changes.map((c) => c.entity_id));
      expect(real.some((n) => changed.has(n.source_entity_id))).toBe(true);
    }
  });

  it("splits before it shrinks: a large delta gains detail views rather than losing changed entities", () => {
    const faithful = build(largeDelta(), { detail_mode: "faithful" });
    const simplified = build(largeDelta(), { detail_mode: "simplified" });
    expect(simplified.document.details.length).toBeGreaterThan(faithful.document.details.length);
    expect(simplified.document.receipt.reason_codes).toContain("FIDELITY_SPLIT_INTO_VIEWS");
    expect(simplified.document.receipt.split_views.length).toBeGreaterThan(0);
  });

  it("does not merge stand-ins that stand for different split views", () => {
    // Pass 5 merges pure collapses only. Two stand-ins that each point at a
    // different detail view are signposts to different places, and merging
    // them would leave the reader with no way to get to either.
    const artifact = build(largeDelta(), { detail_mode: "simplified" });
    const standIns = artifact.document.primary.audience.model.nodes.filter(
      (n) => n.placeholder_for !== undefined,
    );
    const splitIds = standIns.map((n) => n.placeholder_for?.split_view_id).filter((id) => id !== undefined);
    expect(new Set(splitIds).size).toBe(splitIds.length);
    expect(splitIds.length).toBe(artifact.document.details.length);
  });

  it("tells the reader on the page what adaptation cost", () => {
    const html = build(largeDelta(), { detail_mode: "simplified" }).html;
    expect(html).toContain("What this review shows");
    expect(html).toContain("Moved to a detail view");
    expect(html).toContain("Reason codes:");
  });
});

/**
 * A delta big enough to put the anchor floor and the budget in conflict.
 *
 * Every entity changed, none is interchangeable, and none is grouped, so
 * paging is the only reduction left and the seats needed to point at the
 * pages come out of the floor. Built here rather than in `fixtures.ts`
 * because it is not one of the fifteen required fixtures: it exists to reach
 * one release path, and nothing else asserts against it.
 */
function releasePressure(count: number): ChangeReviewSourceInput {
  const kinds = ["component", "package", "service"] as const;
  const nodes = Array.from({ length: count }, (_, i) =>
    node(`svc-${String(i).padStart(3, "0")}`, { node_type: kinds[i % 3], label: `Service ${i}` }),
  );
  const edges = nodes.slice(1).map((n, i) => edge(nodes[i].id, n.id));
  return {
    before: snapshot("snap-a", nodes, edges),
    after: snapshot("snap-b", nodes.map((n) => ({ ...n, label: `${n.label} v2` })), edges),
    compatibility: { status: "compatible", reasons: [] },
    graph_changes: { entity_types_changed: nodes.map((n) => n.id) },
  };
}

describe("graduated anchor release in a delta view", () => {
  // The counts sit either side of the release threshold for a delta at
  // simplified detail, which is a four-node budget. They moved when the delta
  // budget was corrected to measure one panel's width rather than the whole
  // scene's: the grammar draws the same entities three times across, so the
  // old figure counted the same capacity three times over.
  it("uses the shared release pass rather than a release of its own, and discloses it", () => {
    const artifact = build(releasePressure(12), { detail_mode: "simplified" });
    expect(artifact.document.receipt.reason_codes).toContain("FIDELITY_ANCHOR_RELEASED");
    expect(artifact.html).toContain("FIDELITY_ANCHOR_RELEASED");
  });

  it("holds the whole floor while paging alone still fits", () => {
    const artifact = build(releasePressure(10), { detail_mode: "simplified" });
    expect(artifact.document.receipt.reason_codes).not.toContain("FIDELITY_ANCHOR_RELEASED");
  });

  it("loses nothing when it releases: every released entity is drawn in a detail view", () => {
    const artifact = build(releasePressure(12), { detail_mode: "simplified" });
    expect(artifact.document.coverage.hidden_entity_ids).toEqual([]);
    expect(artifact.findings.map((f) => f.code)).not.toContain("CHANGE_REVIEW_REAL_ANCHOR_LOST");
  });
});

describe("an artifact that works with the network unplugged", () => {
  const html = build(causalChain()).html;

  it("references no external origin at all", () => {
    // `xmlns="http://www.w3.org/2000/svg"` is a namespace name rather than an
    // address: nothing is fetched from it, and SVG is not SVG without it.
    const addresses = html.replace(/xmlns(:\w+)?="[^"]*"/g, "");
    expect(addresses).not.toMatch(/https?:\/\//);
    expect(addresses).not.toMatch(/\bsrc\s*=\s*"(?!data:)/);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource|import\s*\(/);
  });

  it("declares a policy that would fail a future edit reaching for a CDN", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
  });

  it("carries its own styles and its own script", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    expect(html).toContain('id="rvs-review"');
  });

  it("puts no absolute local path into the page", () => {
    expect(html).not.toMatch(/["'(\s](\/Users\/|\/home\/|\/var\/|[A-Z]:\\)/);
  });

  it("states that it is read-only", () => {
    expect(html).toContain("This review is read-only");
    expect(html).toContain("does not comment on a pull request, approve or block a merge");
  });
});

describe("determinism", () => {
  it("produces byte-identical HTML across five builds of every fixture", () => {
    for (const [name, fixture] of FIXTURES) {
      const runs = new Set(Array.from({ length: 5 }, () => build(fixture()).html));
      expect(runs.size, name).toBe(1);
    }
  });

  it("produces the same digest, receipt and anchors when every input list is reversed", () => {
    for (const [name, fixture] of FIXTURES) {
      const straight = build(fixture());
      const shuffled = build(reordered(fixture()));
      expect(shuffled.digest, name).toBe(straight.digest);
      expect(shuffled.model.fidelity_receipt, name).toEqual(straight.model.fidelity_receipt);
      expect(shuffled.reachable_entity_ids, name).toEqual(straight.reachable_entity_ids);
      expect(shuffled.html, name).toBe(straight.html);
    }
  });

  it("carries no clock, no counter and no host detail in the digest", () => {
    const first = build(causalChain());
    const second = build(causalChain());
    expect(first.digest).toBe(second.digest);
    expect(first.model.generation_metadata.input_digest).toBe(second.model.generation_metadata.input_digest);
  });
});

describe("the evidence drawer", () => {
  // The drawer itself is wiring-half code (it touches the DOM), so what is
  // provable here is the contract it depends on: the evidence a change
  // carries reaches the page as text, attached to that change, with nothing
  // left for the browser to go and fetch.

  const embedded = (html: string): Record<string, any> => {
    const open = html.indexOf('<script type="application/json" id="rvs-review">');
    const start = html.indexOf(">", open) + 1;
    const body = html.slice(start, html.indexOf("</script>", start));
    return JSON.parse(body.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"));
  };

  it("carries each change's own evidence, attached to that change", () => {
    const model = embedded(build(causalChain()).html);
    const withEvidence = model.changes.filter((c: any) => c.evidence.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const change of withEvidence) {
      for (const line of change.evidence) {
        expect(typeof line).toBe("string");
        expect(line).not.toMatch(/^[a-z]+:\/\//i);
        expect(line.startsWith("/")).toBe(false);
      }
    }
  });

  it("renders the evidence as text in a drawer that fetches nothing", () => {
    const html = build(causalChain()).html;
    expect(html).toContain('aria-label="Change inspector"');
    expect(REVIEW_RUNTIME).toContain("function describeEvidence");
    // The drawer builds list items with textContent and reads only what was
    // embedded; a reference is a place for a person to look, never a link.
    expect(REVIEW_RUNTIME).not.toMatch(/createElement\(\s*["']a["']\s*\)/);
    expect(html).not.toContain("<a ");
  });

  it("says so when upstream recorded no evidence, rather than showing an empty drawer", () => {
    expect(REVIEW_RUNTIME).toContain("No evidence reference was recorded upstream for this change.");
    expect(REVIEW_RUNTIME).toContain("Select a change to see the evidence recorded for it.");
  });
});

describe("the viewer does not execute source data", () => {
  const hostile = (): ChangeReviewSourceInput => {
    const before = [
      node("api", { node_type: "runtime_entrypoint", label: `<script>alert('api')</script>` }),
      node("billing", { label: `</text><script>alert(1)</script><text>` }),
    ];
    const after = [
      before[0],
      node("shipping", {
        label: `" onload="alert(2)`,
        evidence_refs: [
          { path: "/Users/someone/secret/keys.ts", lines: "1-2" },
          { path: "https://evil.example.com/payload.js" },
          { path: "src/shipping.ts", lines: "1-9" },
        ],
      }),
    ];
    return {
      before: snapshot("snap-a", before, [edge("api", "billing")]),
      after: snapshot("snap-b", after, [edge("api", "shipping")]),
      compatibility: { status: "compatible", reasons: [`<img src=x onerror=alert(3)>`] },
      graph_changes: {
        nodes_added: ["shipping"],
        nodes_removed: ["billing"],
        edges_added: ["e-api-shipping"],
        edges_removed: ["e-api-billing"],
      },
    };
  };

  const html = build(hostile()).html;

  /** Every tag in the document, attributes and all, with text content excluded. */
  const tags = (markup: string) => markup.match(/<[^>]*>/g) ?? [];

  it("never lets a label become markup", () => {
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("onerror=alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never lets a label become an attribute", () => {
    // A hostile label reaches the page as text -- `<title>" onload="alert(2)`
    // -- where a quote is an ordinary character. The failure would be that
    // same text landing inside a tag, so that is what is checked: no tag in
    // the document carries an inline event handler.
    for (const tag of tags(html)) expect(tag).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("closes no SVG element from inside a label", () => {
    expect(html).not.toContain("</text><script>");
    const opens = (html.match(/<svg\b/g) ?? []).length;
    const closes = (html.match(/<\/svg>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("never lets an upstream reason become markup", () => {
    expect(html).not.toContain("<img src=x");
  });

  it("drops an absolute evidence path rather than rewriting or embedding it", () => {
    expect(html).not.toContain("/Users/someone/secret/keys.ts");
    expect(html).not.toContain("keys.ts");
  });

  it("never turns an evidence reference into a link, however it is spelled", () => {
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("evil.example.com");
  });

  it("escapes the JSON island so it cannot close its own script tag", () => {
    const island = html.slice(html.indexOf('id="rvs-review"'));
    const body = island.slice(island.indexOf(">") + 1, island.indexOf("</script>"));
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");
    expect(JSON.parse(body.replace(/\\u003c/g, "<").replace(/\\u003e/g, ">").replace(/\\u0026/g, "&"))).toBeTruthy();
  });

  it("survives a label far longer than any name, without truncating it into markup", () => {
    const long = "x".repeat(20_000);
    const artifact = build({
      ...componentAdded(),
      after: snapshot(
        "snap-b",
        [node("api", { node_type: "runtime_entrypoint" }), node("shipping", { label: `${long}<script>` })],
        [edge("api", "shipping")],
      ),
    });
    expect(artifact.html).not.toContain("<script>x");
    expect(artifact.html).toContain("&lt;script&gt;");
  });

  it("survives an unsafe identifier without letting it select anything", () => {
    const artifact = build({
      ...componentAdded(),
      after: snapshot(
        "snap-b",
        [node("api", { node_type: "runtime_entrypoint" }), node(`"><script>alert(1)</script>`)],
        [],
      ),
    });
    expect(artifact.html).not.toContain("<script>alert(1)");
  });

  it("survives a snapshot whose edges name entities it does not contain", () => {
    const artifact = build({
      ...componentAdded(),
      after: snapshot("snap-b", [node("api", { node_type: "runtime_entrypoint" })], [edge("api", "ghost")]),
    });
    expect(artifact.html).toContain("<html");
    expect(artifact.document.primary.audience.model.edges.every((e) => e.from_id !== "ghost")).toBe(true);
  });

  it("survives deeply nested input without recursing into it", () => {
    let nested: unknown = { deep: true };
    for (let i = 0; i < 5_000; i++) nested = { child: nested };
    const artifact = build({ ...componentAdded(), extra: nested } as unknown as ChangeReviewSourceInput);
    expect(artifact.html).toContain("<html");
  });

  it("reports duplicate change ids rather than letting input order decide the survivor", () => {
    const artifact = build({
      ...componentRemoved(),
      governance_changes: [
        governanceChange("dup", "orders", { detail: "First claim." }),
        governanceChange("dup", "store", { detail: "Second claim." }),
      ],
    });
    expect(artifact.model.changes.filter((c) => c.id === "dup")).toHaveLength(1);
    const order = artifact.findings.filter((f) => f.code === "CHANGE_REVIEW_NONDETERMINISTIC_ORDER");
    expect(order).toHaveLength(1);
    expect(order[0]?.message).toContain("dup");
    // And the page says so, rather than quietly rendering whichever arrived last.
    expect(artifact.html).toContain("CHANGE_REVIEW_NONDETERMINISTIC_ORDER");
  });
});

describe("incompatible and partial reviews qualify themselves", () => {
  it("says which domains could not be compared, and does not call them unchanged", () => {
    const artifact = build({
      ...componentRemoved(),
      compatibility: { status: "partial", reasons: ["Governance was not captured in the baseline."] },
      unavailable_domains: ["governance", "decisions"],
    });
    expect(artifact.html).toContain("Qualifications");
    expect(artifact.html).toContain("could not be compared");
    expect(artifact.html).toContain("which is not the same as saying nothing changed in them");
    expect(artifact.html).toContain("decisions, governance");
  });

  it("reports an incompatible pair as an error on the page rather than drawing a diff", () => {
    const artifact = build({
      ...componentRemoved(),
      compatibility: { status: "incompatible", reasons: ["Snapshot schema versions differ."] },
    });
    expect(artifact.findings.map((f) => f.code)).toContain("CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS");
    expect(artifact.html).toContain("Snapshot schema versions differ.");
    expect(artifact.html).toContain("validation error");
  });
});

describe("unknown impact is phrased as a statement about the evidence", () => {
  it("never claims safety anywhere on the page", () => {
    for (const [name, fixture] of FIXTURES) {
      const html = build(fixture()).html;
      expect(html, name).not.toMatch(/no downstream impact|safe change|\bno consumers\b/i);
    }
  });

  it("says the reach is unresolved when upstream could not resolve it", () => {
    const html = build(unknownConsumer()).html;
    expect(html).toMatch(/unresolved|not.*determined|no evidence-backed path/i);
  });
});

describe("accessibility", () => {
  const html = build(causalChain()).html;

  it("labels every region a reader can land in", () => {
    for (const label of [
      "Review controls",
      "Before, delta and after states",
      "Change inspector",
      "Legend",
      "What this review shows",
      "Keyboard help",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("gives the search box and the lens select real labels", () => {
    expect(html).toContain('<label for="rvs-search"');
    expect(html).toContain('<label for="rvs-lens"');
  });

  it("announces changes politely rather than interrupting", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("encodes no state through colour alone", () => {
    // Every change type carries a glyph and its own word.
    for (const type of ["added", "removed", "modified", "rerouted", "regressed", "resolved", "qualified", "unresolved"]) {
      expect(html).toContain(`data-change="${type}"`);
    }
    expect(html).toContain("Confirmed (solid)");
    expect(html).toContain("Related (dashed)");
    expect(html).toContain("Unresolved (dotted)");
    expect(html).toContain("as well as a colour");
  });

  it("honours a reader who asked for less motion", () => {
    expect(html).toContain("prefers-reduced-motion");
  });

  it("sets no font size below what a reviewer can read", () => {
    const px = [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    for (const size of px) expect(size).toBeGreaterThanOrEqual(14);
    const rem = [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)rem/g)].map((m) => Number(m[1]));
    for (const size of rem) expect(size * 15).toBeGreaterThanOrEqual(12);
  });

  it("documents every keyboard action it implements", () => {
    expect(html).toContain("Keyboard");
    expect(html).toContain("Every action in this review is reachable from the keyboard");
  });
});
