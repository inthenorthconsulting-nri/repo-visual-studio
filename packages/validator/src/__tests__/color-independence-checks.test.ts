import { describe, expect, it } from "vitest";
import { evaluateColorIndependence } from "../validate-color-independence.js";
import type { NodeStateFacts } from "../color-independence-checks.js";

// Milestone 10 closure -- rendered color independence, proved at the layer
// this validator actually decides things at: given what a browser found on
// the page, does resolving those same states through `resolveVisualState`
// say a non-colour channel should have been there, and was it.
//
// This file does not launch a browser. `collectNodeStateFacts` is a thin,
// mechanical DOM read (an attribute, an attribute, an attribute, a
// stroke-dasharray) proved by the real production path in
// `verified-delivery.test.ts`, where it runs against artifacts a real
// renderer produced. What deserves an exhaustive, fast, deterministic test is
// the comparison: every state in the table this validator is responsible
// for, alone and layered, with its channel present and with it stripped.

function fact(overrides: Partial<NodeStateFacts> & { id: string; states: string[] }): NodeStateFacts {
  return { markerText: "", badgeText: "", strokeDasharray: null, ...overrides };
}

describe("evaluateColorIndependence: the state -> non-colour channel table (spec s11)", () => {
  it.each([
    { state: "added", markerText: "+" },
    { state: "removed", markerText: "−" },
    { state: "changed", markerText: "~" },
    { state: "rerouted", markerText: "↷" },
  ])("lifecycle: $state passes when its marker survived", ({ state, markerText }) => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state], markerText })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([]);
  });

  it.each(["added", "removed", "changed", "rerouted"])(
    "lifecycle: %s is flagged when its marker is empty",
    (state) => {
      const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state] })]);
      expect(checks).toBe(1);
      expect(findings).toEqual([
        expect.objectContaining({
          code: "RENDERED_COLOR_ONLY_STATE",
          subject: "n1",
          state,
          layer: "lifecycle",
          expected_channel: "marker",
        }),
      ]);
    },
  );

  it.each(["blocking", "review_required"])("governance: %s passes when its badge survived", (state) => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state], badgeText: "Blocking" })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([]);
  });

  it.each(["blocking", "review_required"])("governance: %s is flagged when its badge is empty", (state) => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state] })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([
      expect.objectContaining({ code: "RENDERED_COLOR_ONLY_STATE", subject: "n1", state, layer: "governance", expected_channel: "badge" }),
    ]);
  });

  it.each(["unresolved", "qualified"])("confidence: %s passes when a non-solid stroke survived", (state) => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state], strokeDasharray: "6 4" })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([]);
  });

  it.each(["unresolved", "qualified"])("confidence: %s is flagged when the stroke is solid (no dasharray)", (state) => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state] })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([
      expect.objectContaining({
        code: "RENDERED_COLOR_ONLY_STATE",
        subject: "n1",
        state,
        layer: "confidence",
        expected_channel: "stroke_pattern",
      }),
    ]);
  });

  it("availability: disabled passes when its badge survived", () => {
    const { findings, checks } = evaluateColorIndependence([
      fact({ id: "n1", states: ["disabled"], badgeText: "Unavailable" }),
    ]);
    expect(checks).toBe(1);
    expect(findings).toEqual([]);
  });

  it("availability: disabled is flagged when its badge is empty", () => {
    const { findings } = evaluateColorIndependence([fact({ id: "n1", states: ["disabled"] })]);
    expect(findings).toEqual([
      expect.objectContaining({ code: "RENDERED_COLOR_ONLY_STATE", subject: "n1", state: "disabled", layer: "availability", expected_channel: "badge" }),
    ]);
  });
});

describe("evaluateColorIndependence: states deliberately out of this validator's scope", () => {
  it.each(["normal", "focused", "selected", "hovered", "related", "route", "dimmed"])(
    "interaction-layer state %s contributes zero checks on its own",
    (state) => {
      const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [state] })]);
      expect(checks).toBe(0);
      expect(findings).toEqual([]);
    },
  );

  it("an unknown or garbage state string is ignored rather than crashing", () => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: ["not-a-real-state"] })]);
    expect(checks).toBe(0);
    expect(findings).toEqual([]);
  });

  it("a node with no states at all is skipped entirely", () => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: [] })]);
    expect(checks).toBe(0);
    expect(findings).toEqual([]);
  });
});

