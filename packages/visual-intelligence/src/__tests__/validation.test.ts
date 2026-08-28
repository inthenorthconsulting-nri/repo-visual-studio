import { describe, expect, it } from "vitest";
import type { VisualCommunicationSpec } from "../contracts.js";
import { buildVisualCommunicationSpec } from "../spec.js";
import {
  VISUAL_VALIDATION_CODES,
  hasBlockingVisualFindings,
  validateVisualCommunicationSpec,
  type VisualValidationCode,
} from "../validation.js";
import { chain, edge, model, node } from "./fixtures.js";

function validSpec(): VisualCommunicationSpec {
  return buildVisualCommunicationSpec({
    producer: "test",
    subject: "validation",
    semantic_intent: "dependency",
    model: model({ nodes: [node("a"), node("b")], edges: [edge("a", "b")] }),
    audience: "engineering",
    detail_mode: "faithful",
    format: "slide",
  }).spec;
}

/** Mutates a valid spec into one that trips exactly one rule. */
const CASES: Array<[VisualValidationCode, (spec: VisualCommunicationSpec) => VisualCommunicationSpec]> = [
  ["VISUAL_INTENT_UNSUPPORTED", (s) => ({ ...s, semantic_intent: "microservices" as never })],
  ["VISUAL_GRAMMAR_UNSUPPORTED", (s) => ({ ...s, visual_grammar: "mermaid" as never })],
  ["VISUAL_GRAMMAR_INTENT_MISMATCH", (s) => ({ ...s, semantic_intent: "distribution" })],
  ["VISUAL_DETAIL_MODE_INVALID", (s) => ({ ...s, max_nodes: s.max_nodes + 40 })],
  ["VISUAL_MOTION_INTENT_INVALID", (s) => ({ ...s, format: "document", motion_intent: "trace" })],
  [
    "VISUAL_FIDELITY_RECEIPT_INVALID",
    (s) => ({ ...s, fidelity_receipt: undefined }),
  ],
  [
    "VISUAL_FIDELITY_ENTITY_LOST",
    (s) => ({
      ...s,
      fidelity_receipt: s.fidelity_receipt && {
        ...s.fidelity_receipt,
        preserved_entity_ids: ["a"],
        rendered_node_count: 1,
      },
    }),
  ],
  [
    "VISUAL_FIDELITY_UNRESOLVED_ENTITY_LOST",
    (s) => ({
      ...s,
      fidelity_receipt: s.fidelity_receipt && {
        ...s.fidelity_receipt,
        preserved_entity_ids: ["a"],
        rendered_node_count: 1,
        hidden_entity_ids: ["b"],
        preserved_unresolved_entities: ["b"],
      },
    }),
  ],
  [
    "VISUAL_NONDETERMINISTIC_SELECTION",
    (s) => ({ ...s, grammar_selection: { ...s.grammar_selection, reason_code: "VISUAL_GRAMMAR_HANDPICKED" } }),
  ],
];

describe("the VISUAL_* validator family", () => {
  it("passes a spec built by this package", () => {
    expect(validateVisualCommunicationSpec(validSpec())).toEqual([]);
  });

  it("passes an adapted spec that reduced content, because the receipt accounts for it", () => {
    const { spec } = buildVisualCommunicationSpec({
      producer: "test",
      subject: "adapted",
      semantic_intent: "dependency",
      model: chain(60),
      audience: "executive",
      detail_mode: "simplified",
      format: "slide",
    });
    expect(spec.fidelity_receipt!.rendered_node_count).toBeLessThan(60);
    expect(validateVisualCommunicationSpec(spec)).toEqual([]);
  });

  it.each(CASES)("raises %s", (code, mutate) => {
    const findings = validateVisualCommunicationSpec(mutate(validSpec()));
    expect(findings.map((f) => f.code)).toContain(code);
  });

  it("raises VISUAL_FIDELITY_CRITICAL_PATH_LOST when a protected route did not survive", () => {
    const spec = validSpec();
    const findings = validateVisualCommunicationSpec(spec, {
      critical_paths: [{ id: "p1", node_ids: ["a", "b", "vanished"] }],
    });
    expect(findings.map((f) => f.code)).toContain("VISUAL_FIDELITY_CRITICAL_PATH_LOST");
  });

  it("publishes no code that nothing can raise", () => {
    // The rule that governed which codes exist at all: a published code no
    // branch can reach is a promise the system does not keep.
    const raised = new Set<string>();
    for (const [, mutate] of CASES) {
      for (const finding of validateVisualCommunicationSpec(mutate(validSpec()))) raised.add(finding.code);
    }
    for (const finding of validateVisualCommunicationSpec(validSpec(), {
      critical_paths: [{ id: "p1", node_ids: ["nope"] }],
    })) {
      raised.add(finding.code);
    }
    expect([...VISUAL_VALIDATION_CODES].filter((c) => !raised.has(c))).toEqual([]);
  });

  it("emits only published codes", () => {
    for (const [, mutate] of CASES) {
      for (const finding of validateVisualCommunicationSpec(mutate(validSpec()))) {
        expect(VISUAL_VALIDATION_CODES).toContain(finding.code);
      }
    }
  });

  it("treats every information-loss finding as blocking", () => {
    for (const [, mutate] of CASES) {
      const findings = validateVisualCommunicationSpec(mutate(validSpec()));
      expect(hasBlockingVisualFindings(findings)).toBe(true);
    }
    expect(hasBlockingVisualFindings([])).toBe(false);
  });

  it("returns findings in a stable order and never throws on a malformed spec", () => {
    const wrecked = {
      ...validSpec(),
      semantic_intent: "nonsense" as never,
      visual_grammar: "nonsense" as never,
      detail_mode: "nonsense" as never,
      motion_intent: "bounce" as never,
    };
    const first = validateVisualCommunicationSpec(wrecked);
    const second = validateVisualCommunicationSpec(wrecked);
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
    expect(first.map((f) => f.code)).toEqual([...first.map((f) => f.code)].sort());
    expect(first.length).toBeGreaterThan(1);
  });
});
