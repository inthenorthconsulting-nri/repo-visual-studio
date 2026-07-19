import type { ArchitectureIntelligence, LogicalComponent, WorkflowFamily } from "@rvs/architecture-intelligence";
import { normalizeLabel } from "@rvs/architecture-intelligence";
import type { MarkdownSection, ParsedMarkdownDocument, RepositoryModel } from "@rvs/repository-model";
import type { TerraformTopology } from "@rvs/terraform-graph";
import type { WorkflowGraph, WorkflowNode } from "@rvs/workflow-graph";
import { CAPABILITY_EVIDENCE_STRENGTH, INCOMPLETE_CAPABILITY_SIGNAL_KEYWORDS } from "./contracts.js";
import type { CapabilityCandidate, CapabilityEvidence, CapabilityEvidenceType } from "./contracts.js";
import { capabilityEvidenceId, capabilityId } from "./ids.js";

/**
 * Candidate discovery draws on every evidence category the spec lists that
 * this repository can actually observe deterministically: Architecture
 * Intelligence's workflow families (executable automation) and components
 * (CLI/runtime entrypoints, Terraform-provisioned infrastructure), plus raw
 * README/markdown sections (documentation-only or roadmap claims). It never
 * treats a raw directory name as a final capability name, and it never
 * decides inclusion — that is evidence.ts/maturity.ts/readiness.ts/
 * inclusion-policy.ts's job. A candidate found here is not yet a capability.
 */
export interface DiscoverCapabilityCandidatesInput {
  architecture: ArchitectureIntelligence;
  model: RepositoryModel;
  workflowGraphs: WorkflowGraph[];
  terraformTopologies: TerraformTopology[];
}

function matchIncompleteSignals(...texts: string[]): string[] {
  const haystack = texts.join(" ").toLowerCase();
  return INCOMPLETE_CAPABILITY_SIGNAL_KEYWORDS.filter((kw) => haystack.includes(kw));
}

/**
 * Structural test signals, matched only against real, already-scanned data
 * (file paths under a component, workflow step labels) — never fabricated.
 * Word-bounded so paths like "latest/" or step labels like "Attestation"
 * don't false-positive on a bare "test" substring.
 */
const TEST_PATH_PATTERN = /(\.(test|spec)\.[cm]?[jt]sx?$)|(?:^|\/)(__tests__|tests?)\//i;
const TEST_STEP_LABEL_PATTERN = /\btests?\b|\bspecs?\b|\bvitest\b|\bjest\b|\bpytest\b|\bmocha\b/i;

/**
 * Generic, structural signal that a heading — or its nearest enclosing
 * heading — reads as part of a retrospective engineering-report/changelog
 * document (a milestone log, a sprint/status report, a changelog, or a "we
 * proved self-hosting and found N defects" writeup) rather than product or
 * feature documentation a user of the scanned repository would recognize as
 * a capability. These are common documentation conventions across many
 * real-world repositories' docs/ directories (see e.g. any project with a
 * CHANGELOG.md, sprint retros, or postmortems) — never keyed to any single
 * repository's own filenames or vocabulary.
 */
const REPORT_NARRATIVE_HEADING_PATTERN =
  /^(changelog|change log|release notes|milestone\s+\d+(?:\.\d+)*|sprint\s+\d+|retrospective|status report|progress report|post-?mortem)\b|\bself-hosting\s+(?:proof|report|writeup|walkthrough)\b|\bdefects?\s+found(?:\s+and\s+fixed)?\b/i;

/**
 * A heading that is itself just a numbered-outline marker ("2. Defects
 * found and fixed", "13. Remaining limitations") reads as a formal
 * spec/report section number rather than a product capability name. Some
 * legitimate product docs also number their sections, though, so this is
 * never treated as a report signal on its own — only when corroborated by
 * document-level evidence (documentReadsAsEngineeringReport()) that the
 * containing document is, on the whole, a report-style document.
 */
const NUMBERED_OUTLINE_HEADING_PATTERN = /^\d+(?:\.\d+)*[.)]\s+\S/;

