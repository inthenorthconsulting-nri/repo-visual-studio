import type { SemanticIntent, VisualGrammar } from "./contracts.js";
import { grammarSupportsIntent } from "./vocabulary.js";

// Mapping existing RVS scenes onto the semantic vocabulary.
//
// This file is metadata only, and deliberately so. Milestone 10.0 is a
// contracts slice: nothing here is wired into @rvs/renderer-html, and no
// existing rendered HTML changes by a single byte because of it. What it
// provides is the proof the vocabulary was derived from scenes RVS actually
// ships rather than invented alongside them -- every entry below names a
// scene type or plan kind that exists in the repository today, and the test
// suite asserts the coverage both ways (no orphan vocabulary member, no
// unmapped diagrammatic scene).
//
// A VisualDoc scene reaches this function as the structural `MappableScene`
// shape rather than as an imported `Scene` union member, so
// @rvs/visualdoc-schema stays the document model and this stays the
// communication model. Neither imports the other.

/**
 * The structural shape a scene is matched on.
 *
 * `kind` is the scene's own discriminating kind where the VisualDoc scene
 * carries one (`architecture-intelligence`), or the *plan's* scene kind for
 * the pointer scenes (`knowledge-graph-scene`, `governance-scene`,
 * `decision-scene`, `showcase-scene`, `portfolio-scene`) -- those scenes hold
 * only `plan_id` + `scene_id` by design, so the caller that resolved the plan
 * is the one that knows the kind.
 */
export interface MappableScene {
  type: string;
  kind?: string;
}

export interface SceneSemanticMapping {
  scene_type: string;
  scene_kind?: string;
  intent: SemanticIntent;
  /**
   * The grammar this scene's shape defaults to.
   *
   * A *default*, not a decision: `selectVisualGrammar()` re-decides from the
   * actual model, which is why hierarchy scenes default to `tree` but become
   * `nested` when the model turns out to carry real containment depth. The
   * table would otherwise be asserting a fact about data it has not seen.
   */
  default_grammar: VisualGrammar;
}

/** Scenes that carry prose and no relationship structure. They map to no spec at all -- an explicit "not diagrammatic", never a forced intent. */
export const NARRATIVE_SCENE_TYPES: readonly string[] = [
  "title",
  "section-divider",
  "headline",
] as const;

type Entry = [intent: SemanticIntent, grammar: VisualGrammar];

/** VisualDoc scene types that map without needing a kind. */
const BY_TYPE: Readonly<Record<string, Entry>> = {
  metric: ["distribution", "metric_row"],
  architecture: ["architecture", "architecture"],
  workflow: ["sequence", "swimlane"],
  topology: ["architecture", "architecture"],
  "capability-intelligence-overview": ["hierarchy", "tree"],
};

/** `architecture-intelligence` scenes, by their `kind`. */
const ARCHITECTURE_INTELLIGENCE: Readonly<Record<string, Entry>> = {
  "executive-title": ["distribution", "metric_row"],
  "executive-summary": ["distribution", "metric_row"],
  "problem-and-response": ["causality", "process"],
  "platform-responsibilities": ["ownership", "matrix"],
  "system-context": ["architecture", "architecture"],
  "logical-architecture": ["architecture", "architecture"],
  "capability-map": ["hierarchy", "tree"],
  "operating-model": ["ownership", "matrix"],
  "architecture-flow": ["flow", "data_flow"],
  "boundary-map": ["trust_boundary", "nested"],
  outcomes: ["distribution", "metric_row"],
  "risk-summary": ["distribution", "matrix"],
  "risk-and-dependency-summary": ["dependency", "dependency_graph"],
  "workflow-family-map": ["sequence", "swimlane"],
  "repository-map": ["containment", "nested"],
  "evidence-confidence": ["maturity", "matrix"],
  "decision-or-next-step": ["lifecycle", "timeline"],
};

