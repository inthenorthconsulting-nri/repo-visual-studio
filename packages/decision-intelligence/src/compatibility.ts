// Staged, sequential short-circuit compatibility check between two
// DecisionSnapshots -- mirrors governance-intelligence's own
// compatibility.ts staging (missing artifact -> schema mismatch -> identity
// mismatch -> reduced coverage -> staleness -> compatible), collapsed to the
// two statuses contracts.ts's DecisionSnapshotCompatibility actually defines
// ("compatible" | "incompatible"): governance's "partial"/"compatible_with_
// warnings" stages have no equivalent status here, so those same conditions
// surface as advisory entries in `reasons` under a still-"compatible"
// result rather than a status this package's own type doesn't have. Never a
// bare boolean.

import type { DecisionSnapshot, DecisionSnapshotCompatibility } from "./contracts.js";

export function assessDecisionSnapshotCompatibility(source: DecisionSnapshot, target: DecisionSnapshot): DecisionSnapshotCompatibility {
  if (source.schema_version !== target.schema_version) {
    return { status: "incompatible", reasons: [`schema_version mismatch: source is ${source.schema_version}, target is ${target.schema_version}.`] };
  }

  if (source.repository_id !== target.repository_id) {
    return { status: "incompatible", reasons: [`repository identity mismatch: source is "${source.repository_id}", target is "${target.repository_id}".`] };
  }

  const reasons: string[] = [];

  if (source.compatibility === "unavailable" || target.compatibility === "unavailable") {
    const which = source.compatibility === "unavailable" && target.compatibility === "unavailable" ? "both snapshots" : source.compatibility === "unavailable" ? "the source snapshot" : "the target snapshot";
    reasons.push(`upstream artifact context is "unavailable" for ${which}; comparison proceeds on decision-record content only.`);
  } else if (source.compatibility === "partial" || target.compatibility === "partial") {
    const which = source.compatibility === "partial" && target.compatibility === "partial" ? "both snapshots" : source.compatibility === "partial" ? "the source snapshot" : "the target snapshot";
    reasons.push(`upstream artifact context is only "partial" for ${which}; some links may be under-resolved relative to a complete comparison.`);
  }

  if (source.generated_at && target.generated_at && target.generated_at < source.generated_at) {
    reasons.push(`target snapshot's generated_at (${target.generated_at}) precedes the source snapshot's (${source.generated_at}); comparison direction may be reversed.`);
  }

  return { status: "compatible", reasons };
}
