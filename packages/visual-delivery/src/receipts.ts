import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PromotionStatus,
  VerificationStatus,
  VerifiedVisualArtifact,
  VisualDeliveryCandidate,
  VisualDeliveryFinding,
  VisualRepairReceipt,
  VisualVerificationResult,
} from "./contracts.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION } from "./contracts.js";
import { buildReceiptId } from "./ids.js";
import { sortDeliveryFindings } from "./verification.js";
import { repoRelative } from "./security.js";

// The repair receipt.
//
// A rejected candidate is not an error; it is a measurement with a result, and
// the result is worth reading. So this is not a stack trace and not a log. It
// names the invariant that was missed, the subject that missed it, what the
// rule required, and what class of change would satisfy it -- and it names
// what is still at the target, because the first question anyone asks after
// "why was it rejected" is "what is the reader looking at now".
//
// Nothing here executes a repair, schedules one, or regenerates anything.

export const RECEIPT_FILE = "repair-receipt.json";
export const RECEIPT_MARKDOWN_FILE = "repair-receipt.md";
export const VERIFICATION_REPORT_FILE = "visual-verification-report.json";

export interface BuildReceiptInput {
  repoRoot: string;
  result: VisualVerificationResult;
  candidate: VisualDeliveryCandidate;
  target_preserved: boolean;
  target_digest: string | null;
  last_known_good: VerifiedVisualArtifact | null;
}

export function buildRepairReceipt(input: BuildReceiptInput): VisualRepairReceipt {
  const findings = sortDeliveryFindings(input.result.findings);
  return {
    receipt_id: buildReceiptId(
      input.candidate.candidate_id,
      findings.map((f) => f.finding_id),
    ),
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    candidate_id: input.candidate.candidate_id,
    verification_status: input.result.status,
    findings,
    target_preserved: input.target_preserved,
    last_known_good_id: input.last_known_good?.verified_artifact_id ?? null,
    candidate_digest: input.candidate.artifact_digest,
    target_digest: input.target_digest,
    generation_metadata: {
      ...input.candidate.metadata,
      generation: input.candidate.generation,
      run_id: input.candidate.run_id,
    },
    candidate_path: input.candidate.source_path,
    profile_id: input.result.profile.id,
  };
}

/**
 * The verification report: everything a machine needs, in one file.
 *
 * Separate from the receipt because they answer different questions. The
 * report says what was run and what it concluded, pass or fail. The receipt
 * exists only when something did not promote, and says what to do about it.
 */
export interface VisualVerificationReport {
  schema_version: number;
  generated_at: string;
  candidate: VisualDeliveryCandidate;
  profile: VisualVerificationResult["profile"];
  validators: VisualVerificationResult["validator_summary"]["families"];
  status: VerificationStatus;
  findings: VisualDeliveryFinding[];
  verification_digest: string;
  target: { path: string; digest_before: string | null; digest_after: string | null };
  promotion_status: PromotionStatus;
  promotion_reason: string;
  last_known_good: VerifiedVisualArtifact | null;
  incomplete_reason?: string;
}

export interface BuildReportInput {
  result: VisualVerificationResult;
  generated_at: string;
  target_path: string;
  digest_before: string | null;
  digest_after: string | null;
  promotion_status: PromotionStatus;
  promotion_reason: string;
  last_known_good: VerifiedVisualArtifact | null;
}

export function buildVerificationReport(input: BuildReportInput): VisualVerificationReport {
  return {
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    generated_at: input.generated_at,
    candidate: input.result.candidate,
    profile: input.result.profile,
    validators: input.result.validator_summary.families,
    status: input.result.status,
    findings: sortDeliveryFindings(input.result.findings),
    verification_digest: input.result.verification_digest,
    target: { path: input.target_path, digest_before: input.digest_before, digest_after: input.digest_after },
    promotion_status: input.promotion_status,
    promotion_reason: input.promotion_reason,
    last_known_good: input.last_known_good,
    ...(input.result.incomplete_reason === undefined ? {} : { incomplete_reason: input.result.incomplete_reason }),
  };
}

/** Writes JSON through a temporary file so a crash cannot leave a half-written record. */
function writeJson(path: string, value: unknown): string {
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(partial, path);
  return path;
}

export function writeVerificationReport(
  repoRoot: string,
  directory: string,
  report: VisualVerificationReport,
): string {
  return repoRelative(repoRoot, writeJson(join(directory, VERIFICATION_REPORT_FILE), report));
}