/** `knowledge-graph-scene` pointer scenes, by their plan kind (`KnowledgeGraphSceneKind`). */
const KNOWLEDGE_GRAPH: Readonly<Record<string, Entry>> = {
  "graph-overview": ["architecture", "architecture"],
  // The six intelligence layers and the connections between them: a layered
  // *architecture*, not a nesting relationship.
  "graph-layers-connected": ["architecture", "layer_stack"],
  "graph-entity-landscape": ["distribution", "matrix"],
  "graph-relationship-landscape": ["dependency", "dependency_graph"],
  "graph-dependency-paths": ["dependency", "dependency_graph"],
  "graph-component-impact": ["impact", "dependency_graph"],
  "graph-capability-impact": ["impact", "dependency_graph"],
  "graph-product-portfolio-reach": ["impact", "tree"],
  "graph-root-causes": ["root_cause", "fishbone"],
  "graph-decision-dependencies": ["dependency", "dependency_graph"],
  "graph-invalidated-assumptions": ["causality", "fishbone"],
  "graph-orphans-unresolved": ["distribution", "matrix"],
  "graph-changes": ["change", "delta"],
  "graph-review-required": ["policy", "process"],
  "graph-validation": ["distribution", "matrix"],
};

/** `governance-scene` pointer scenes, by their plan kind. */
const GOVERNANCE: Readonly<Record<string, Entry>> = {
  "governance-hero": ["distribution", "metric_row"],
  "snapshot-comparison": ["comparison", "delta"],
  "change-summary": ["change", "delta"],
  "architecture-change-map": ["change", "delta"],
  "capability-regression": ["change", "delta"],
  "product-change": ["change", "delta"],
  "portfolio-change": ["change", "delta"],
  "evidence-regression": ["maturity", "matrix"],
  "blast-radius": ["impact", "dependency_graph"],
  "policy-findings": ["policy", "process"],
  exceptions: ["policy", "process"],
  "decision-required": ["policy", "process"],
  "governance-validation": ["distribution", "matrix"],
};

/** `decision-scene` pointer scenes, by their plan kind (`DecisionSceneKind`). */
const DECISION: Readonly<Record<string, Entry>> = {
  "decision-hero": ["distribution", "metric_row"],
  "decision-landscape": ["distribution", "matrix"],
  "decision-status": ["lifecycle", "state_machine"],
  "decision-architecture-map": ["dependency", "dependency_graph"],
  "decision-capability-map": ["hierarchy", "tree"],
  "decision-product-map": ["ownership", "matrix"],
  "decision-portfolio-map": ["ownership", "matrix"],
  "decision-implementation": ["dependency", "dependency_graph"],
  "decision-assumptions": ["causality", "fishbone"],
  "decision-supersession": ["lifecycle", "timeline"],
  "decision-conflicts": ["causality", "fishbone"],
  "decision-coverage": ["distribution", "matrix"],
  "decision-drift": ["change", "delta"],
  "decision-debt": ["maturity", "matrix"],
  "decision-governance-impact": ["impact", "dependency_graph"],
  "decision-review-required": ["policy", "process"],
  "decision-validation": ["distribution", "matrix"],
};

/** `showcase-scene` pointer scenes, by their plan `ShowcaseSceneType`. */
const SHOWCASE: Readonly<Record<string, Entry>> = {
  "showcase-hero": ["distribution", "metric_row"],
  "showcase-problem": ["causality", "process"],
  "showcase-identity": ["distribution", "metric_row"],
  "showcase-operating-model": ["ownership", "matrix"],
  "showcase-value-pillars": ["distribution", "matrix"],
  "showcase-capabilities": ["hierarchy", "tree"],
  "showcase-differentiators": ["comparison", "matrix"],
  "showcase-proof": ["maturity", "matrix"],
  "showcase-limitations": ["maturity", "matrix"],
  "showcase-closing": ["distribution", "metric_row"],
  "portfolio-overview": ["ownership", "matrix"],
};

