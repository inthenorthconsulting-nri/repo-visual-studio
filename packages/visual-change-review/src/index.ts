// @rvs/visual-change-review -- Milestone 10.4's before / delta / after
// architecture change review.
//
// One self-contained HTML file showing what existed before, what
// evidence-backed changes occurred, what exists after, and how those changes
// connect to capabilities, governance findings, decisions, downstream reach,
// and unresolved impact.
//
// It computes none of that. Every change, every finding, every decision state,
// every impact path and every blast radius arrives already established by an
// upstream intelligence layer; this package decides only how a reader is shown
// all of them at once. It is read-only: it comments on nothing, approves
// nothing, and blocks nothing.

export * from "./contracts.js";
export * from "./causality.js";
export * from "./source.js";
export * from "./lenses.js";
export * from "./validation.js";
export * from "./view-state.js";
export * from "./artifact.js";
export { REVIEW_STYLES, reviewStylesheet } from "./styles.js";
export { REVIEW_ALGORITHMS, REVIEW_RUNTIME, REVIEW_RUNTIME_WIRING } from "./runtime.js";
export {
  buildChangeReviewId,
  buildDerivedChangeId,
  buildReviewFindingId,
  buildReviewPathId,
  buildUnresolvedImpactId,
} from "./ids.js";
