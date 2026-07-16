import { redactSecrets } from "@rvs/core";
import type { TerraformTopology, TerraformTopologyWarning } from "./types.js";

// Second-opinion structural validation (spec section 14.1), independent of
// how the topology was built — checks the output object's own invariants
// rather than re-deriving them from source.
export function validateTerraformTopologyStructure(topology: TerraformTopology): TerraformTopologyWarning[] {
  const warnings: TerraformTopologyWarning[] = [];
  const nodeIds = new Set<string>();

  for (const node of topology.nodes) {
    if (nodeIds.has(node.id)) {
      warnings.push({ code: "TERRAFORM_DUPLICATE_NODE_ID", severity: "error", message: `Duplicate node ID "${node.id}".`, sourcePath: topology.rootModulePath, relatedId: node.id });
    }
    nodeIds.add(node.id);
  }

  const edgeIds = new Set<string>();
  for (const edge of topology.edges) {
    if (edgeIds.has(edge.id)) {
      warnings.push({ code: "TERRAFORM_DUPLICATE_EDGE_ID", severity: "error", message: `Duplicate edge ID "${edge.id}".`, sourcePath: topology.rootModulePath, relatedId: edge.id });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      warnings.push({
        code: "TERRAFORM_DANGLING_EDGE",
        severity: "error",
        message: `Edge "${edge.id}" references unknown source node "${edge.source}".`,
        sourcePath: topology.rootModulePath,
        relatedId: edge.id,
      });
    }
    if (!nodeIds.has(edge.target)) {
      warnings.push({
        code: "TERRAFORM_DANGLING_EDGE",
        severity: "error",
        message: `Edge "${edge.id}" references unknown target node "${edge.target}".`,
        sourcePath: topology.rootModulePath,
        relatedId: edge.id,
      });
    }
  }

  const addressKeys = new Set<string>();
  for (const node of topology.nodes) {
    if (node.type !== "resource" && node.type !== "data-source") continue;
    const address = typeof node.metadata?.address === "string" ? node.metadata.address : node.label;
    const modulePath = typeof node.metadata?.modulePath === "string" ? node.metadata.modulePath : "";
    const key = `${node.type}::${modulePath}::${address}`;
    if (addressKeys.has(key)) {
      warnings.push({
        code: "TERRAFORM_RESOURCE_ADDRESS_COLLISION",
        severity: "error",
        message: `Duplicate ${node.type} address "${address}" in module "${modulePath || "(root)"}".`,
        sourcePath: topology.rootModulePath,
        relatedId: node.id,
      });
    }
    addressKeys.add(key);
  }

  // Spot-check: nothing that reads like a leaked secret should have made it
  // into node/edge metadata past the build-time redaction layers.
  for (const node of topology.nodes) {
    if (!node.metadata) continue;
    const serialized = JSON.stringify(node.metadata);
    if (redactSecrets(serialized).redactedCount > 0) {
      warnings.push({
        code: "TERRAFORM_SENSITIVE_VALUE_REDACTED",
        severity: "error",
        message: `Node "${node.id}" metadata still contains a value matching a secret pattern after redaction.`,
        sourcePath: topology.rootModulePath,
        relatedId: node.id,
        remediation: "This indicates a gap in redact.ts's coverage — file a bug rather than suppressing the warning.",
      });
    }
  }

  return warnings;
}