/** Whole-document corroborating signal: does this document contain at least one heading that itself reads as report/changelog narrative? Used only to license the weaker numbered-outline signal below — a document with no report-vocabulary heading anywhere never has its numbered sections suppressed just for being numbered. */
function documentReadsAsEngineeringReport(doc: ParsedMarkdownDocument): boolean {
  return doc.sections.some((s) => REPORT_NARRATIVE_HEADING_PATTERN.test(s.heading.trim()));
}

/**
 * Nearest preceding heading of shallower depth for each section, recovered
 * from the already-ordered, already-depth-tagged MarkdownSection[] the
 * adapter produces (depth 2/3 only, in document order — see
 * markdown-adapter.ts's extractSections()). No adapter change or extra
 * field is needed: ancestry is fully reconstructable from depth + position
 * alone, since a depth-3 section always follows the nearest preceding
 * depth-2 section in document order.
 */
function nearestAncestorHeadings(sections: MarkdownSection[]): (string | undefined)[] {
  const ancestors: (string | undefined)[] = [];
  let currentH2: string | undefined;
  for (const section of sections) {
    if (section.depth <= 2) {
      ancestors.push(undefined);
      currentH2 = section.heading;
    } else {
      ancestors.push(currentH2);
    }
  }
  return ancestors;
}

/**
 * A section is discovery-time noise from the tool's own construction
 * narrative — not a candidate at all, regardless of what its text otherwise
 * matches — when its own heading, or its nearest enclosing heading, reads
 * as report/changelog narrative, or (only when the containing document as a
 * whole already reads as a report) its heading is a bare numbered-outline
 * marker. This is deliberately conservative in the other direction: a plain
 * product-documentation heading like "## Authentication" or "## Deployment"
 * matches none of this and is untouched.
 */
function isReportNarrativeSection(section: MarkdownSection, ancestorHeading: string | undefined, docIsReport: boolean): boolean {
  const heading = section.heading.trim();
  if (REPORT_NARRATIVE_HEADING_PATTERN.test(heading)) return true;
  if (ancestorHeading && REPORT_NARRATIVE_HEADING_PATTERN.test(ancestorHeading.trim())) return true;
  if (docIsReport && NUMBERED_OUTLINE_HEADING_PATTERN.test(heading)) return true;
  return false;
}

function workflowGraphConfidence(confidence: WorkflowNode["confidence"]): CapabilityEvidence["confidence"] {
  return confidence === "confirmed" ? "confirmed" : "derived";
}

function evidence(type: CapabilityEvidenceType, sourceLabel: string, sourcePath: string, index: number, description: string, confidence: CapabilityEvidence["confidence"], strengthOverride?: number): CapabilityEvidence {
  return {
    id: capabilityEvidenceId(sourceLabel, sourcePath, index),
    type,
    sourcePath,
    description,
    strength: strengthOverride ?? CAPABILITY_EVIDENCE_STRENGTH[type],
    confidence,
  };
}

function domainHintForWorkflowFamily(architecture: ArchitectureIntelligence, family: WorkflowFamily): string {
  const owner = architecture.capabilityDomains.find((d) => d.workflowFamilyIds.includes(family.id));
  return owner?.label.displayLabel ?? family.label.displayLabel;
}

function domainHintForComponent(architecture: ArchitectureIntelligence, component: LogicalComponent): string {
  const owner = architecture.capabilityDomains.find((d) => d.componentIds.includes(component.id));
  return owner?.label.displayLabel ?? "General automation";
}