export function writeRepairReceipt(
  repoRoot: string,
  directory: string,
  receipt: VisualRepairReceipt,
): { json: string; markdown: string } {
  const json = repoRelative(repoRoot, writeJson(join(directory, RECEIPT_FILE), receipt));
  const markdownPath = join(directory, RECEIPT_MARKDOWN_FILE);
  const partial = `${markdownPath}.partial`;
  writeFileSync(partial, receiptMarkdown(receipt));
  renameSync(partial, markdownPath);
  return { json, markdown: repoRelative(repoRoot, markdownPath) };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STATUS_HEADLINE: Readonly<Record<VerificationStatus, string>> = {
  passed: "Candidate verified",
  failed: "Candidate rejected",
  incomplete: "Verification incomplete",
  stale: "Verification stale",
};

/**
 * The console summary.
 *
 * Short on purpose. A person watching a command run needs the count, the worst
 * few findings, and the reassurance that nothing was lost; everything else is
 * in the JSON beside it, and printing the JSON to a terminal is how a receipt
 * stops being read.
 */
export function receiptConsoleSummary(receipt: VisualRepairReceipt, topN = 5): string[] {
  const blocking = receipt.findings.filter((f) => f.severity === "blocking");
  const lines: string[] = [];
  lines.push(
    `${STATUS_HEADLINE[receipt.verification_status]} — ${blocking.length} blocking finding${blocking.length === 1 ? "" : "s"} under ${receipt.profile_id}.`,
  );
  const top = (blocking.length > 0 ? blocking : receipt.findings).slice(0, topN);
  if (top.length > 0) lines.push("  Top findings:");
  for (const finding of top) {
    lines.push(`    - ${finding.code} · ${finding.subject_id}`);
    if (finding.supported_repairs.length > 0) {
      lines.push(`      Repairs that could satisfy it: ${finding.supported_repairs.join(", ")}.`);
    }
  }
  const remaining = (blocking.length > 0 ? blocking.length : receipt.findings.length) - top.length;
  if (remaining > 0) lines.push(`    … and ${remaining} more in the receipt.`);
  return lines;
}

/**
 * The same receipt as Markdown.
 *
 * Optional by the specification and written anyway, because the JSON is what a
 * tool reads and this is what a person pastes into the pull request that has
 * to explain why the picture did not change.
 */
export function receiptMarkdown(receipt: VisualRepairReceipt): string {
  const blocking = receipt.findings.filter((f) => f.severity === "blocking");
  const warnings = receipt.findings.filter((f) => f.severity === "warning");
  const lines: string[] = [];

  lines.push(`# ${STATUS_HEADLINE[receipt.verification_status]}`);
  lines.push("");
  lines.push(`- Receipt: \`${receipt.receipt_id}\``);
  lines.push(`- Candidate: \`${receipt.candidate_id}\` (generation ${receipt.generation_metadata.generation}, ${receipt.generation_metadata.run_id})`);
  lines.push(`- Profile: \`${receipt.profile_id}\``);
  lines.push(`- Candidate digest: \`${receipt.candidate_digest}\``);
  lines.push(
    `- Target digest: ${receipt.target_digest === null ? "_no artifact at the target_" : `\`${receipt.target_digest}\``}`,
  );
  lines.push(
    `- Target preserved: ${receipt.target_preserved ? "yes — the existing artifact is byte-for-byte what it was" : "no"}`,
  );
  lines.push(
    `- Last known good: ${receipt.last_known_good_id === null ? "_none has ever been verified at this target_" : `\`${receipt.last_known_good_id}\``}`,
  );
  lines.push(`- Rejected candidate left at: \`${receipt.candidate_path}\``);
  lines.push("");

  const section = (title: string, findings: readonly VisualDeliveryFinding[]): void => {
    if (findings.length === 0) return;
    lines.push(`## ${title}`);
    lines.push("");
    for (const finding of findings) {
      lines.push(`### \`${finding.code}\` — ${finding.subject_id}`);
      lines.push("");
      lines.push(finding.message);
      lines.push("");
      lines.push(`- Family: ${finding.family}`);
      lines.push(`- Validator: \`${finding.validator}\``);
      lines.push(`- Subject type: ${finding.subject_type}`);
      if (finding.measured_value !== undefined) lines.push(`- Measured: ${finding.measured_value}`);
      if (finding.required_value !== undefined) lines.push(`- Required: ${finding.required_value}`);
      if (finding.evidence_refs.length > 0) lines.push(`- Evidence: ${finding.evidence_refs.map((r) => `\`${r}\``).join(", ")}`);
      lines.push(
        finding.supported_repairs.length > 0
          ? `- Repairs that could satisfy it: ${finding.supported_repairs.join(", ")}`
          : `- No repair category applies; the message above states the invariant.`,
      );
      lines.push("");
    }
  };

  section("Blocking", blocking);
  section("Warnings", warnings);

  if (receipt.findings.length === 0) {
    lines.push("No findings were recorded. The candidate did not promote for the reason stated above.");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "Nothing in this receipt has been applied. Repair categories describe the kind of correction that would satisfy an invariant; choosing and making the change is a separate, separately authorised task.",
  );
  lines.push("");
  return lines.join("\n");
}
