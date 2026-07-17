import type { WorkflowGraph } from "@rvs/workflow-graph";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { confirmed, derived, unresolved } from "../inference.js";
import type { ArchitectureBoundary, OperatingModel, WorkflowFamily } from "../types.js";

const SCHEDULE_OR_RELEASE = /^(schedule|release)$/i;

export function buildOperatingModel(graphs: WorkflowGraph[], topologies: TerraformTopology[], boundaries: ArchitectureBoundary[], workflowFamilies: WorkflowFamily[]): OperatingModel {
  const deploymentEnvironments = boundaries.length > 0
    ? boundaries.map((b) => confirmed(`${b.label.displayLabel} deployment environment.`, b.evidence))
    : [unresolved("No deployment environments were declared in scanned GitHub Actions workflows.", "No WorkflowNode of type \"environment\" was found.")];

  const releaseTriggerGraphs = graphs.filter((g) => g.triggers.some((t) => SCHEDULE_OR_RELEASE.test(t.name)));
  const releaseProcess = releaseTriggerGraphs.length > 0
    ? releaseTriggerGraphs.map((g) =>
        derived(`${g.name} runs on a schedule or release trigger.`, g.triggers.filter((t) => SCHEDULE_OR_RELEASE.test(t.name)).flatMap((t) => t.evidence), "Derived from workflow trigger events named \"schedule\" or \"release\"."),
      )
    : [unresolved("No scheduled or release-triggered workflows were found.", "No workflow trigger named \"schedule\" or \"release\" was found.")];

  const observabilityNodes = topologies.flatMap((t) => t.nodes.filter((n) => (n.metadata as { resourceCategory?: string } | undefined)?.resourceCategory === "observability"));
  const observability = observabilityNodes.length > 0
    ? [confirmed(`${observabilityNodes.length} observability-related infrastructure resource${observabilityNodes.length === 1 ? "" : "s"} declared in Terraform.`, observabilityNodes.flatMap((n) => n.evidence))]
    : workflowFamilies.some((f) => f.label.sourceLabel === "Observability")
      ? [derived("Observability is handled by dedicated automation workflows rather than declared infrastructure.", [], "Derived from the presence of an Observability workflow family.")]
      : [unresolved("No observability infrastructure or automation was found.", "No Terraform resource in category \"observability\" and no Observability workflow family were found.")];

  const approvalGraphs = graphs.filter((g) => g.nodes.some((n) => n.type === "approval"));
  const approvalGates = approvalGraphs.length > 0
    ? approvalGraphs.map((g) => confirmed(`${g.name} requires an approval gate before completing.`, g.nodes.filter((n) => n.type === "approval").flatMap((n) => n.evidence)))
    : [unresolved("No approval gates were found in scanned workflows.", "No WorkflowNode of type \"approval\" was found.")];

  return { deploymentEnvironments, releaseProcess, observability, approvalGates };
}
