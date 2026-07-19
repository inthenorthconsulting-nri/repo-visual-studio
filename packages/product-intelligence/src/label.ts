import { ABSOLUTE_SUPERIORITY_TERMS, ENTERPRISE_SCALE_TERMS, GENERIC_MARKETING_TERMS, QUALIFIED_MATURITY_TERMS } from "./contracts.js";

/** §5/§9/§28: shared text hygiene used by descriptor/purpose/differentiator/claim generation so "avoid unsupported marketing language" is enforced at one place, not re-implemented per call site. */
export function containsGenericMarketingTerm(text: string): string | undefined {
  const lower = text.toLowerCase();
  return GENERIC_MARKETING_TERMS.find((term) => lower.includes(term));
}

export function containsAbsoluteSuperiorityTerm(text: string): string | undefined {
  const lower = text.toLowerCase();
  return ABSOLUTE_SUPERIORITY_TERMS.find((term) => lower.includes(term));
}

export type EvidenceClassAvailable = "deployment" | "release" | "usage";

/** Returns the term from `termsMap` found in `text` that isn't backed by any class in `availableEvidenceClasses`, or undefined if none/all are backed. */
export function findUnsupportedTerm(text: string, termsMap: Record<string, readonly EvidenceClassAvailable[]>, availableEvidenceClasses: ReadonlySet<EvidenceClassAvailable>): string | undefined {
  const lower = text.toLowerCase();
  for (const [term, requiredClasses] of Object.entries(termsMap)) {
    if (lower.includes(term) && !requiredClasses.some((c) => availableEvidenceClasses.has(c))) {
      return term;
    }
  }
  return undefined;
}

/** Returns the qualified-maturity term found in `text` that isn't backed by any class in `availableEvidenceClasses`, or undefined if none/all are backed. */
export function findUnsupportedQualifiedMaturityTerm(text: string, availableEvidenceClasses: ReadonlySet<EvidenceClassAvailable>): string | undefined {
  return findUnsupportedTerm(text, QUALIFIED_MATURITY_TERMS, availableEvidenceClasses);
}

/** Returns the enterprise/scale term found in `text` that isn't backed by any class in `availableEvidenceClasses`, or undefined if none/all are backed. */
export function findUnsupportedEnterpriseTerm(text: string, availableEvidenceClasses: ReadonlySet<EvidenceClassAvailable>): string | undefined {
  return findUnsupportedTerm(text, ENTERPRISE_SCALE_TERMS, availableEvidenceClasses);
}

export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ");
}

/** Title-cases a snake/kebab identifier into a human-facing phrase, e.g. "governance_platform" -> "Governance Platform". Never invents words beyond the identifier's own parts. */
export function humanizeIdentifier(identifier: string): string {
  return identifier
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
