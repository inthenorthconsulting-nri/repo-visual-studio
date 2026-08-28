import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { VisualGraphModel } from "@rvs/visual-intelligence";
import { MOTION_ALGORITHMS, MOTION_PLAYER } from "@rvs/visual-grammar";
import { EXPLORER_ALGORITHMS, EXPLORER_RUNTIME, EXPLORER_RUNTIME_WIRING } from "../runtime.js";
import { applyLens, reachFrom, searchEntities, traceRoute, type ExplorerLens, type TraversalDirection } from "../interaction.js";
import { buildExplorerModel } from "../source.js";
import { chainSource, estateSource, sourceEdge, sourceNode } from "./fixtures.js";

// The parity proof.
//
// The explorer's semantics exist twice: once in TypeScript, where the tests
// above hold them to account, and once as browser text, which is what the
// reader actually runs. Two implementations of one behaviour drift, and the
// copy that drifts here is the one nobody would notice -- so this file runs
// the browser copy in an isolated VM and requires it to agree with the tested
// one, on the same fixtures, for every primitive.

/** The runtime's view of a model: the small projection `artifact.ts` embeds. */
function runtimeShape(model: VisualGraphModel) {
  return {
    nodes: model.nodes.map((n) => ({
      id: n.id,
      entity: n.source_entity_id,
      label: n.label,
      kind: n.kind,
      emphasis: n.emphasis,
      resolution: n.resolution,
      confidence: n.confidence,
      ...(n.severity === undefined ? {} : { severity: n.severity }),
      ...(n.decision_status === undefined ? {} : { decision: n.decision_status }),
      evidence: n.evidence_refs.length,
      ...(n.placeholder_for === undefined ? {} : { placeholder: true }),
    })),
    edges: model.edges.map((e) => ({ id: e.id, from: e.from_id, to: e.to_id, kind: e.kind })),
  };
}

/**
 * The algorithms, loaded into a context with nothing else in it.
 *
 * No `document`, no `window`, no `fetch`, no `require`, no `process`. If the
 * browser half ever reaches for a host object, it will not find one here and
 * the test fails -- which is the point: the pure half has to stay pure, or
 * the parity proof stops proving anything about the half that ships.
 */
function loadAlgorithms(): (expression: string, model: unknown, ...args: unknown[]) => unknown {
  const context = createContext(Object.create(null));
  runInContext(EXPLORER_ALGORITHMS, context, { filename: "explorer-algorithms.js" });
  return (expression, model, ...args) => {
    context.__model = model;
    context.__args = args;
    return JSON.parse(JSON.stringify(runInContext(expression, context)));
  };
}

const call = loadAlgorithms();

const MODELS: ReadonlyArray<readonly [string, VisualGraphModel]> = [
  ["estate", buildExplorerModel(estateSource())],
  ["chain", buildExplorerModel(chainSource(12))],
  [
    "cycle",
    buildExplorerModel({
      nodes: ["a", "b", "c", "orphan"].map((id) => sourceNode(id)),
      edges: [sourceEdge("a", "b"), sourceEdge("b", "c"), sourceEdge("c", "a")],
    }),
  ],
];

const DIRECTIONS: readonly TraversalDirection[] = ["upstream", "downstream", "both"];
const LENSES: readonly ExplorerLens[] = ["none", "governance", "decisions", "unresolved", "evidence"];

/** The runtime with its line comments removed, so a scan reads code and not prose. */
function codeOnly(script: string): string {
  return script
    .split("\n")
    .map((line) => {
      const comment = line.indexOf("//");
      return comment < 0 ? line : line.slice(0, comment);
    })
    .join("\n");
}

