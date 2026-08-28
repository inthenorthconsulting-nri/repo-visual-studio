// @rvs/visual-delivery -- Milestone 10.6's verified delivery layer.
//
// It renders nothing and validates nothing. It stages a generated candidate
// away from the artifact people are reading, runs the validators a named
// profile requires, replaces the artifact atomically when every required check
// passes, and preserves the last known good byte for byte when anything does
// not -- with a receipt saying which invariant was missed and what class of
// change would satisfy it.

export * from "./contracts.js";
export * from "./ids.js";
export * from "./security.js";
export * from "./validation-profile.js";
export * from "./repairs.js";
export * from "./candidate.js";
export * from "./verification.js";
export * from "./promotion.js";
export * from "./history.js";
export * from "./receipts.js";
export * from "./preview.js";
export * from "./deliver.js";