describe("evaluateColorIndependence: compound states (spec s12, s13)", () => {
  // The primary certification fixture: the fixed B1 case. Two independent
  // layers, two independent channels, both must survive.
  it("removed+blocking: both channels present passes with two checks", () => {
    const { findings, checks } = evaluateColorIndependence([
      fact({ id: "n1", states: ["removed", "blocking"], markerText: "−", badgeText: "Blocking" }),
    ]);
    expect(checks).toBe(2);
    expect(findings).toEqual([]);
  });

  // The regression this validator exists to catch: a generic "does this node
  // have *any* non-colour channel" check would pass this case, because the
  // marker survived. Per-layer, per-channel checking is why it does not.
  it("removed+blocking: badge stripped is caught even though the marker survived", () => {
    const { findings } = evaluateColorIndependence([
      fact({ id: "n1", states: ["removed", "blocking"], markerText: "−", badgeText: "" }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ subject: "n1", state: "blocking", layer: "governance", expected_channel: "badge" }),
    ]);
  });

  it("removed+blocking: marker stripped is caught even though the badge survived", () => {
    const { findings } = evaluateColorIndependence([
      fact({ id: "n1", states: ["removed", "blocking"], markerText: "", badgeText: "Blocking" }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ subject: "n1", state: "removed", layer: "lifecycle", expected_channel: "marker" }),
    ]);
  });

  it("removed+blocking: both stripped yields both findings", () => {
    const { findings } = evaluateColorIndependence([fact({ id: "n1", states: ["removed", "blocking"] })]);
    expect(findings.map((f) => f.layer).sort()).toEqual(["governance", "lifecycle"]);
  });

  it("changed+review_required: independent channels, independently checked", () => {
    const { findings } = evaluateColorIndependence([
      fact({ id: "n1", states: ["changed", "review_required"], markerText: "~" }),
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ state: "review_required", layer: "governance", expected_channel: "badge" }),
    ]);
  });

  it("changed+unresolved: a lifecycle marker and a confidence stroke pattern, independently checked", () => {
    const { findings } = evaluateColorIndependence([
      fact({ id: "n1", states: ["changed", "unresolved"], strokeDasharray: "6 4" }),
    ]);
    expect(findings).toEqual([expect.objectContaining({ state: "changed", layer: "lifecycle", expected_channel: "marker" })]);
  });

  // focused (interaction, out of scope) layered with blocking (governance,
  // in scope) proves the interaction exclusion does not blind the governance
  // check it is layered with.
  it("focused+blocking: focus contributes nothing, blocking is still checked", () => {
    const { findings, checks } = evaluateColorIndependence([fact({ id: "n1", states: ["focused", "blocking"] })]);
    expect(checks).toBe(1);
    expect(findings).toEqual([
      expect.objectContaining({ state: "blocking", layer: "governance", expected_channel: "badge" }),
    ]);
  });

  // route (interaction, client-side only in production) layered with removed
  // (lifecycle) -- proving "removed" keeps its marker regardless of whether a
  // route overlay is simultaneously active, not that route itself needs one.
  it("route+removed: route contributes nothing, removed is still checked", () => {
    const { findings, checks } = evaluateColorIndependence([
      fact({ id: "n1", states: ["route", "removed"], markerText: "−" }),
    ]);
    expect(checks).toBe(1);
    expect(findings).toEqual([]);
  });
});

describe("evaluateColorIndependence: determinism (spec s40, s41)", () => {
  it("sorts findings by subject then state regardless of input order", () => {
    const facts = [
      fact({ id: "zebra", states: ["blocking"] }),
      fact({ id: "alpha", states: ["removed"] }),
      fact({ id: "alpha", states: ["unresolved"] }),
    ];
    const forward = evaluateColorIndependence(facts).findings.map((f) => `${f.subject}:${f.state}`);
    const shuffled = evaluateColorIndependence([facts[2], facts[0], facts[1]]).findings.map((f) => `${f.subject}:${f.state}`);
    expect(forward).toEqual(["alpha:removed", "alpha:unresolved", "zebra:blocking"]);
    expect(shuffled).toEqual(forward);
  });

  it("five repeated runs over the same input yield an identical result", () => {
    const facts = [
      fact({ id: "n1", states: ["removed", "blocking"], markerText: "−" }),
      fact({ id: "n2", states: ["changed"] }),
    ];
    const runs = Array.from({ length: 5 }, () => evaluateColorIndependence(facts));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});

describe("evaluateColorIndependence: finding payload (spec s19)", () => {
  it("names the subject, state, expected channel class, observed channels, family and evidence", () => {
    const { findings } = evaluateColorIndependence([
      fact({ id: "component:checkout", states: ["blocking"], markerText: "", strokeDasharray: null }),
    ]);
    expect(findings).toEqual([
      {
        code: "RENDERED_COLOR_ONLY_STATE",
        subject: "component:checkout",
        state: "blocking",
        layer: "governance",
        expected_channel: "badge",
        observed: { states: ["blocking"], markerText: "", badgeText: "", strokeDasharray: null },
        family: "accessibility",
        message: expect.stringContaining("component:checkout"),
      },
    ]);
    expect(findings[0].message).toMatch(/blocking/);
    expect(findings[0].message).toMatch(/badge/);
  });
});
