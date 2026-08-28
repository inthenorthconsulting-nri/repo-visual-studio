// @rvs/visual-composition -- Milestone 10.2's adaptive detail and audience
// rendering layer.
//
// Detail mode decides how much content survives. Audience decides how that
// content is described. This package keeps the two dimensions separate,
// assembles the overview and its detail views into one document, and proves
// the document accounts for every source entity it was given.

export * from "./audience-rendering.js";
export * from "./compose.js";
