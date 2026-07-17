// All IDs are pure functions of stable inputs (component/role names, workflow
// graph ids, capability labels) — never of scan order or timestamps — so two
// syntheses of the same commit always produce byte-identical output. Mirrors
// @rvs/workflow-graph/src/ids.ts and @rvs/terraform-graph/src/ids.ts.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function systemIdentityId(repoName: string): string {
  return `arch:identity:${sanitize(repoName)}`;
}

export function responsibilityId(label: string): string {
  return `arch:responsibility:${sanitize(label)}`;
}

export function capabilityDomainId(label: string): string {
  return `arch:capability:${sanitize(label)}`;
}

export function componentId(sourcePathOrKey: string): string {
  return `arch:component:${sanitize(sourcePathOrKey)}`;
}

export function actorId(label: string): string {
  return `arch:actor:${sanitize(label)}`;
}

export function externalSystemId(label: string): string {
  return `arch:external:${sanitize(label)}`;
}

export function flowId(kind: string, fromId: string, toId: string): string {
  return `arch:flow:${sanitize(kind)}:${sanitize(fromId)}->${sanitize(toId)}`;
}

export function boundaryId(label: string): string {
  return `arch:boundary:${sanitize(label)}`;
}

export function outcomeId(statement: string): string {
  return `arch:outcome:${sanitize(statement.slice(0, 60))}`;
}

export function riskId(label: string): string {
  return `arch:risk:${sanitize(label)}`;
}

export function dependencyId(kind: string, label: string): string {
  return `arch:dependency:${sanitize(kind)}:${sanitize(label)}`;
}

export function questionId(reason: string, relatedId: string): string {
  return `arch:question:${sanitize(reason)}:${sanitize(relatedId)}`;
}

export function workflowFamilyId(label: string): string {
  return `arch:workflow-family:${sanitize(label)}`;
}