/** Workflow families are the strongest available candidate source: each one is backed by real, parsed, executable GitHub Actions workflows. */
function candidatesFromWorkflowFamilies(architecture: ArchitectureIntelligence, workflowGraphs: WorkflowGraph[]): CapabilityCandidate[] {
  const graphsById = new Map(workflowGraphs.map((g) => [g.id, g]));

  return architecture.workflowFamilies.map((family) => {
    const graphs = family.workflowGraphIds.map((id) => graphsById.get(id)).filter((g): g is WorkflowGraph => Boolean(g));
    const ev: CapabilityEvidence[] = graphs.map((graph, i) =>
      evidence("workflow", family.label.sourceLabel, graph.sourcePath, i, `Executable GitHub Actions workflow "${graph.name}".`, "confirmed"),
    );

    const disabledOrDeprecated = graphs.filter((g) => /disabled|deprecated|archive/i.test(g.name) || /disabled|deprecated|archive/i.test(g.sourcePath));
    for (const [i, graph] of disabledOrDeprecated.entries()) {
      ev.push(evidence("deprecated_marker", family.label.sourceLabel, graph.sourcePath, 1000 + i, `Workflow name/path suggests it is disabled or deprecated: "${graph.name}".`, "suggested"));
    }

    // Each workflow file is real, checked-in implementation of the
    // automation it defines — distinct in kind from the "workflow" evidence
    // above (which attests the automation is triggerable/executable).
    for (const [i, graph] of graphs.entries()) {
      ev.push(evidence("implementation", family.label.sourceLabel, graph.sourcePath, 2000 + i, `Workflow definition implementing "${family.label.displayLabel}".`, "confirmed"));
    }

    // A workflow step whose label reads as a test invocation is real,
    // already-parsed evidence of verification — not inferred, not guessed.
    for (const [i, graph] of graphs.entries()) {
      const testStep = graph.nodes.find((n: WorkflowNode) => n.type === "step" && TEST_STEP_LABEL_PATTERN.test(n.label));
      if (!testStep) continue;
      const testStepPath = testStep.evidence[0]?.path ?? graph.sourcePath;
      ev.push(evidence("test", family.label.sourceLabel, testStepPath, 3000 + i, `Workflow step "${testStep.label}" runs tests for "${family.label.displayLabel}".`, workflowGraphConfidence(testStep.confidence)));
    }

    if (family.representativeWorkflowGraphId) {
      const rep = graphsById.get(family.representativeWorkflowGraphId);
      if (rep) ev.push(evidence("runtime_entrypoint", family.label.sourceLabel, rep.sourcePath, 900, `Representative, triggerable entrypoint for the "${family.label.displayLabel}" family.`, "confirmed"));
    }

    const components = architecture.components.filter((c) => c.implementation.workflowGraphIds.length > 0 && family.workflowGraphIds.every((id) => c.implementation.workflowGraphIds.includes(id)));

    const candidate: CapabilityCandidate = {
      id: capabilityId(`workflow-family:${family.label.sourceLabel}`),
      sourceLabel: family.label.sourceLabel,
      naming: normalizeLabel(family.label.sourceLabel),
      granularity: "capability",
      domainHint: domainHintForWorkflowFamily(architecture, family),
      purpose: family.description,
      actors: [],
      workflows: family.workflowGraphIds,
      logicalComponents: components.map((c) => c.id),
      externalSystems: [],
      evidence: ev,
      matchedIncompleteSignals: matchIncompleteSignals(family.label.sourceLabel, family.description.value),
      isExternalRuntimeDependent: false,
      evidenceReferences: [...family.description.evidence],
    };
    return candidate;
  });
}

