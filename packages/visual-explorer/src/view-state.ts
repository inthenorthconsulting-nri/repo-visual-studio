import type { VisualGraphModel } from "@rvs/visual-intelligence";
import { EXPLORER_LENSES, type ExplorerLens, type TraversalDirection } from "./interaction.js";

// What the explorer remembers about where the reader is.
//
// The security rule this file exists to keep: **view state names entities, and
// entities are resolved against the model embedded in the artifact.** It is
// never a path, never a URL, never anything the page could fetch or open. A
// state naming an entity the artifact does not contain is rejected outright
// rather than passed along to something that might try to resolve it.
//
// The encoding is intentionally boring -- `key=value` pairs joined by `&` --
// because a compact binary format would make a hostile state harder to read
// and no harder to construct.

export interface ExplorerViewState {
  /** The entity the reader focused, by source entity id. */
  focus?: string;
  /** The other end of a traced route. */
  route_to?: string;
  direction: TraversalDirection;
  /** Hops from the focus. Bounded so a state cannot ask for an unbounded traversal. */
  depth: number;
  lens: ExplorerLens;
  /** The reader's search text. Kept so a shared link reopens the same search. */
  query: string;
}

export const MAX_REACH_DEPTH = 6;

export const DEFAULT_VIEW_STATE: ExplorerViewState = {
  direction: "downstream",
  depth: 2,
  lens: "none",
  query: "",
};

const DIRECTIONS: readonly TraversalDirection[] = ["upstream", "downstream", "both"];
const LENS_IDS = new Set(EXPLORER_LENSES.map((l) => l.id));

/**
 * Search text a state may carry.
 *
 * Restricted to what a reader plausibly types at an entity name, because the
 * query is echoed back into the page. Escaping already makes echoing safe;
 * this is the second lock, so a single escaping mistake somewhere downstream
 * is not also an injection.
 */
const SAFE_QUERY = /^[\w .:/@-]{0,80}$/;

function encodeValue(value: string): string {
  return encodeURIComponent(value);
}

/** Encodes a state as an opaque, path-free fragment. */
export function encodeViewState(state: ExplorerViewState): string {
  const parts = [
    state.focus === undefined ? undefined : `f=${encodeValue(state.focus)}`,
    state.route_to === undefined ? undefined : `t=${encodeValue(state.route_to)}`,
    `d=${state.direction}`,
    `n=${state.depth}`,
    `l=${state.lens}`,
    state.query === "" ? undefined : `q=${encodeValue(state.query)}`,
  ].filter((p): p is string => p !== undefined);
  return parts.join("&");
}

export interface DecodedViewState {
  state: ExplorerViewState;
  /** Every field that was present but not usable, and why. Never silently dropped. */
  rejected: string[];
}

/**
 * Decodes a state, validating every field against the artifact it will be
 * applied to.
 *
 * Unknown or malformed fields are *reported*, not ignored. A reader who
 * followed a link to an entity that no longer exists should be told the
 * entity is gone, rather than shown the default view and left to conclude
 * they misremembered.
 */
export function decodeViewState(encoded: string, model: VisualGraphModel): DecodedViewState {
  const state: ExplorerViewState = { ...DEFAULT_VIEW_STATE };
  const rejected: string[] = [];
  const entities = new Set(
    model.nodes.filter((n) => n.placeholder_for === undefined).map((n) => n.source_entity_id),
  );

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
      case "f":
      case "t": {
        // The whole security property, in one branch: an id that is not an
        // entity of *this* artifact never becomes state. Nothing downstream
        // is asked to resolve it, so a path or a URL smuggled in here reaches
        // no resolver at all.
        if (!entities.has(value)) {
          rejected.push(`unknown entity "${truncateForMessage(value)}"`);
          break;
        }
        if (key === "f") state.focus = value;
        else state.route_to = value;
        break;
      }
      case "d":
        if ((DIRECTIONS as readonly string[]).includes(value)) state.direction = value as TraversalDirection;
        else rejected.push(`unknown direction "${truncateForMessage(value)}"`);
        break;
      case "n": {
        // Matched as digits before it is read as a number. `Number("")` is 0,
        // and 0 is a depth in range, so a coercion here would let an empty
        // field quietly mean "no hops" -- an answer the reader never asked
        // for, arriving with nothing rejected to tell them so.
        const depth = /^\d+$/.test(value) ? Number(value) : Number.NaN;
        if (Number.isInteger(depth) && depth >= 0 && depth <= MAX_REACH_DEPTH) state.depth = depth;
        else rejected.push(`depth out of range "${truncateForMessage(value)}"`);
        break;
      }
      case "l":
        if (LENS_IDS.has(value as ExplorerLens)) state.lens = value as ExplorerLens;
        else rejected.push(`unknown lens "${truncateForMessage(value)}"`);
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
