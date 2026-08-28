import type { ChangeReviewModel, ReviewLens } from "./contracts.js";
import { REVIEW_LENS_IDS } from "./lenses.js";

// What the review remembers about where the reader is.
//
// Same security property @rvs/visual-explorer's view state keeps, and kept the
// same way: **state names things the artifact already contains, and every name
// is resolved against the embedded model.** A state field is a change id, an
// entity id, a lens, a panel, or search text. It is never a path, never a URL,
// never anything the page could fetch, open, or resolve against a filesystem.
// An id the artifact does not contain never becomes state, so a path smuggled
// into `f=` reaches no resolver at all -- it is rejected at the boundary and
// the reader is told.
//
// Nothing sensitive travels here either: no evidence text, no absolute paths,
// no secrets, no local file references. A link a reviewer pastes into a pull
// request comment carries a change id and a lens, and that is the whole of it.

export type ReviewPanel = "before" | "delta" | "after";

export interface ReviewViewState {
  /** The change the reader selected, by change id. */
  change?: string;
  /** The entity the reader selected, by entity id. Set independently of `change` so an unchanged neighbour can be inspected. */
  focus?: string;
  lens: ReviewLens;
  /** Which of the three panels holds keyboard focus. */
  panel: ReviewPanel;
  /** The reader's search text, so a shared link reopens the same search. */
  query: string;
}

export const DEFAULT_REVIEW_VIEW_STATE: ReviewViewState = {
  lens: "architecture",
  panel: "delta",
  query: "",
};

const PANELS: readonly ReviewPanel[] = ["before", "delta", "after"];
const LENS_IDS = new Set<string>(REVIEW_LENS_IDS);

/**
 * Search text a state may carry.
 *
 * Restricted to what a reader plausibly types at an entity name. The query is
 * echoed back into the page, and escaping already makes echoing safe; this is
 * the second lock, so one escaping mistake downstream is not also an
 * injection.
 */
const SAFE_QUERY = /^[\w .:/@-]{0,80}$/;

export function encodeReviewViewState(state: ReviewViewState): string {
  const parts = [
    state.change === undefined ? undefined : `c=${encodeURIComponent(state.change)}`,
    state.focus === undefined ? undefined : `f=${encodeURIComponent(state.focus)}`,
    `l=${state.lens}`,
    `p=${state.panel}`,
    state.query === "" ? undefined : `q=${encodeURIComponent(state.query)}`,
  ].filter((p): p is string => p !== undefined);
  return parts.join("&");
}

export interface DecodedReviewViewState {
  state: ReviewViewState;
  /** Every field that was present but not usable, and why. Never silently dropped. */
  rejected: string[];
}

/**
 * Decodes a state, validating every field against the review it will be
 * applied to.
 *
 * Unknown fields are *reported*, not ignored. A reviewer who follows a
 * colleague's link to a change that is no longer in the review should be told
 * the change is gone, rather than shown the default view and left to conclude
 * they misread the link.
 */
export function decodeReviewViewState(encoded: string, model: ChangeReviewModel): DecodedReviewViewState {
  const state: ReviewViewState = { ...DEFAULT_REVIEW_VIEW_STATE };
  const rejected: string[] = [];
  const changeIds = new Set(model.changes.map((c) => c.id));
  const entityIds = new Set([...model.before_entity_ids, ...model.after_entity_ids]);

  for (const part of encoded.replace(/^#/, "").split("&")) {
    if (part === "") continue;
    const separator = part.indexOf("=");
    if (separator < 0) {
      rejected.push(`malformed field "${truncateForMessage(part)}"`);
      continue;
    }
    const key = part.slice(0, separator);
    let value: string;
    try {
      value = decodeURIComponent(part.slice(separator + 1));
    } catch {
      rejected.push(`undecodable value for "${key}"`);
      continue;
    }

    switch (key) {
      case "c":
        if (changeIds.has(value)) state.change = value;
        else rejected.push(`unknown change "${truncateForMessage(value)}"`);
        break;
      case "f":
        if (entityIds.has(value)) state.focus = value;
        else rejected.push(`unknown entity "${truncateForMessage(value)}"`);
        break;
      case "l":
        if (LENS_IDS.has(value)) state.lens = value as ReviewLens;
        else rejected.push(`unknown lens "${truncateForMessage(value)}"`);
        break;
      case "p":
        if ((PANELS as readonly string[]).includes(value)) state.panel = value as ReviewPanel;
        else rejected.push(`unknown panel "${truncateForMessage(value)}"`);
        break;
      case "q":
        if (SAFE_QUERY.test(value)) state.query = value;
        else rejected.push("query contained characters a search box does not accept");
        break;
      default:
        rejected.push(`unknown field "${truncateForMessage(key)}"`);
    }
  }

  return { state, rejected };
}

/** Keeps a rejected value from turning a diagnostic into a place to hide a payload. */
function truncateForMessage(value: string): string {
  const flattened = value.replace(/[^\w .:/@-]/g, "?");
  return flattened.length > 48 ? `${flattened.slice(0, 48)}...` : flattened;
}