/** Public CLI / runtime-entrypoint components are a direct, strong candidate source independent of workflow-family grouping. */
function candidatesFromRuntimeComponents(architecture: ArchitectureIntelligence): CapabilityCandidate[] {
  return architecture.components
    .filter((c) => c.kind === "cli" || c.kind === "service")
    .map((component, componentIndex) => {
      const entrypointPath = component.sourcePaths[0] ?? component.label.sourceLabel;
      // component.sourcePaths are the real, already-scanned files backing this
      // component (see architecture-intelligence/src/synthesize/components.ts).
      // The first is already used above as the runtime entrypoint; the rest are
      // genuine implementation evidence, split from genuine test evidence by
      // filename convention — nothing here is inferred beyond what was scanned.
      const remainingPaths = component.sourcePaths.slice(1);
      const testPaths = remainingPaths.filter((p) => TEST_PATH_PATTERN.test(p)).slice(0, 5);
      const implementationPaths = remainingPaths.filter((p) => !TEST_PATH_PATTERN.test(p)).slice(0, 8);

      const ev: CapabilityEvidence[] = [
        evidence("runtime_entrypoint", component.label.sourceLabel, entrypointPath, 0, `${component.kind === "cli" ? "CLI" : "Service"} runtime entrypoint "${component.label.displayLabel}".`, component.description.inference),
        ...component.implementation.entryPoints.map((entry, i) => evidence("implementation", component.label.sourceLabel, entry, i + 1, `Implementation entry point for "${component.label.displayLabel}".`, "confirmed")),
        ...implementationPaths.map((p, i) => evidence("implementation", component.label.sourceLabel, p, 100 + i, `Source file backing "${component.label.displayLabel}".`, "confirmed")),
        ...testPaths.map((p, i) => evidence("test", component.label.sourceLabel, p, 200 + i, `Test file covering "${component.label.displayLabel}".`, "confirmed")),
      ];
      return {
        id: capabilityId(`component:${component.label.sourceLabel}:${componentIndex}`),
        sourceLabel: component.label.sourceLabel,
        naming: component.label,
        granularity: "capability" as const,
        domainHint: domainHintForComponent(architecture, component),
        purpose: component.description,
        actors: [],
        workflows: component.implementation.workflowGraphIds,
        logicalComponents: [component.id],
        externalSystems: [],
        evidence: ev,
        matchedIncompleteSignals: matchIncompleteSignals(component.label.sourceLabel, component.description.value),
        isExternalRuntimeDependent: false,
        evidenceReferences: component.evidence,
      };
    });
}

/** Terraform-provisioned infrastructure is deployment-category evidence for an "infrastructure and platform" style capability, kept separate so it never gets silently folded into an unrelated automation domain. */
function candidatesFromTerraform(architecture: ArchitectureIntelligence, terraformTopologies: TerraformTopology[]): CapabilityCandidate[] {
  if (terraformTopologies.length === 0) return [];
  return architecture.components
    .filter((c) => c.origin === "terraform-module")
    .map((component, i) => {
      const modulePath = component.sourcePaths[0] ?? component.label.sourceLabel;
      const ev: CapabilityEvidence[] = [
        evidence("deployment", component.label.sourceLabel, modulePath, 0, `Terraform-provisioned infrastructure module "${component.label.displayLabel}".`, "confirmed"),
        // The root module path is real configuration-as-code, distinct in
        // kind from "deployment" evidence (which attests the module is
        // actually provisioned rather than merely declared).
        evidence("configuration", component.label.sourceLabel, modulePath, 1, `Terraform configuration defining "${component.label.displayLabel}".`, "confirmed"),
      ];
      return {
        id: capabilityId(`terraform:${component.label.sourceLabel}:${i}`),
        sourceLabel: component.label.sourceLabel,
        naming: component.label,
        granularity: "capability" as const,
        domainHint: domainHintForComponent(architecture, component),
        purpose: component.description,
        actors: [],
        workflows: [],
        logicalComponents: [component.id],
        externalSystems: [],
        evidence: ev,
        matchedIncompleteSignals: [],
        isExternalRuntimeDependent: true,
        evidenceReferences: component.evidence,
      };
    });
}

/**
 * README/markdown sections whose heading or body reads as a claim about
 * platform behavior. This is the sole documentation-only/roadmap-only
 * candidate source: a section with no structural (workflow/component)
 * backing elsewhere becomes a weak, evidence-thin candidate that the
 * maturity/inclusion stages will almost always exclude or route to
 * roadmap_only — by design, per §6's "documentation alone must never prove
 * implementation."
 *
 * Sections that read as retrospective engineering-report/changelog
 * narrative (see isReportNarrativeSection()) are skipped entirely at this
 * discovery stage — they are noise about the tool's own construction
 * process, not a claim about anything a user of the repository would
 * recognize as a capability, and letting them through would only be caught
 * later by the readiness/inclusion gates at the cost of drowning out real
 * candidates in the diagnostic dump.
 */
