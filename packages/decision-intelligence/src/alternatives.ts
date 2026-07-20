// Extracts alternatives only from structured syntax: frontmatter
// `alternatives:` (an array of `{ statement, state }` objects, or of
// `"[state] statement"`/`"state: statement"` strings), or a recognized
// labeled list under a `## Alternatives` heading. Alternatives are never
// ranked -- there is no ordinal/priority field on DecisionAlternative,
// only document order, which itself carries no meaning here.

import type { DecisionAlternative, DecisionAlternativeState, EvidenceRef } from "./contracts.js";
import { buildAlternativeId } from "./ids.js";
import { parseLabeledListItem } from "./markdown-parser.js";
import type { RawParsedDecision } from "./markdown-parser.js";

const ALTERNATIVE_STATES: readonly DecisionAlternativeState[] = ["considered", "rejected", "deferred", "selected", "unknown"];
const DEFAULT_STATE: DecisionAlternativeState = "unknown";

export function extractAlternatives(
  decisionId: string,
  frontmatter: Record<string, unknown> | undefined,
  parsed: RawParsedDecision,
  evidenceRefs: EvidenceRef[],
): DecisionAlternative[] {
  const fromFrontmatter = extractFromFrontmatter(frontmatter?.["alternatives"]);
  const items = fromFrontmatter.length > 0 ? fromFrontmatter : extractFromList(parsed.listItemsBySection["alternatives"]);

  return items.map((item, index) => ({
    id: buildAlternativeId(decisionId, `${index}.${item.statement}`),
    decision_id: decisionId,
    statement: item.statement,
    state: item.state,
    evidence_refs: evidenceRefs,
  }));
}

function extractFromFrontmatter(raw: unknown): Array<{ statement: string; state: DecisionAlternativeState }> {
  if (!Array.isArray(raw)) return [];

  const results: Array<{ statement: string; state: DecisionAlternativeState }> = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      const { label, statement } = parseLabeledListItem(entry, ALTERNATIVE_STATES);
      results.push({ statement, state: isAlternativeState(label) ? label : DEFAULT_STATE });
    } else if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      const statement = record["statement"];
      const state = record["state"];
      if (typeof statement === "string" && statement.trim().length > 0) {
        results.push({ statement: statement.trim(), state: isAlternativeState(state) ? state : DEFAULT_STATE });
      }
    }
  }
  return results;
}

function extractFromList(items: string[] | undefined): Array<{ statement: string; state: DecisionAlternativeState }> {
  if (!items) return [];
  return items.map((item) => {
    const { label, statement } = parseLabeledListItem(item, ALTERNATIVE_STATES);
    return { statement, state: isAlternativeState(label) ? label : DEFAULT_STATE };
  });
}

function isAlternativeState(value: unknown): value is DecisionAlternativeState {
  return typeof value === "string" && (ALTERNATIVE_STATES as readonly string[]).includes(value);
}
