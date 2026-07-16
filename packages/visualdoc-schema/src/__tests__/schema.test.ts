import { describe, expect, it } from "vitest";
import { parseVisualDoc, VisualDocSchema, type Scene } from "../schema.js";

function baseDoc() {
  return {
    version: 1 as const,
    document: {
      type: "presentation" as const,
      title: "Order Service",
      aspect_ratio: "16:9" as const,
      audience: "executive",
      theme: "executive-dark",
    },
    scenes: [
      { id: "s1", type: "title" as const, headline: "One governed platform", evidence: [] },
    ] as Scene[],
  };
}

describe("VisualDocSchema", () => {
  it("accepts a minimal valid document", () => {
    expect(() => parseVisualDoc(baseDoc())).not.toThrow();
  });

  it("rejects a scene with an unknown type", () => {
    const doc = baseDoc();
    // @ts-expect-error intentionally invalid
    doc.scenes.push({ id: "s2", type: "not-a-real-scene", headline: "x" });
    expect(() => VisualDocSchema.parse(doc)).toThrow();
  });

  it("requires at least one metric on a metric scene", () => {
    const doc = baseDoc();
    doc.scenes.push({
      id: "s2",
      type: "metric",
      headline: "Key numbers",
      evidence: [],
      metrics: [],
    });
    expect(() => VisualDocSchema.parse(doc)).toThrow();
  });

  it("defaults evidence to an empty array when omitted", () => {
    const doc = baseDoc();
    // @ts-expect-error evidence intentionally omitted to test default
    delete doc.scenes[0].evidence;
    const parsed = parseVisualDoc(doc);
    expect(parsed.scenes[0].evidence).toEqual([]);
  });

  it("accepts a workflow scene that only references a graph by id, with default detail_level and direction", () => {
    const doc = baseDoc();
    // Only `graph_id` is supplied here; the other fields are exercised as
    // zod-applied defaults by parsing this raw, untyped payload rather than
    // pushing a fully-typed WorkflowScene (whose defaulted fields are
    // required in the inferred output type).
    const rawDoc: Record<string, unknown> = { ...doc, scenes: [...doc.scenes, { id: "s2", type: "workflow", headline: "CI workflow", evidence: [], graph_id: "workflow:CI" }] };
    const parsed = parseVisualDoc(rawDoc);
    const scene = parsed.scenes[1];
    expect(scene?.type).toBe("workflow");
    if (scene?.type === "workflow") {
      expect(scene.detail_level).toBe("jobs");
      expect(scene.direction).toBe("top-to-bottom");
      expect(scene.highlight).toEqual([]);
      expect(scene.annotations).toEqual([]);
    }
  });

  it("rejects a workflow scene with an invalid detail_level", () => {
    const doc = baseDoc();
    const rawDoc: Record<string, unknown> = {
      ...doc,
      scenes: [...doc.scenes, { id: "s2", type: "workflow", headline: "CI workflow", evidence: [], graph_id: "workflow:CI", detail_level: "everything" }],
    };
    expect(() => VisualDocSchema.parse(rawDoc)).toThrow();
  });

  it("rejects a workflow scene missing graph_id", () => {
    const doc = baseDoc();
    const rawDoc: Record<string, unknown> = {
      ...doc,
      scenes: [...doc.scenes, { id: "s2", type: "workflow", headline: "CI workflow", evidence: [], detail_level: "summary" }],
    };
    expect(() => VisualDocSchema.parse(rawDoc)).toThrow();
  });

  it("accepts a workflow scene with highlight, annotations, and split-scene focus_nodes", () => {
    const doc = baseDoc();
    doc.scenes.push({
      id: "s2",
      type: "workflow",
      headline: "Deploy jobs",
      evidence: [],
      graph_id: "workflow:CI",
      detail_level: "jobs-and-key-steps",
      direction: "left-to-right",
      highlight: ["job:workflow:CI:deploy"],
      annotations: [{ target: "job:workflow:CI:deploy", text: "Deploys to production" }],
      focus_nodes: ["job:workflow:CI:build", "job:workflow:CI:deploy"],
    });
    const parsed = parseVisualDoc(doc);
    const scene = parsed.scenes[1];
    expect(scene?.type).toBe("workflow");
    if (scene?.type === "workflow") {
      expect(scene.focus_nodes).toEqual(["job:workflow:CI:build", "job:workflow:CI:deploy"]);
      expect(scene.annotations).toHaveLength(1);
    }
  });

  it("accepts a topology scene that only references a topology by id, with default detail_level, direction, and part_index", () => {
    const doc = baseDoc();
    const rawDoc: Record<string, unknown> = { ...doc, scenes: [...doc.scenes, { id: "s2", type: "topology", headline: "Terraform topology", evidence: [], topology_id: "terraform:root:network" }] };
    const parsed = parseVisualDoc(rawDoc);
    const scene = parsed.scenes[1];
    expect(scene?.type).toBe("topology");
    if (scene?.type === "topology") {
      expect(scene.detail_level).toBe("modules-and-key-resources");
      expect(scene.direction).toBe("top-to-bottom");
      expect(scene.highlight).toEqual([]);
      expect(scene.part_index).toBe(0);
    }
  });

  it("rejects a topology scene with an invalid detail_level", () => {
    const doc = baseDoc();
    const rawDoc: Record<string, unknown> = {
      ...doc,
      scenes: [...doc.scenes, { id: "s2", type: "topology", headline: "Terraform topology", evidence: [], topology_id: "terraform:root:network", detail_level: "everything" }],
    };
    expect(() => VisualDocSchema.parse(rawDoc)).toThrow();
  });

  it("rejects a topology scene missing topology_id", () => {
    const doc = baseDoc();
    const rawDoc: Record<string, unknown> = {
      ...doc,
      scenes: [...doc.scenes, { id: "s2", type: "topology", headline: "Terraform topology", evidence: [], detail_level: "full" }],
    };
    expect(() => VisualDocSchema.parse(rawDoc)).toThrow();
  });

  it("accepts a topology scene with highlight, a non-default direction, and a non-zero part_index", () => {
    const doc = baseDoc();
    doc.scenes.push({
      id: "s2",
      type: "topology",
      headline: "Terraform topology — detail 2/3",
      evidence: [],
      topology_id: "terraform:root:network",
      detail_level: "full",
      direction: "left-to-right",
      highlight: ["terraform:resource:aws_instance.app"],
      part_index: 1,
    });
    const parsed = parseVisualDoc(doc);
    const scene = parsed.scenes[1];
    expect(scene?.type).toBe("topology");
    if (scene?.type === "topology") {
      expect(scene.highlight).toEqual(["terraform:resource:aws_instance.app"]);
      expect(scene.part_index).toBe(1);
    }
  });

  it("still validates a document containing only pre-existing M1 scene types (no workflow scenes)", () => {
    const doc = baseDoc();
    doc.scenes.push({
      id: "s2",
      type: "architecture",
      headline: "System overview",
      evidence: [],
      nodes: [{ id: "n1", label: "API" }],
      edges: [],
    });
    expect(() => parseVisualDoc(doc)).not.toThrow();
  });
});
