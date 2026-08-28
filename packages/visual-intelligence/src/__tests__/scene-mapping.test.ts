import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NARRATIVE_SCENE_TYPES,
  allSceneMappings,
  mapSceneToSemantics,
  sceneMappingConsistencyViolations,
} from "../scene-mapping.js";
import { SEMANTIC_INTENTS, VISUAL_GRAMMARS } from "../vocabulary.js";

const repoFile = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

/** Pulls the string members out of a `z.enum([...])` or a `type X = "a" | "b"` union in real RVS source. */
function membersOf(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const body = source.slice(start, start + 2000);
  const end = body.indexOf(";");
  const quoted = body.slice(0, end === -1 ? undefined : end).match(/"([a-z0-9-]+)"/g) ?? [];
  return [...new Set(quoted.map((q) => q.slice(1, -1)))];
}

// Milestone 10.0's vocabulary had to be derived from scenes RVS already
// ships, not invented next to them. These tests read the real upstream
// sources and check the mapping table against them, so a new scene kind
// upstream fails here rather than silently rendering with no semantics.
describe("the mapping table covers the scenes RVS actually ships", () => {
  const cases: Array<[string, string, string]> = [
    ["architecture-intelligence", "packages/visualdoc-schema/src/schema.ts", "export const ArchitectureSceneKindSchema"],
    ["knowledge-graph-scene", "packages/knowledge-graph/src/contracts.ts", "export type KnowledgeGraphSceneKind"],
    ["governance-scene", "packages/governance-intelligence/src/contracts.ts", "export type GovernanceSceneKind"],
    ["decision-scene", "packages/decision-intelligence/src/contracts.ts", "export type DecisionSceneKind"],
    ["showcase-scene", "packages/product-intelligence/src/contracts.ts", "export type ShowcaseSceneType"],
    ["portfolio-scene", "packages/portfolio-intelligence/src/contracts.ts", "export type PortfolioSceneType"],
  ];

  it.each(cases)("maps every %s kind", (sceneType, file, marker) => {
    const upstream = membersOf(repoFile(file), marker);
    expect(upstream.length).toBeGreaterThan(0);
    const unmapped = upstream.filter((kind) => mapSceneToSemantics({ type: sceneType, kind }) === null);
    expect(unmapped).toEqual([]);
  });

  it("maps every VisualDoc scene type to semantics or to an explicit narrative exemption", () => {
    const schema = repoFile("packages/visualdoc-schema/src/schema.ts");
    const types = [...schema.matchAll(/type: z\.literal\("([a-z-]+)"\)/g)]
      .map((m) => m[1])
      .filter((t) => t !== "presentation");
    expect(types.length).toBeGreaterThan(10);
    for (const type of types) {
      const mapped = mapSceneToSemantics({ type }) !== null;
      const pointerScene = allSceneMappings().some((m) => m.scene_type === type);
      const narrative = NARRATIVE_SCENE_TYPES.includes(type);
      expect(mapped || pointerScene || narrative).toBe(true);
    }
  });
});

describe("the mapping table is internally consistent", () => {
  it("never pairs an intent with a grammar that cannot express it", () => {
    expect(sceneMappingConsistencyViolations()).toEqual([]);
  });

  it("uses only published vocabulary members", () => {
    for (const mapping of allSceneMappings()) {
      expect(SEMANTIC_INTENTS).toContain(mapping.intent);
      expect(VISUAL_GRAMMARS).toContain(mapping.default_grammar);
    }
  });

  it("leaves no intent without a real scene behind it", () => {
    // The audit that justified the vocabulary: every semantic intent exists
    // because some scene RVS already renders needed it.
    const used = new Set(allSceneMappings().map((m) => m.intent));
    expect([...SEMANTIC_INTENTS].filter((i) => !used.has(i))).toEqual([]);
  });

  it("is emitted in a stable order", () => {
    expect(allSceneMappings()).toEqual(allSceneMappings());
    // Ordered by (scene_type, scene_kind) as a tuple -- deliberately not by a
    // joined "type/kind" string, where the separator's own collation would
    // reorder "architecture" against "architecture-intelligence".
    const mappings = allSceneMappings();
    for (let i = 1; i < mappings.length; i++) {
      const previous = mappings[i - 1];
      const current = mappings[i];
      const ordered =
        previous.scene_type < current.scene_type ||
        (previous.scene_type === current.scene_type &&
          (previous.scene_kind ?? "") <= (current.scene_kind ?? ""));
      expect(ordered).toBe(true);
    }
  });
});

describe("scenes that are not diagrams", () => {
  it("maps narrative scenes to nothing at all", () => {
    // "Not diagrammatic" is a real answer. Forcing a title slide into an
    // intent would attach a communication claim to a view that makes none.
    for (const type of NARRATIVE_SCENE_TYPES) expect(mapSceneToSemantics({ type })).toBeNull();
  });

  it("declines to classify an unknown scene rather than guessing", () => {
    expect(mapSceneToSemantics({ type: "some-future-scene" })).toBeNull();
    expect(mapSceneToSemantics({ type: "knowledge-graph-scene" })).toBeNull();
    expect(mapSceneToSemantics({ type: "knowledge-graph-scene", kind: "graph-unheard-of" })).toBeNull();
  });
});

describe("mapping known scenes", () => {
  it.each([
    ["knowledge-graph-scene", "graph-dependency-paths", "dependency", "dependency_graph"],
    ["knowledge-graph-scene", "graph-root-causes", "root_cause", "fishbone"],
    ["knowledge-graph-scene", "graph-changes", "change", "delta"],
    ["decision-scene", "decision-supersession", "lifecycle", "timeline"],
    ["governance-scene", "policy-findings", "policy", "process"],
    ["architecture-intelligence", "capability-map", "hierarchy", "tree"],
  ])("maps %s/%s to %s via %s", (type, kind, intent, grammar) => {
    expect(mapSceneToSemantics({ type, kind })).toEqual({
      scene_type: type,
      scene_kind: kind,
      intent,
      default_grammar: grammar,
    });
  });

  it("maps the workflow and topology scenes RVS has rendered since Milestone 1", () => {
    expect(mapSceneToSemantics({ type: "workflow" })?.intent).toBe("sequence");
    expect(mapSceneToSemantics({ type: "topology" })?.intent).toBe("architecture");
    expect(mapSceneToSemantics({ type: "metric" })?.default_grammar).toBe("metric_row");
  });
});
