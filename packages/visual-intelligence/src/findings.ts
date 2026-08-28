import { buildValidationFindingId } from "./ids.js";

// One finding shape for every Milestone 10 validator family.
//
// The families are separate -- theme resolution, accessibility, and motion
// planning each answer a different question and each publish their own code
// union -- but they all report through this one structure, so a caller can
// collect findings from all of them into a single list and sort it without
// knowing which family produced which entry. §37's rule is that there must
// not be two vocabularies saying the same thing; it is not a rule that every
// code must live in one union, which would make `VISUAL_A11Y_CONTRAST` and
// `VISUAL_GRAMMAR_UNSUPPORTED` members of the same type for no reason.

export interface VisualFinding<TCode extends string = string> {
  id: string;
  code: TCode;
  message: string;
  subject_id: string;
  blocking: boolean;
}

/** Builds a finding with the same deterministic id scheme the spec validator uses. */
export function buildFinding<TCode extends string>(
  code: TCode,
  subjectId: string,
  message: string,
  blocking: boolean,
): VisualFinding<TCode> {
  return { id: buildValidationFindingId(code, subjectId), code, message, subject_id: subjectId, blocking };
}

/**
 * Sorts findings into the one order every producer here returns them in.
 *
 * By code, then subject, then message. Two runs over the same input therefore
 * serialise identically, which is what §62's determinism proof rests on --
 * and it means a diff between two runs shows a real change rather than a
 * reordering.
 */
export function sortFindings<T extends VisualFinding<string>>(findings: readonly T[]): T[] {
  return [...findings].sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      a.subject_id.localeCompare(b.subject_id) ||
      a.message.localeCompare(b.message),
  );
}
