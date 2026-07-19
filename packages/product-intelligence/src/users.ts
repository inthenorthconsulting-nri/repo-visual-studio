import type { ArchitectureIntelligence } from "@rvs/architecture-intelligence";
import type { CapabilityModel } from "@rvs/capability-intelligence";

/**
 * §7: users of the product (who operates/consumes it) are normalized into
 * durable roles from architecture-intelligence Actors (kind "human-role")
 * plus capability-level actor mentions — never from the audience viewing a
 * showcase deck, which is a separate concept (AudienceType).
 */
export function deriveUsers(model: CapabilityModel, arch: ArchitectureIntelligence): { primaryUsers: string[]; secondaryUsers: string[] } {
  const counts = new Map<string, number>();

  for (const actor of arch.actors) {
    if (actor.kind !== "human-role") continue;
    const label = actor.label.displayLabel;
    counts.set(label, (counts.get(label) ?? 0) + 3);
  }

  for (const cap of [...model.includedCapabilities, ...model.qualifiedCapabilities]) {
    const weight = cap.inclusion === "include" ? 2 : 1;
    for (const actor of cap.actors) {
      counts.set(actor, (counts.get(actor) ?? 0) + weight);
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label);

  return {
    primaryUsers: ranked.slice(0, 3),
    secondaryUsers: ranked.slice(3, 7),
  };
}
