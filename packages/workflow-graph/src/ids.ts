// All IDs are pure functions of (workflow id, GitHub-Actions-assigned names/
// indices) — never of scan order or timestamps — so two parses of the same
// commit always produce byte-identical graphs.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function workflowId(name: string): string {
  return `workflow:${sanitize(name)}`;
}

export function triggerId(workflowIdValue: string, eventName: string): string {
  return `trigger:${sanitize(eventName)}@${workflowIdValue}`;
}

export function jobId(workflowIdValue: string, jobKey: string): string {
  return `job:${workflowIdValue}:${sanitize(jobKey)}`;
}

export function stepId(jobIdValue: string, index: number, stepKey?: string): string {
  return `step:${jobIdValue}:${index}${stepKey ? `:${sanitize(stepKey)}` : ""}`;
}

export function reusableWorkflowId(workflowIdValue: string, jobKey: string): string {
  return `reusable-workflow:${workflowIdValue}:${sanitize(jobKey)}`;
}

export function environmentId(workflowIdValue: string, envName: string): string {
  return `environment:${sanitize(envName)}@${workflowIdValue}`;
}

export function approvalId(jobIdValue: string): string {
  return `approval:${jobIdValue}`;
}

export function edgeId(type: string, from: string, to: string): string {
  return `edge:${from}->${to}:${type}`;
}
