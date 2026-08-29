// Terminal presentation helpers shared by `rvs change validate`/`evaluate`/
// `explain`. Presentation-only: never mutates a ChangeAdvisory's truth
// value, never reconstructs governance/decision wording (§20 -- callers
// must print AdvisoryGovernanceFinding.statement/AdvisoryDecisionFinding
// .statement verbatim, only sanitized here).

import type { ChangeAdvisory } from "@rvs/change-workbench";

/** Strips control characters (including raw ANSI escapes) from caller-controlled text -- title/label/detail/statement fields -- before it reaches the real terminal (§26). Applied only at the presentation boundary; the stored/returned advisory itself is never altered. */
export function sanitizeTerminalText(value: string): string {
  return Array.from(value)
    .filter((char) => char.codePointAt(0)! > 0x1f && char.codePointAt(0)! !== 0x7f)
    .join("");
}

export type OverallCoverageLabel = "ADVISORY COMPLETE" | "ADVISORY PARTIAL" | "ADVISORY UNRESOLVED";

/** Derives the §19 terminal heading from `domain_coverage`: unresolved beats partial beats complete, mirroring change-advisory.ts's own coverage-status priority. */
export function overallCoverageLabel(advisory: ChangeAdvisory): OverallCoverageLabel {
  const statuses = advisory.domain_coverage.map((entry) => entry.status);
  if (statuses.includes("unresolved")) return "ADVISORY UNRESOLVED";
  if (statuses.includes("partial")) return "ADVISORY PARTIAL";
  return "ADVISORY COMPLETE";
}