function candidatesFromDocumentation(model: RepositoryModel): CapabilityCandidate[] {
  const candidates: CapabilityCandidate[] = [];
  for (const doc of model.markdown_documents) {
    const docIsReport = documentReadsAsEngineeringReport(doc);
    const ancestors = nearestAncestorHeadings(doc.sections);
    for (const [i, section] of doc.sections.entries()) {
      if (isReportNarrativeSection(section, ancestors[i], docIsReport)) continue;
      const signals = matchIncompleteSignals(section.heading, section.text);
      const looksLikeCapabilityClaim = /^(support|manage|govern|automate|provide|enable|monitor|diagnose|migrate|deploy)/i.test(section.text.trim()) || signals.length > 0;
      if (!looksLikeCapabilityClaim) continue;

      const lines = `${section.startLine}-${section.endLine}`;
      candidates.push({
        id: capabilityId(`doc:${doc.path}:${section.heading}:${i}`),
        sourceLabel: section.heading,
        naming: normalizeLabel(section.heading),
        granularity: "capability",
        domainHint: "General automation",
        purpose: { value: section.text.slice(0, 240) || section.heading, inference: "suggested", evidence: [{ path: doc.path, lines }], rationale: `Derived from the "${section.heading}" section of ${doc.path}.` },
        actors: [],
        workflows: [],
        logicalComponents: [],
        externalSystems: [],
        evidence: [evidence("documentation", section.heading, doc.path, i, `Documentation claim in "${section.heading}" (${doc.path}).`, "suggested", section.text.length > 200 ? CAPABILITY_EVIDENCE_STRENGTH.documentation + 1 : CAPABILITY_EVIDENCE_STRENGTH.documentation)],
        matchedIncompleteSignals: signals,
        isExternalRuntimeDependent: false,
        evidenceReferences: [{ path: doc.path, lines }],
      });
    }
  }
  return candidates;
}

/**
 * The same underlying capability is often visible from more than one
 * evidence angle (a workflow-family grouping of its workflows, and a
 * separately-discovered CLI/service component that runs those same
 * workflows). Left alone this produces two near-identical candidates for
 * one real capability — merge rather than let both survive to become
 * duplicate capabilities later. Two candidates merge when they share at
 * least one workflow id AND at least one logical-component id (both
 * non-empty overlap is required so two genuinely distinct, evidence-light
 * candidates never get merged just because both happen to have an empty
 * workflows list).
 */
function mergeDuplicateCandidates(candidates: CapabilityCandidate[]): CapabilityCandidate[] {
  const merged: CapabilityCandidate[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < candidates.length; i += 1) {
    if (consumed.has(i)) continue;
    let base = candidates[i];
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (consumed.has(j)) continue;
      const other = candidates[j];
      const sharesWorkflow = base.workflows.length > 0 && other.workflows.length > 0 && base.workflows.some((w) => other.workflows.includes(w));
      const sharesComponent = base.logicalComponents.length > 0 && other.logicalComponents.length > 0 && base.logicalComponents.some((c) => other.logicalComponents.includes(c));
      if (!sharesWorkflow || !sharesComponent) continue;

      consumed.add(j);
      base = {
        ...base,
        actors: [...new Set([...base.actors, ...other.actors])],
        workflows: [...new Set([...base.workflows, ...other.workflows])],
        logicalComponents: [...new Set([...base.logicalComponents, ...other.logicalComponents])],
        externalSystems: [...new Set([...base.externalSystems, ...other.externalSystems])],
        evidence: [...base.evidence, ...other.evidence],
        matchedIncompleteSignals: [...new Set([...base.matchedIncompleteSignals, ...other.matchedIncompleteSignals])],
        evidenceReferences: [...base.evidenceReferences, ...other.evidenceReferences],
      };
    }
    merged.push(base);
  }

  return merged;
}

export function discoverCapabilityCandidates(input: DiscoverCapabilityCandidatesInput): CapabilityCandidate[] {
  const { architecture, model, workflowGraphs, terraformTopologies } = input;
  const discovered = [
    ...candidatesFromWorkflowFamilies(architecture, workflowGraphs),
    ...candidatesFromRuntimeComponents(architecture),
    ...candidatesFromTerraform(architecture, terraformTopologies),
    ...candidatesFromDocumentation(model),
  ].sort((a, b) => a.id.localeCompare(b.id));

  return mergeDuplicateCandidates(discovered);
}
