// Mirrors @rvs/capability-intelligence/src/ids.ts: every id is a pure
// function of a stable input (never scan order or timestamps) so two
// syntheses of the same commit produce byte-identical output.

const SAFE = /[^a-zA-Z0-9_.-]/g;

function sanitize(part: string): string {
  return part.replace(SAFE, "-");
}

export function productEvidenceId(sourceType: string, sourceId: string, index: number): string {
  return `prodintel:evidence:${sanitize(sourceType)}:${sanitize(sourceId)}:${index}`;
}

export function productCandidateId(archetype: string): string {
  return `prodintel:candidate:${sanitize(archetype)}`;
}

export function valuePillarId(title: string): string {
  return `prodintel:pillar:${sanitize(title.toLowerCase())}`;
}

export function differentiatorId(title: string): string {
  return `prodintel:differentiator:${sanitize(title.toLowerCase())}`;
}

export function proofPointId(label: string): string {
  return `prodintel:proof:${sanitize(label.toLowerCase())}`;
}

export function claimId(claimType: string, subjectId: string): string {
  return `prodintel:claim:${sanitize(claimType)}:${sanitize(subjectId)}`;
}

export function showcaseSceneId(type: string, index: number): string {
  return `showcase:scene:${sanitize(type)}:${index}`;
}

export function showcaseMetricId(label: string): string {
  return `showcase:metric:${sanitize(label.toLowerCase())}`;
}