describe("the browser copy of the algorithms agrees with the tested one", () => {
  it("runs at all in a context with no host objects", () => {
    // Stated as its own assertion so a failure reads as "the runtime reached
    // for the DOM" rather than as an unexplained parity mismatch.
    expect(() => loadAlgorithms()).not.toThrow();
    for (const forbidden of ["document", "window", "fetch", "process", "require", "globalThis."]) {
      expect(EXPLORER_ALGORITHMS, forbidden).not.toContain(forbidden);
    }
  });

  it("searches identically", () => {
    for (const [name, model] of MODELS) {
      const shape = runtimeShape(model);
      for (const query of ["", "  ", "alpha", "ALPHA", "core", "n0", "store", "nothing-matches", "beta-worker"]) {
        const expected = searchEntities(model, query).map((h) => [h.node_id, h.rank]);
        const actual = (call("rvsSearchEntities(__model, __args[0], 50)", shape, query) as {
          node_id: string;
          rank: number;
        }[]).map((h) => [h.node_id, h.rank]);
        expect(actual, `${name}/${query}`).toEqual(expected);
      }
    }
  });

  it("reaches identically, including where it stopped and whether more remained", () => {
    for (const [name, model] of MODELS) {
      const shape = runtimeShape(model);
      for (const origin of [...model.nodes.map((n) => n.id), "not-an-entity"]) {
        for (const direction of DIRECTIONS) {
          for (const depth of [0, 1, 2, 3, 6]) {
            const expected = reachFrom(model, origin, { direction, max_depth: depth });
            const actual = call("rvsReachFrom(__model, __args[0], __args[1], __args[2])", shape, origin, direction, depth);
            expect(actual, `${name}/${origin}/${direction}/${depth}`).toEqual(
              JSON.parse(JSON.stringify(expected)),
            );
          }
        }
      }
    }
  });

  it("traces the same route, including the same choice between equally short ones", () => {
    for (const [name, model] of MODELS) {
      const shape = runtimeShape(model);
      const ids = model.nodes.map((n) => n.id);
      for (const from of ids) {
        for (const to of ids) {
          for (const direction of DIRECTIONS) {
            const expected = traceRoute(model, from, to, { direction });
            const actual = call("rvsTraceRoute(__model, __args[0], __args[1], __args[2])", shape, from, to, direction);
            expect(actual, `${name}/${from}->${to}/${direction}`).toEqual(
              JSON.parse(JSON.stringify(expected)),
            );
          }
        }
      }
    }
  });

  it("mutes identically under every lens and every focus set", () => {
    for (const [name, model] of MODELS) {
      const shape = runtimeShape(model);
      const focusSets: (string[] | null)[] = [null, [], model.nodes.slice(0, 2).map((n) => n.id)];
      for (const lens of LENSES) {
        for (const focus of focusSets) {
          const expected = applyLens(model, lens, focus ?? undefined)
            .nodes.filter((n) => n.emphasis === "muted")
            .map((n) => n.id)
            .sort();
          const actual = call("rvsMutedNodeIds(__model, __args[0], __args[1])", shape, lens, focus);
          expect(actual, `${name}/${lens}/${focus === null ? "no focus" : focus.join("+")}`).toEqual(expected);
        }
      }
    }
  });
});

describe("the half that touches the page touches only the page", () => {
  it("constructs no markup from data", () => {
    for (const forbidden of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment"]) {
      expect(EXPLORER_RUNTIME_WIRING, forbidden).not.toContain(forbidden);
    }
    // Everything a reader sees that came from the graph goes through one of
    // these two, and both take a string and produce a text node.
    expect(EXPLORER_RUNTIME_WIRING).toContain("textContent");
    expect(EXPLORER_RUNTIME_WIRING).toContain("createElement");
  });

  it("evaluates nothing, fetches nothing, stores nothing, and navigates nowhere", () => {
    // Checked against the code with its commentary removed. The comments
    // describe what the runtime deliberately does *not* do -- one of them
    // uses the word "location" to explain why an evidence reference is not a
    // link -- and a scan that could not tell prose from code would be a scan
    // that punished writing the reason down.
    for (const forbidden of [
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "location",
      "history.",
      "open(",
      "postMessage",
      "importScripts",
    ]) {
      expect(codeOnly(EXPLORER_RUNTIME), forbidden).not.toContain(forbidden);
    }
  });

  it("is delivered as the algorithms, the shared motion layer, then the wiring, and nothing between", () => {
    // The motion halves come from @rvs/visual-grammar rather than being
    // written a second time here: §55 puts motion hooks with the shared
    // primitives. This pins the composition so a later edit cannot quietly
    // slip a locally-invented sequencer in between.
    expect(EXPLORER_RUNTIME).toBe(
      `${EXPLORER_ALGORITHMS}\n${MOTION_ALGORITHMS}\n${MOTION_PLAYER}\n${EXPLORER_RUNTIME_WIRING}`,
    );
    expect(EXPLORER_RUNTIME.indexOf("rvsSearchEntities")).toBeLessThan(
      EXPLORER_RUNTIME.indexOf("addEventListener"),
    );
    expect(EXPLORER_RUNTIME.indexOf("rvsBuildMotionPlan =")).toBe(-1);
  });
});
