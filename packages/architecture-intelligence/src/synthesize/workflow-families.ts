import type { WorkflowGraph } from "@rvs/workflow-graph";
import { confirmed, derived } from "../inference.js";
import { workflowFamilyId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import type { WorkflowFamily } from "../types.js";

interface FamilyRule {
  label: string;
  keywords: RegExp;
}

// Order matters: first matching rule wins, so more specific families are listed first.
// Keywords use a leading \b only (not a trailing one) so stems match their
// natural suffixed forms too (e.g. "govern" matches "governance", "migrat"
// matches "migration"/"migrating") without matching mid-word substrings.
const FAMILY_RULES: FamilyRule[] = [
  { label: "Identity and access", keywords: /\b(iam|sso|oauth|access|permission|role)/i },
  { label: "Credentials", keywords: /\b(credential|secret|token|rotat|key-rotation|vault)/i },
  { label: "Review and approval", keywords: /\b(review|approv|sign-off|gate)/i },
  { label: "Onboarding", keywords: /\b(onboard|provision-user|new-hire|welcome)/i },
  { label: "Migration", keywords: /\b(migrat|backfill|upgrade-schema|convert)/i },
  { label: "Diagnostics", keywords: /\b(diagnos|debug|troubleshoot|healthcheck|health-check)/i },
  { label: "Observability", keywords: /\b(monitor|observab|alert|metric|log(ging)?|dashboard)/i },
  { label: "Query and PDT management", keywords: /\b(query|pdt|persistent-derived-table|cache-refresh)/i },
  { label: "Release and maintenance", keywords: /\b(release|deploy|publish|maintenance|cleanup|nightly|schedul)/i },
  { label: "Governance", keywords: /\b(govern|polic|complian|audit|standard)/i },
];

const FALLBACK_LABEL = "Other automation";

function classify(graph: WorkflowGraph): string {
  const haystack = `${graph.name} ${graph.sourcePath}`;
  for (const rule of FAMILY_RULES) {
    if (rule.keywords.test(haystack)) return rule.label;
  }
  return FALLBACK_LABEL;
}

// Most-complex tiebreak, falling through to id order (alphabetical, already
// deterministic) as the final fallback.
function mostComplex(graphs: WorkflowGraph[]): WorkflowGraph {
  return [...graphs].sort((a, b) => b.nodes.length - a.nodes.length || a.id.localeCompare(b.id))[0];
}

/**
 * Picks the one workflow within a family that best represents it on a
 * supplementary workflow-diagram scene, in priority order:
 *  1. Has an approval gate — the most narratively important shape (a human
 *     decision point) beats plain automation.
 *  2. Is a reusable (workflow_call) workflow — likely the shared building
 *     block other workflows in the family compose.
 *  3. Most complex graph (most nodes) — most representative of what the
 *     family actually does.
 *  4. First alphabetically by id — deterministic final tiebreak.
 * (The spec's literal "widely referenced reusable workflow" criterion would
 * need cross-graph reference counting, which is out of scope for this pass;
 * "is reusable at all" is used as a generic approximation — see final report.)
 */
function pickRepresentative(members: WorkflowGraph[]): string | undefined {
  if (members.length === 0) return undefined;
  const withApproval = members.filter((g) => g.nodes.some((n) => n.type === "approval"));
  if (withApproval.length > 0) return mostComplex(withApproval).id;
  const reusable = members.filter((g) => g.triggers.some((t) => t.name === "workflow_call"));
  if (reusable.length > 0) return mostComplex(reusable).id;
  return mostComplex(members).id;
}

/**
 * Groups WorkflowGraphs into named families by deterministic keyword
 * classification over each workflow's name/source path. This raises the
 * abstraction level (65 workflows -> ~10 families) without inventing any
 * relationship that isn't backed by the workflow's own file evidence.
 */
export function buildWorkflowFamilies(graphs: WorkflowGraph[]): WorkflowFamily[] {
  const byLabel = new Map<string, WorkflowGraph[]>();
  for (const graph of [...graphs].sort((a, b) => a.id.localeCompare(b.id))) {
    const label = classify(graph);
    const bucket = byLabel.get(label) ?? [];
    bucket.push(graph);
    byLabel.set(label, bucket);
  }

  const families: WorkflowFamily[] = [];
  for (const [label, members] of [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const evidence = members.map((g) => ({ path: g.sourcePath }));
    const isFallback = label === FALLBACK_LABEL;
    families.push({
      id: workflowFamilyId(label),
      label: normalizeLabel(label),
      description: isFallback
        ? derived(`${members.length} workflow${members.length === 1 ? "" : "s"} that did not match a named automation family.`, evidence, "No keyword rule matched these workflow names/paths.")
        : confirmed(`${members.length} workflow${members.length === 1 ? "" : "s"} covering ${label.toLowerCase()}.`, evidence),
      workflowGraphIds: members.map((g) => g.id),
      representativeWorkflowGraphId: pickRepresentative(members),
    });
  }
  return families;
}
