// Mirrors @rvs/architecture-intelligence/src/ids.ts: every id is a pure
// function of a stable input (never scan order or timestamps) so two
// syntheses of the same commit produce byte-identical output.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function capabilityId(sourceLabel: string): string {
  return `cap:capability:${sanitize(sourceLabel)}`;
}

export function capabilityEvidenceId(sourceLabel: string, sourcePath: string, index: number): string {
  return `cap:evidence:${sanitize(sourceLabel)}:${sanitize(sourcePath)}:${index}`;
}

export function capDomainId(label: string): string {
  return `cap:domain:${sanitize(label)}`;
}
