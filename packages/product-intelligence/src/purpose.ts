import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import type { ProductIdentityConfidence } from "./contracts.js";
import { truncateToWords, wordCount } from "./label.js";

const MIN_WORDS = 20;
const MAX_WORDS = 40;

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * §6: 20-40 words, evidence-backed, current-state only. Built entirely from
 * confirmed/derived statements already present in the accepted models — no
 * roadmap text, invented scale, or quantified-savings claims are ever
 * introduced here since this function never reads roadmapCapabilities/
 * gapCapabilities/excludedCandidates.
 */
export function synthesizeProductPurpose(
  model: CapabilityModel,
  arch: ArchitectureIntelligence,
  primaryUsers: string[],
): { value: string; confidence: ProductIdentityConfidence; wordCount: number; withinBudget: boolean } {
  const problem = arch.purpose.problemStatement.value.trim() || arch.identity.oneLineDescription.value.trim();
  const problemConfidence = arch.purpose.problemStatement.value ? arch.purpose.problemStatement.inference : arch.identity.oneLineDescription.inference;

  const domainNames = model.domains
    .filter((d) => d.capabilities.length > 0)
    .map((d) => d.displayName)
    .slice(0, 3);

  const usersClause = primaryUsers.length > 0 ? ` for ${joinWithAnd(primaryUsers)}` : "";
  const domainsClause = domainNames.length > 0 ? ` by providing ${joinWithAnd(domainNames)}` : "";

  const sentence = `${problem}${domainsClause}${usersClause}.`.replace(/\s+/g, " ").trim();
  const truncated = truncateToWords(sentence, MAX_WORDS);
  const count = wordCount(truncated);

  return {
    value: truncated,
    confidence: problemConfidence === "confirmed" && domainNames.length > 0 ? "derived" : problemConfidence,
    wordCount: count,
    withinBudget: count >= MIN_WORDS && count <= MAX_WORDS,
  };
}
