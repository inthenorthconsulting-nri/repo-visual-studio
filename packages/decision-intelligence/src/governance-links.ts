// Validates a `decision_ref` already present on a governance policy
// exception (existence, decision-status compatibility, scope match,
// non-expiry). This module never creates or edits an exception -- the
// linked decision supports the exception, it does not replace the
// exception record (spec §38). Governance's own `.rvs/governance.yml`
// loader carries `decision_ref` through as a plain optional string; this
// package treats an already-loaded governance policy as `unknown` JSON,
// since it must not import @rvs/governance-intelligence types.

import type { ArchitectureDecision, DecisionLink } from "./contracts.js";
import { buildDecisionLink } from "./links.js";

interface RawGovernanceException {
  policy_id?: unknown;
  rule_id?: unknown;
  scope?: unknown;
  expiry?: unknown;
  decision_ref?: unknown;
}

const STATUSES_THAT_CAN_BACK_AN_EXCEPTION = new Set<ArchitectureDecision["decision_status"]>(["accepted", "implemented", "partially_implemented"]);

export function buildGovernanceLinks(decisions: ArchitectureDecision[], governancePolicy: unknown, now: string): DecisionLink[] {
  const exceptions = extractExceptions(governancePolicy);
  if (exceptions.length === 0) return [];

  const decisionsById = new Map(decisions.map((d) => [d.id, d]));
  const links: DecisionLink[] = [];

  for (const exception of exceptions) {
    const decisionRef = exception.decision_ref;
    if (typeof decisionRef !== "string" || decisionRef.trim().length === 0) continue;

    const decision = decisionsById.get(decisionRef);
    const exceptionKey = `${String(exception.policy_id ?? "")}:${String(exception.rule_id ?? "")}`;

    if (!decision) {
      links.push(
        buildDecisionLink(
          decisionRef,
          "excepts",
          "governance",
          exceptionKey,
          { resolution: "unresolved" },
          `Governance exception "${exceptionKey}" names decision_ref "${decisionRef}", which does not match any discovered decision.`,
          [],
        ),
      );
      continue;
    }

    const expired = typeof exception.expiry === "string" && new Date(exception.expiry).getTime() < new Date(now).getTime();
    const statusCompatible = STATUSES_THAT_CAN_BACK_AN_EXCEPTION.has(decision.decision_status);
    const scopeMatches = matchesScope(exception.scope, decision);

    if (!statusCompatible || expired || !scopeMatches) {
      const reasons = [
        !statusCompatible ? `decision status "${decision.decision_status}" cannot back an exception` : undefined,
        expired ? "the exception has expired" : undefined,
        !scopeMatches ? "the exception's scope does not match this decision" : undefined,
      ].filter((r): r is string => r !== undefined);

      links.push(
        buildDecisionLink(
          decision.id,
          "excepts",
          "governance",
          exceptionKey,
          { resolution: "incompatible", targetId: exceptionKey },
          `Decision "${decision.id}" is linked to governance exception "${exceptionKey}", but ${reasons.join(" and ")}.`,
          decision.evidence_refs,
        ),
      );
      continue;
    }

    links.push(
      buildDecisionLink(
        decision.id,
        "excepts",
        "governance",
        exceptionKey,
        { resolution: "resolved", targetId: exceptionKey },
        `Decision "${decision.id}" supports governance exception "${exceptionKey}".`,
        decision.evidence_refs,
      ),
    );
  }

  return links;
}

export function extractExceptions(governancePolicy: unknown): RawGovernanceException[] {
  if (typeof governancePolicy !== "object" || governancePolicy === null) return [];
  const exceptions = (governancePolicy as Record<string, unknown>)["exceptions"];
  if (!Array.isArray(exceptions)) return [];
  return exceptions.filter((e): e is RawGovernanceException => typeof e === "object" && e !== null);
}

function matchesScope(scope: unknown, decision: ArchitectureDecision): boolean {
  if (typeof scope !== "string" || scope.trim().length === 0) return true;
  let pattern: RegExp;
  try {
    pattern = new RegExp(scope);
  } catch {
    return false;
  }
  return pattern.test(decision.id) || pattern.test(decision.scope);
}