/** `portfolio-scene` pointer scenes, by their plan `PortfolioSceneType`. */
const PORTFOLIO: Readonly<Record<string, Entry>> = {
  "portfolio-hero": ["distribution", "metric_row"],
  "portfolio-mission": ["distribution", "metric_row"],
  "portfolio-landscape": ["ownership", "matrix"],
  "portfolio-product-roles": ["ownership", "matrix"],
  "portfolio-operating-model": ["ownership", "matrix"],
  "portfolio-capability-coverage": ["hierarchy", "tree"],
  "portfolio-relationship-map": ["dependency", "dependency_graph"],
  "portfolio-dependency-map": ["dependency", "dependency_graph"],
  "portfolio-shared-contracts": ["dependency", "dependency_graph"],
  "portfolio-maturity": ["maturity", "matrix"],
  "portfolio-gaps": ["distribution", "matrix"],
  "portfolio-decisions": ["lifecycle", "timeline"],
  "portfolio-closing": ["distribution", "metric_row"],
};

const BY_KIND: Readonly<Record<string, Readonly<Record<string, Entry>>>> = {
  "architecture-intelligence": ARCHITECTURE_INTELLIGENCE,
  "knowledge-graph-scene": KNOWLEDGE_GRAPH,
  "governance-scene": GOVERNANCE,
  "decision-scene": DECISION,
  "showcase-scene": SHOWCASE,
  "portfolio-scene": PORTFOLIO,
};

/**
 * Maps one scene onto its semantic intent and default grammar.
 *
 * Returns `null` for narrative scenes and for anything unrecognised. `null`
 * is the honest answer for an unknown scene: guessing an intent would put a
 * fabricated communication claim on a view nobody had classified, which is
 * strictly worse than declining to classify it.
 */
export function mapSceneToSemantics(scene: MappableScene): SceneSemanticMapping | null {
  if (NARRATIVE_SCENE_TYPES.includes(scene.type)) return null;

  const kindTable = BY_KIND[scene.type];
  if (kindTable) {
    if (scene.kind === undefined) return null;
    const entry = kindTable[scene.kind];
    if (!entry) return null;
    return { scene_type: scene.type, scene_kind: scene.kind, intent: entry[0], default_grammar: entry[1] };
  }

  const entry = BY_TYPE[scene.type];
  if (!entry) return null;
  return { scene_type: scene.type, intent: entry[0], default_grammar: entry[1] };
}

/** Every mapping in the table, in deterministic order. Used by the coverage tests and by docs/visual-intelligence.md. */
export function allSceneMappings(): SceneSemanticMapping[] {
  const mappings: SceneSemanticMapping[] = [];
  for (const [type, entry] of Object.entries(BY_TYPE)) {
    mappings.push({ scene_type: type, intent: entry[0], default_grammar: entry[1] });
  }
  for (const [type, table] of Object.entries(BY_KIND)) {
    for (const [kind, entry] of Object.entries(table)) {
      mappings.push({ scene_type: type, scene_kind: kind, intent: entry[0], default_grammar: entry[1] });
    }
  }
  return mappings.sort((a, b) =>
    a.scene_type !== b.scene_type
      ? a.scene_type < b.scene_type
        ? -1
        : 1
      : (a.scene_kind ?? "") < (b.scene_kind ?? "")
        ? -1
        : (a.scene_kind ?? "") > (b.scene_kind ?? "")
          ? 1
          : 0,
  );
}

/**
 * Checks every table entry pairs an intent with a grammar that can express it.
 *
 * Returned rather than thrown so the test reports all offenders at once; an
 * empty array is the passing state.
 */
export function sceneMappingConsistencyViolations(): string[] {
  return allSceneMappings()
    .filter((m) => !grammarSupportsIntent(m.intent, m.default_grammar))
    .map(
      (m) =>
        `${m.scene_type}${m.scene_kind ? `/${m.scene_kind}` : ""}: grammar "${m.default_grammar}" cannot express intent "${m.intent}".`,
    );
}
