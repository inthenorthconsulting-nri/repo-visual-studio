import type { RepositoryModel } from "@rvs/repository-model";
import { confirmed, derived, unresolved } from "../inference.js";
import { systemIdentityId } from "../ids.js";
import { normalizeLabel } from "../label.js";
import { compressToAtomicClaim } from "../text.js";
import type { NormalizedLabel, PurposeModel, SystemIdentity } from "../types.js";

const LIMITATION_HEADING = /limitation|out of scope|not (yet )?support|non-goal/i;
const AUDIENCE_HEADING = /audience|who (is|it'?s) for|target user|use case/i;

function readmeDocument(model: RepositoryModel) {
  return model.markdown_documents.find((doc) => /(^|\/)readme\.md$/i.test(doc.path));
}

function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+/g, " ").trim();
}

// A README H1 is only worth preferring over the raw repo slug when it says
// something the slug doesn't already say — otherwise "Repo Visual Studio"
// (from a slug "repo-visual-studio") is not a better name, just a reformat.
function isDistinctiveReadmeTitle(title: string | undefined, projectName: string): title is string {
  if (!title) return false;
  // markdown-adapter falls back to the document's file path as `title` when
  // no H1 heading is present — that's not a product name, it's a path.
  if (title.includes("/") || /\.md$/i.test(title)) return false;
  const normalizedTitle = normalizeForComparison(title);
  if (normalizedTitle.length === 0) return false;
  if (normalizedTitle === "readme") return false;
  if (normalizedTitle === normalizeForComparison(projectName)) return false;
  return true;
}

/**
 * System display name has two possible sources of evidence, tried in order:
 *  1. The README's H1 title, when it says something the raw repo slug
 *     doesn't already say (e.g. a product name distinct from the git repo
 *     name).
 *  2. The raw repo slug (existing behavior), title-cased.
 * This is deliberately generic — no repository-specific vocabulary — and
 * config-file overrides / non-README product metadata are out of scope for
 * this pass (see Milestone 3.1 final report).
 */
function resolveDisplayName(model: RepositoryModel, readme: ReturnType<typeof readmeDocument>): { label: NormalizedLabel; evidence: { path: string }[] } {
  if (isDistinctiveReadmeTitle(readme?.title, model.project_name)) {
    return {
      label: { ...normalizeLabel(readme!.title), basis: "readme-title" },
      evidence: [{ path: readme!.path }],
    };
  }
  return { label: normalizeLabel(model.project_name), evidence: [] };
}

export function buildSystemIdentity(model: RepositoryModel): SystemIdentity {
  const readme = readmeDocument(model);
  const description = readme?.leadParagraph?.trim();
  const manifestDescription = model.tech_stack.manifestDescription;
  const isMonorepo = model.files.sampledPaths.some((p) => /pnpm-workspace\.ya?ml|lerna\.json/i.test(p));
  const { label: name, evidence: nameEvidence } = resolveDisplayName(model, readme);

  const oneLineDescription = description
    ? confirmed(compressToAtomicClaim(description, 50), [{ path: readme!.path }])
    : manifestDescription
      ? derived(compressToAtomicClaim(manifestDescription, 50), [{ path: model.tech_stack.manifestFile ?? "package.json" }], "No README lead paragraph found; fell back to the package manifest's description field.")
      : unresolved(`${model.project_name} — no README lead paragraph or package manifest description found to summarize purpose.`, "No README.md with a lead paragraph and no package manifest description were found in the scanned sources.");

  const identityEvidence = readme ? [{ path: readme.path }, ...nameEvidence.filter((e) => e.path !== readme.path)] : nameEvidence;

  return {
    id: systemIdentityId(model.project_name),
    name,
    oneLineDescription,
    primaryLanguage: model.tech_stack.primaryLanguage,
    repositoryKind: isMonorepo ? "monorepo" : model.tech_stack.frameworks.length === 0 && model.ci_workflows.length === 0 ? "library" : "single-service",
    evidence: identityEvidence,
  };
}

export function buildPurposeModel(model: RepositoryModel): PurposeModel {
  const readme = readmeDocument(model);

  const problemStatement = readme?.leadParagraph
    ? confirmed(compressToAtomicClaim(readme.leadParagraph.trim(), 50), [{ path: readme.path }])
    : unresolved("No stated problem/purpose found in repository documentation.", "No README lead paragraph available.");

  const targetUsers: PurposeModel["targetUsers"] = [];
  const scopeBoundaries: PurposeModel["scopeBoundaries"] = [];

  for (const doc of model.markdown_documents) {
    for (const section of doc.sections) {
      const lineRange = `${section.startLine}-${section.endLine}`;
      if (AUDIENCE_HEADING.test(section.heading) && section.text.trim().length > 0) {
        targetUsers.push(derived(compressToAtomicClaim(section.text.trim(), 40), [{ path: doc.path, lines: lineRange }], `Derived from documentation section "${section.heading}".`));
      }
      if (LIMITATION_HEADING.test(section.heading) && section.text.trim().length > 0) {
        scopeBoundaries.push(confirmed(compressToAtomicClaim(section.text.trim(), 40), [{ path: doc.path, lines: lineRange }]));
      }
    }
  }

  if (targetUsers.length === 0) {
    targetUsers.push(unresolved("Target users are not explicitly documented.", "No audience/use-case section found in repository documentation."));
  }

  return { problemStatement, targetUsers, scopeBoundaries };
}
