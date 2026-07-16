import { redactSecrets, type EvidenceClaim, type EvidenceManifest, type EvidenceSource } from "@rvs/core";
import type { RepositoryModel } from "./repository-model.js";

const MAX_SECTION_CLAIMS = 40;
const MAX_CLAIM_TEXT_LENGTH = 220;

function nextId(counter: { n: number }): string {
  counter.n += 1;
  return `claim-${String(counter.n).padStart(3, "0")}`;
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function buildEvidenceManifest(model: RepositoryModel): EvidenceManifest {
  const counter = { n: 0 };
  const claims: EvidenceClaim[] = [];

  outer: for (const doc of model.markdown_documents) {
    for (const section of doc.sections) {
      if (!section.text) continue;
      if (claims.length >= MAX_SECTION_CLAIMS) break outer;

      const { text: redacted } = redactSecrets(section.text);
      const source: EvidenceSource = {
        path: doc.path,
        lines: `${section.startLine}-${section.endLine}`,
      };
      claims.push({
        claim_id: nextId(counter),
        claim: truncate(`${section.heading}: ${redacted}`, MAX_CLAIM_TEXT_LENGTH),
        sources: [source],
        confidence: "confirmed",
      });
    }
  }

  if (model.tech_stack.primaryLanguage !== "unknown") {
    const sources: EvidenceSource[] = model.tech_stack.manifestFile
      ? [{ path: model.tech_stack.manifestFile }]
      : [{ path: "." }];
    claims.push({
      claim_id: nextId(counter),
      claim: `Primary language is ${model.tech_stack.primaryLanguage}${
        model.tech_stack.frameworks.length ? ` (using ${model.tech_stack.frameworks.join(", ")})` : ""
      }`,
      sources,
      confidence: model.tech_stack.manifestFile ? "confirmed" : "inferred",
    });
  }

  if (model.ci_workflows.length > 0) {
    claims.push({
      claim_id: nextId(counter),
      claim: `Continuous integration is configured via ${model.ci_workflows.length} GitHub Actions workflow file(s)`,
      sources: model.ci_workflows.map((w) => ({ path: w.path })),
      confidence: "confirmed",
    });
  }

  claims.push({
    claim_id: nextId(counter),
    claim: `Repository contains ${model.files.total} tracked file(s) across ${Object.keys(model.files.byExtension).length} file type(s)`,
    sources: [{ path: "." }],
    confidence: "confirmed",
  });

  claims.push({
    claim_id: nextId(counter),
    claim: `Development activity: ${model.git.commitsLast90Days} commit(s) in the last 90 days across ${model.git.contributorCount} contributor(s)`,
    sources: [{ path: "." }],
    confidence: "confirmed",
  });

  return {
    generated_at: model.generated_at,
    git_commit: model.git.commit,
    claims,
  };
}
