// Extracts consequences only from structured syntax: frontmatter
// `consequences:` (an array of `{ statement, classification }` objects, or
// of `"[classification] statement"`/`"classification: statement"`
// strings), or a recognized labeled list under a `## Consequences` heading.
// Classification comes only from an explicit label -- never inferred from
// wording ("this removes flexibility" is not detected as "negative").

import type { DecisionConsequence, DecisionConsequenceClass, EvidenceRef } from "./contracts.js";
import { buildConsequenceId } from "./ids.js";
import { parseLabeledListItem } from "./markdown-parser.js";
import type { RawParsedDecision } from "./markdown-parser.js";

const CONSEQUENCE_CLASSES: readonly DecisionConsequenceClass[] = ["positive", "negative", "neutral", "tradeoff", "risk", "obligation", "constraint", "unclassified"];
const DEFAULT_CLASS: DecisionConsequenceClass = "unclassified";

export function extractConsequences(
  decisionId: string,
  frontmatter: Record<string, unknown> | undefined,
  parsed: RawParsedDecision,
  evidenceRefs: EvidenceRef[],
): DecisionConsequence[] {
  const fromFrontmatter = extractFromFrontmatter(frontmatter?.["consequences"]);
  const items = fromFrontmatter.length > 0 ? fromFrontmatter : extractFromList(parsed.listItemsBySection["consequences"]);

  return items.map((item, index) => ({
    id: buildConsequenceId(decisionId, `${index}.${item.statement}`),
    decision_id: decisionId,
    statement: item.statement,
    classification: item.classification,
    evidence_refs: evidenceRefs,
  }));
}

function extractFromFrontmatter(raw: unknown): Array<{ statement: string; classification: DecisionConsequenceClass }> {
  if (!Array.isArray(raw)) return [];

  const results: Array<{ statement: string; classification: DecisionConsequenceClass }> = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      const { label, statement } = parseLabeledListItem(entry, CONSEQUENCE_CLASSES);
      results.push({ statement, classification: isConsequenceClass(label) ? label : DEFAULT_CLASS });
    } else if (typeof entry === "object" && entry !== null) {
      const record = entry as Record<string, unknown>;
      const statement = record["statement"];
      const classification = record["classification"];
      if (typeof statement === "string" && statement.trim().length > 0) {
        results.push({ statement: statement.trim(), classification: isConsequenceClass(classification) ? classification : DEFAULT_CLASS });
      }
    }
  }
  return results;
}

function extractFromList(items: string[] | undefined): Array<{ statement: string; classification: DecisionConsequenceClass }> {
  if (!items) return [];
  return items.map((item) => {
    const { label, statement } = parseLabeledListItem(item, CONSEQUENCE_CLASSES);
    return { statement, classification: isConsequenceClass(label) ? label : DEFAULT_CLASS };
  });
}

function isConsequenceClass(value: unknown): value is DecisionConsequenceClass {
  return typeof value === "string" && (CONSEQUENCE_CLASSES as readonly string[]).includes(value);
}
