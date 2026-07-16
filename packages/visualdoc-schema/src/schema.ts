import { z } from "zod";

// VisualDoc: the intermediate representation between repository evidence and
// any renderer (standalone HTML today; Canvas/PDF/video adapters later).
// Renderers must consume only this shape — never raw prose or repo files
// directly — so the same document can drive multiple output engines.

const EvidenceRefSchema = z
  .string()
  .describe("A claim_id from the evidence manifest this content traces back to");

const BaseSceneSchema = z.object({
  id: z.string().min(1),
  headline: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const TitleSceneSchema = BaseSceneSchema.extend({
  type: z.literal("title"),
  subheadline: z.string().optional(),
});

export const SectionDividerSceneSchema = BaseSceneSchema.extend({
  type: z.literal("section-divider"),
  index: z.number().int().positive().optional(),
});

export const HeadlineSceneSchema = BaseSceneSchema.extend({
  type: z.literal("headline"),
  body: z.array(z.string()).default([]),
});

export const MetricItemSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});

export const MetricSceneSchema = BaseSceneSchema.extend({
  type: z.literal("metric"),
  metrics: z.array(MetricItemSchema).min(1),
});

export const ArchitectureNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  group: z.string().optional(),
});

export const ArchitectureEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const ArchitectureSceneSchema = BaseSceneSchema.extend({
  type: z.literal("architecture"),
  nodes: z.array(ArchitectureNodeSchema).min(1),
  edges: z.array(ArchitectureEdgeSchema).default([]),
});

// A workflow scene never embeds parser output — it points at a WorkflowGraph
// (built by @rvs/workflow-graph and cached separately) by id, so the graph
// stays the single reusable architecture contract and this scene stays a
// thin, renderer-neutral view over it.
export const WorkflowDetailLevelSchema = z.enum(["summary", "jobs", "jobs-and-key-steps", "full"]);

export const WorkflowAnnotationSchema = z.object({
  target: z.string().min(1).describe("A node or edge id within the referenced WorkflowGraph"),
  text: z.string().min(1),
});

export const WorkflowSceneSchema = BaseSceneSchema.extend({
  type: z.literal("workflow"),
  graph_id: z.string().min(1),
  detail_level: WorkflowDetailLevelSchema.default("jobs"),
  direction: z.enum(["left-to-right", "top-to-bottom"]).default("top-to-bottom"),
  highlight: z.array(z.string()).default([]),
  annotations: z.array(WorkflowAnnotationSchema).default([]),
  // When a large graph is split across multiple scenes (see docs/workflow-engine.md
  // splitting rules), each detail scene scopes itself to a node subset here.
  // Omitted (or empty) means "the whole graph, subject to detail_level".
  focus_nodes: z.array(z.string()).optional(),
});

// A topology scene never embeds parser output — it points at a
// TerraformTopology (built by @rvs/terraform-graph and cached separately)
// by id, mirroring WorkflowSceneSchema's graph_id contract exactly. Unlike
// workflow scenes' manually-assigned focus_nodes, a topology scene's split
// index is derived deterministically by @rvs/terraform-graph's
// buildTerraformSceneSubgraphs(topology, detail_level, ...)[part_index] — so
// only the index (not a node-id set) needs to be persisted here.
export const TerraformDetailLevelSchema = z.enum(["modules", "modules-and-key-resources", "modules-and-resources", "full"]);

export const TopologySceneSchema = BaseSceneSchema.extend({
  type: z.literal("topology"),
  topology_id: z.string().min(1),
  detail_level: TerraformDetailLevelSchema.default("modules-and-key-resources"),
  direction: z.enum(["left-to-right", "top-to-bottom"]).default("top-to-bottom"),
  highlight: z.array(z.string()).default([]),
  part_index: z.number().int().nonnegative().default(0),
});

export const SceneSchema = z.discriminatedUnion("type", [
  TitleSceneSchema,
  SectionDividerSceneSchema,
  HeadlineSceneSchema,
  MetricSceneSchema,
  ArchitectureSceneSchema,
  WorkflowSceneSchema,
  TopologySceneSchema,
]);

export type Scene = z.infer<typeof SceneSchema>;
export type TitleScene = z.infer<typeof TitleSceneSchema>;
export type SectionDividerScene = z.infer<typeof SectionDividerSceneSchema>;
export type HeadlineScene = z.infer<typeof HeadlineSceneSchema>;
export type MetricScene = z.infer<typeof MetricSceneSchema>;
export type ArchitectureScene = z.infer<typeof ArchitectureSceneSchema>;
export type WorkflowScene = z.infer<typeof WorkflowSceneSchema>;
export type WorkflowDetailLevel = z.infer<typeof WorkflowDetailLevelSchema>;
export type WorkflowAnnotation = z.infer<typeof WorkflowAnnotationSchema>;
export type TopologyScene = z.infer<typeof TopologySceneSchema>;
export type TerraformDetailLevel = z.infer<typeof TerraformDetailLevelSchema>;

export const GeneratorStampSchema = z.object({
  generator_version: z.string(),
  git_commit: z.string(),
  design_system: z.string(),
  content_spec_hash: z.string(),
  generated_at: z.string(),
});

export const VisualDocSchema = z.object({
  version: z.literal(1),
  document: z.object({
    type: z.literal("presentation"),
    title: z.string().min(1),
    aspect_ratio: z.literal("16:9").default("16:9"),
    audience: z.string(),
    theme: z.string(),
  }),
  scenes: z.array(SceneSchema).min(1),
  stamp: GeneratorStampSchema.optional(),
});

export type VisualDoc = z.infer<typeof VisualDocSchema>;

export function parseVisualDoc(input: unknown): VisualDoc {
  return VisualDocSchema.parse(input);
}
