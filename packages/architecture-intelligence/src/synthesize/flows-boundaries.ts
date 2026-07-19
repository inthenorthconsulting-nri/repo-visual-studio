import type { WorkflowGraph } from "@rvs/workflow-graph";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed, derived } from "../inference.js";
import { boundaryId, flowId } from "../ids.js";
import { normalizeEnvironmentLabel, normalizeLabel } from "../label.js";
import type { Actor, ArchitectureBoundary, ArchitectureFlow, EvidenceReference, ExternalSystem, LogicalComponent } from "../types.js";

interface FlowInputs {
  graphs: WorkflowGraph[];
  workflowComponentsByGraphId: Map<string, LogicalComponent>;
  actorsByLabel: Map<string, Actor>;
  terraformComponents: LogicalComponent[];
  topologies: TerraformTopology[];
  externalSystemsByLabel: Map<string, ExternalSystem>;
}

interface DraftFlow {
  id: string;
  label: ReturnType<typeof normalizeLabel>;
  kind: ArchitectureFlow["kind"];
  fromId: string;
  toId: string;
  descriptionText: string;
  evidence: EvidenceReference[];
}

function evidenceKey(e: EvidenceReference): string {
  return `${e.path}:${e.lines ?? ""}`;
}

function mergeEvidence(a: EvidenceReference[], b: EvidenceReference[]): EvidenceReference[] {
  const byKey = new Map<string, EvidenceReference>();
  for (const e of [...a, ...b]) byKey.set(evidenceKey(e), e);
  return [...byKey.values()].sort((x, y) => evidenceKey(x).localeCompare(evidenceKey(y)));
}

// Multiple workflow graphs within the same workflow family (e.g. several
// manually-triggered release scripts) share the same fromId/toId/kind, since
// flows connect actors/components/externals, not individual graphs — so two
// distinct graphs can legitimately derive the identical flow id. Rather than
// erroring as a duplicate id, these are the same real-world flow observed
// from multiple pieces of evidence: merge their evidence into one flow.
function pushFlow(byId: Map<string, DraftFlow>, draft: DraftFlow): void {
  const existing = byId.get(draft.id);
  if (existing) {
    existing.evidence = mergeEvidence(existing.evidence, draft.evidence);
  } else {
    byId.set(draft.id, draft);
  }
}

/** Every flow connects two entities that already exist in the model — never a synthesized pair with no backing evidence. */
export function buildFlows(input: FlowInputs): ArchitectureFlow[] {
  const byId = new Map<string, DraftFlow>();

  for (const graph of [...input.graphs].sort((a, b) => a.id.localeCompare(b.id))) {
    const component = input.workflowComponentsByGraphId.get(graph.id);
    if (!component) continue;

    for (const node of graph.nodes) {
      if (node.type === "approval") {
        const actor = input.actorsByLabel.get(node.label);
        if (actor) {
          pushFlow(byId, {
            id: flowId("approval", actor.id, component.id),
            label: normalizeLabel(`${actor.label.displayLabel} approves ${component.label.displayLabel}`),
            kind: "approval",
            fromId: actor.id,
            toId: component.id,
            descriptionText: `${actor.label.displayLabel} must approve before ${component.label.displayLabel} proceeds.`,
            evidence: node.evidence,
          });
        }
      }
    }

    for (const trigger of graph.triggers) {
      if (trigger.name === "workflow_dispatch") {
        const actor = input.actorsByLabel.get("Manual operator");
        if (actor) {
          pushFlow(byId, {
            id: flowId("trigger", actor.id, component.id),
            label: normalizeLabel(`${actor.label.displayLabel} triggers ${component.label.displayLabel}`),
            kind: "trigger",
            fromId: actor.id,
            toId: component.id,
            descriptionText: `${component.label.displayLabel} can be started manually.`,
            evidence: trigger.evidence,
          });
        }
      }
    }
  }

  for (const topology of [...input.topologies].sort((a, b) => a.id.localeCompare(b.id))) {
    const infraComponent = input.terraformComponents.find((c) => c.implementation.terraformTopologyIds.includes(topology.id));
    if (!infraComponent) continue;
    for (const provider of topology.providers) {
      if (provider.cloudProvider === "generic") continue;
      const external = input.externalSystemsByLabel.get(provider.name);
      if (!external) continue;
      pushFlow(byId, {
        id: flowId("integration", infraComponent.id, external.id),
        label: normalizeLabel(`${infraComponent.label.displayLabel} provisions on ${external.label.displayLabel}`),
        kind: "integration",
        fromId: infraComponent.id,
        toId: external.id,
        descriptionText: `${infraComponent.label.displayLabel} manages ${external.label.displayLabel} resources via Terraform.`,
        evidence: provider.evidence,
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((draft) => ({
      id: draft.id,
      label: draft.label,
      kind: draft.kind,
      fromId: draft.fromId,
      toId: draft.toId,
      description: confirmed(draft.descriptionText, draft.evidence),
      evidence: draft.evidence,
    }));
}

/** Deployment-environment boundaries are derived only from WorkflowNode(type="environment") labels — one boundary per distinct environment name seen across all workflows. */
export function buildBoundaries(graphsInput: WorkflowGraph[], workflowComponentsByGraphId: Map<string, string>): ArchitectureBoundary[] {
  const byName = new Map<string, { componentIds: Set<string>; evidence: { path: string; lines?: string }[] }>();

  // Sorted by id (matching buildFlows() above) so which graph's node.evidence
  // ends up first within a shared environment name never depends on caller-supplied scan order.
  for (const graph of [...graphsInput].sort((a, b) => a.id.localeCompare(b.id))) {
    const componentId = workflowComponentsByGraphId.get(graph.id);
    if (!componentId) continue;
    for (const node of graph.nodes) {
      if (node.type === "environment") {
        const entry = byName.get(node.label) ?? { componentIds: new Set<string>(), evidence: [] };
        entry.componentIds.add(componentId);
        entry.evidence.push(...node.evidence);
        byName.set(node.label, entry);
      }
    }
  }

  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({
      id: boundaryId(name),
      label: normalizeEnvironmentLabel(name),
      kind: "deployment-environment" as const,
      containedComponentIds: [...entry.componentIds].sort(),
      description: derived(`Deployment environment referenced by ${entry.componentIds.size} automation area${entry.componentIds.size === 1 ? "" : "s"}.`, entry.evidence, "Derived from GitHub Actions environment nodes."),
      evidence: [...entry.evidence].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b))),
    }));
}
