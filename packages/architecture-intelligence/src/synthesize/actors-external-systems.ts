import type { WorkflowGraph } from "@rvs/workflow-graph";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed } from "../inference.js";
import { actorId, externalSystemId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { Actor, ExternalSystem } from "../types.js";

/** Actors are derived only from structurally explicit evidence: GitHub Actions "approval" nodes and manual (`workflow_dispatch`) triggers — never guessed from naming alone. */
export function buildActors(graphs: WorkflowGraph[]): Actor[] {
  const byId = new Map<string, Actor>();

  for (const graph of [...graphs].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const node of graph.nodes) {
      if (node.type === "approval") {
        const id = actorId(node.label || "Approver");
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            label: normalizeLabel(node.label || "Approver"),
            kind: "human-role",
            description: confirmed(`Approves ${normalizeLabel(graph.name).displayLabel} before it proceeds.`, node.evidence),
            evidence: node.evidence,
          });
        }
      }
    }
    for (const trigger of graph.triggers) {
      if (trigger.name === "workflow_dispatch") {
        const id = actorId("Manual operator");
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            label: normalizeLabel("Manual operator"),
            kind: "human-role",
            description: confirmed("Manually triggers one or more automation workflows.", trigger.evidence),
            evidence: trigger.evidence,
          });
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** External systems are derived only from Terraform provider blocks with a non-generic cloud provider — a real, evidenced dependency, never an inferred integration. */
export function buildExternalSystems(topologies: TerraformTopology[]): ExternalSystem[] {
  const byId = new Map<string, ExternalSystem>();

  for (const topology of [...topologies].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const provider of topology.providers) {
      if (provider.cloudProvider === "generic") continue;
      const label = provider.name;
      const id = externalSystemId(label);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          label: normalizeLabel(label),
          provider: provider.cloudProvider,
          description: confirmed(`Terraform-managed ${provider.cloudProvider} provider used by ${normalizeLabel(topology.name).displayLabel}.`, provider.evidence),
          evidence: provider.evidence,
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
