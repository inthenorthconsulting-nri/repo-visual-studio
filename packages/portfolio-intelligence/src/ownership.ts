import type { PortfolioCapability, PortfolioDecisionOwnerType, PortfolioProductRole } from "./contracts.js";

// ---------------------------------------------------------------------------
// Ownership signals — §14/§17/§25.
//
// Ownership is only ever resolved from already-computed participation
// evidence, never from a named individual and never from a role label
// alone without capability evidence backing it.
// ---------------------------------------------------------------------------

/**
 * A shared capability's ownership counts as resolved when exactly one
 * participant fully implements it (qualified: false) while every other
 * participant only qualifies for it — a de facto lead emerges from the
 * evidence itself. Two or more fully-current participants (or zero) means
 * ownership is genuinely ambiguous and must be surfaced, not guessed.
 */
export function isOwnershipResolved(capability: PortfolioCapability): boolean {
  if (capability.coverage !== "shared" && capability.coverage !== "overlapping") return true;
  const currentParticipants = capability.participation.filter((p) => !p.qualified);
  return currentParticipants.length === 1;
}

/** Generic decision-owner categories only (§25) — never a named individual. security_owner is intentionally never assigned by role alone; it is reserved for decisions raised directly from security-flavored evidence, which this milestone does not yet compute. */
const ROLE_OWNER_TYPE: Record<PortfolioProductRole, PortfolioDecisionOwnerType> = {
  control_plane: "architecture_council",
  governance_system: "platform_leadership",
  operations_system: "operations_owner",
  developer_tool: "product_owner",
  reliability_system: "operations_owner",
  migration_system: "architecture_council",
  metadata_system: "architecture_council",
  presentation_system: "product_owner",
  integration_layer: "architecture_council",
  shared_library: "architecture_council",
  domain_product: "product_owner",
  unknown: "platform_leadership",
};

export function defaultDecisionOwnerType(role: PortfolioProductRole): PortfolioDecisionOwnerType {
  return ROLE_OWNER_TYPE[role];
}
