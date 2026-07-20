// Extracts assumptions only from structured syntax: frontmatter
// `assumptions:` (an array of `{ statement, state }` objects, or of
// `"[state] statement"`/`"state: statement"` strings), or a recognized
// labeled list under a `## Assumptions` heading. Never sentiment/prose
// inference over the rest of the document.

import type { DecisionAssumption, DecisionAssumptionState, EvidenceRef } from "./contracts.js";
import { buildAssumptionId } from "./ids.js";
import { parseLabeledListItem } from "./markdown-parser.js";
import type { RawParsedDecision } from "./markdown-parser.js";

const ASSUMPTION_STATES: readonly DecisionAssumptionState[] = ["confirmed", "supported", "weakened", "contradicted", "unverifiable", "retired"];
const DEFAULT_STATE: DecisionAssumptionState = "unverifiable";

export function extractAssumptions(
  decisionId: string,
  frontmatter: Record<string, unknown> | undefined,
  parsed: RawParsedDecision,
  evidenceRefs: EvidenceRef[],
): DecisionAssumption[] {
  const fromFrontmatter = extractFromFrontmatter(frontmatter?.["assumptions"]);
  const items = fromFrontmatter.length > 0 ? fromFrontmatter : extractFromList(parsed.listItemsBySection["assumptions"]);

  return items.map((item, index) => ({
    id: buildAssumptionId(decisionId, `${index}.${item.statement}`),
    decision_id: decisionId,
    statement: item.statement,
    state: item.state,
    evidence_refs: evidenceRefs,
  }));
}

function extractFromFrontmatter(raw: unknown): Array<{ statement: string; state: DecisionAssumptionState }> {
  if (!Array.isArray(raw)) return [];

  const results: Array<{ statement: string; state: DecisionAssumptionState }> = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      const { label, statement } = parseLabeledListItem(entry, ASSUMPTION_STATES);
      results.push({ statement, state: isAssumptionState(label) ? label : DEFAULT_STATE });
    } else if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      const statement = record["statement"];
      const state = record["state"];
      if (typeof statement === "string" && statement.trim().length > 0) {
        results.push({ statement: statement.trim(), state: isAssumptionState(state) ? state : DEFAULT_STATE });
      }
    }
  }
  return results;
}

function extractFromList(items: string[] | undefined): Array<{ statement: string; state: DecisionAssumptionState }> {
  if (!items) return [];
  return items.map((item) => {
    const { label, statement } = parseLabeledListItem(item, ASSUMPTION_STATES);
    return { statement, state: isAssumptionState(label) ? label : DEFAULT_STATE };
  });
}

function isAssumptionState(value: unknown): value is DecisionAssumptionState {
  return typeof value === "string" && (ASSUMPTION_STATES as readonly string[]).includes(value);
}
