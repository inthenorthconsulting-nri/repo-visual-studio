import type {
  DetailMode,
  VisualAudience,
  VisualEvidenceRef,
  VisualNode,
} from "@rvs/visual-intelligence";
import { digestOf } from "@rvs/visual-intelligence";
import type { GrammarStyle } from "@rvs/visual-grammar";
import { escapeAttribute, escapeText } from "@rvs/visual-grammar";
import type { ComposedDocument } from "@rvs/visual-composition";
import { composeVisualDocument } from "@rvs/visual-composition";
import {
  CHANGE_REVIEW_SCHEMA_VERSION,
  type ChangeReviewFinding,
  type ChangeReviewModel,
  type ReviewChange,
  type ReviewChangeType,
  type ReviewLens,
} from "./contracts.js";
import { buildChangeReviewId } from "./ids.js";
import { REVIEW_LENSES } from "./lenses.js";
import { DEFAULT_REVIEW_VIEW_STATE } from "./view-state.js";
import { REVIEW_RUNTIME } from "./runtime.js";
import { REVIEW_STYLES } from "./styles.js";
import type { ReviewAssembly } from "./source.js";
import { validateChangeReview } from "./validation.js";

// Assembling the change-review artifact.
//
// It is one file. Not "one file plus a stylesheet", not "one file that pulls a
// library": a single self-contained document that opens from a filesystem with
// the network unplugged and behaves identically. That constraint is what makes
// it something a reviewer can attach to a pull request, keep for six months,
// and reopen without a build.
//
// The security posture, stated once:
//
//   * No external origin is referenced. A `Content-Security-Policy` meta tag
//     says so, and a test asserts no absolute URL of any kind appears.
//   * Review content never becomes markup. Labels, summaries and change types
//     reach the page as JSON string values and are written with `textContent`;
//     nothing is concatenated into HTML. The viewer does not execute source
//     data.
//   * Evidence references are rendered as text, never as links, and the page
//     never re-reads a source file. Everything in the drawer was embedded when
//     the artifact was built.
//   * No absolute local path is written into the artifact, so it discloses
//     nothing about the machine that produced it.
//
// And what the artifact is *not*: it does not comment on a pull request, does
// not approve or block a merge, and takes no action of any kind. It is a
// document that explains a comparison somebody else computed.

/** Change types drawn with a glyph as well as a colour, so the distinction survives greyscale. */
const CHANGE_GLYPH: Record<ReviewChangeType, string> = {
  added: "+",
  removed: "−",
  modified: "~",
  rerouted: "↳",
  regressed: "↓",
  resolved: "✓",
  qualified: "?",
  unresolved: "…",
};

export interface ChangeReviewArtifactInput {
  producer: string;
  subject: string;
  assembly: ReviewAssembly;
  audience: string | VisualAudience;
  detail_mode: DetailMode;
  style?: GrammarStyle;
  /** The lens the page opens on. Emphasis only: every lens sees the same changes. */
  initial_lens?: ReviewLens;
  /**
   * `compare` (the default) or `none`.
   *
   * `none` is not a degraded mode. It produces the same review with the
   * comparison sweep removed, for a reader who wants a still document -- and
   * it is what `prefers-reduced-motion` already produces at runtime, so the
   * flag makes that state reachable deliberately rather than only by system
   * setting.
   */
  motion?: "none" | "compare";
  /** A short description of what the reader is looking at. Drawn as text. */
  caption?: string;
  /** Upstream artifact ids this review was read from, for the generation metadata. */
  source_artifact_ids?: readonly string[];
}

export interface ChangeReviewArtifact {
  html: string;
  /** Content digest of the artifact's inputs. Stable across runs; never a timestamp. */
  digest: string;
  model: ChangeReviewModel;
  document: ComposedDocument;
  findings: ChangeReviewFinding[];
  /** Entities the reader can reach: drawn in the review or in a detail view. */
  reachable_entity_ids: string[];
}

/**
 * An evidence reference as one line of text.
 *
 * Path and line range only, exactly as upstream recorded them, and only when
 * the path is repository-relative. An absolute path is dropped rather than
 * rewritten: rewriting it would be guessing at a repository root, and
 * embedding it would put the producer's filesystem into a file meant to be
 * shared.
 *
 * A path carrying a scheme -- `https:`, `file:`, anything -- is dropped for
 * the same reason and one more: evidence in this review is a place a reader
 * goes to check a claim in their own checkout. A remote address is not that,
 * and printing one inside a document that circulates on a pull request would
 * put an address somebody else chose in front of every reviewer.
 */
function evidenceLine(ref: VisualEvidenceRef): string | undefined {
  if (ref.path === undefined) return ref.detail;
  if (ref.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref.path)) return undefined;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref.path)) return undefined;
  return ref.lines === undefined ? ref.path : `${ref.path}:${ref.lines}`;
}

function evidenceLines(refs: readonly VisualEvidenceRef[]): string[] {
  return refs.map(evidenceLine).filter((l): l is string => l !== undefined);
}

/** The projection of a node the runtime needs. Deliberately small: what is not embedded cannot leak. */
function runtimeNode(node: VisualNode): Record<string, unknown> {
  return {
    id: node.id,
    entity: node.source_entity_id,
    label: node.label,
    kind: node.kind,
    emphasis: node.emphasis,
    resolution: node.resolution,
    confidence: node.confidence,
    ...(node.severity === undefined ? {} : { severity: node.severity }),
    ...(node.decision_status === undefined ? {} : { decision: node.decision_status }),
    evidence: node.evidence_refs.length,
    evidence_refs: evidenceLines(node.evidence_refs),
    ...(node.placeholder_for === undefined ? {} : { placeholder: true as const }),
  };
}

function runtimeChange(change: ReviewChange): Record<string, unknown> {
  return {
    id: change.id,
    type: change.change_type,
    entity: change.entity_id,
    entity_type: change.entity_type,
    summary: change.summary,
    before: change.before_entity_id ?? null,
    after: change.after_entity_id ?? null,
    evidence: evidenceLines(change.evidence_refs),
    capabilities: change.capability_ids,
    products: change.product_ids,
    decisions: change.decision_ids,
    findings: change.governance_finding_ids,
    paths: change.impact_path_ids,
    blast_radius: change.blast_radius,
    resolution: change.resolution_status,
    review_required: change.review_required,
  };
}

/**
 * JSON safe to sit inside a `<script>` element.
 *
 * `</script>` inside a string value would end the element and turn the rest of
 * the data into markup, so `<` is escaped at the source. U+2028/2029 are
 * escaped because they are line terminators to a JavaScript parser but not to
 * JSON, and a label containing one would otherwise be a syntax error rather
 * than a string.
 */
function jsonIsland(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const KEYBOARD_HELP: ReadonlyArray<readonly [string, string]> = [
  ["/", "Move to the search box"],
  ["Down arrow", "Move from the search box into the results"],
  ["1 - 6", "Switch lens, in the order the lenses are listed"],
  ["Tab / Shift+Tab", "Move between every control, change, and entity"],
  ["Enter or Space", "Select the change or entity under the cursor"],
  ["Escape", "Clear the selection and the search, and stop any sequence that is playing"],
  ["?", "Show or hide this help"],
];

/**
 * Builds the before / delta / after review.
 *
 * The drawing comes from `@rvs/visual-composition` unchanged -- the same
 * adaptation, the same detail views, the same fidelity receipt as any other
 * delivery surface. The grammar is not forced: a model carrying change facts
 * selects `delta` definitionally through the ordinary rule table, so the
 * review earns its grammar the same way every other view does. Motion is
 * declared as `compare`, which is the one thing this surface does state
 * explicitly, because the default motion for a change intent is `reveal` and
 * a review is not a reveal.
 */
export function buildChangeReviewArtifact(input: ChangeReviewArtifactInput): ChangeReviewArtifact {
  const { assembly } = input;
  const hasChanges = assembly.changes.length > 0;

  const document_ = composeVisualDocument({
    producer: input.producer,
    subject: input.subject,
    semantic_intent: "change",
    model: assembly.visual,
    audience: input.audience,
    detail_mode: input.detail_mode,
    format: "interactive",
    // Stated rather than defaulted: `defaultMotionIntent("change",
    // "interactive")` is `reveal`, and a review is not a reveal. A reveal
    // introduces something; a comparison holds two things side by side.
    motion_intent: input.motion ?? "compare",
    source_artifact_ids: input.source_artifact_ids,
    style: input.style,
  });

  const model: ChangeReviewModel = {
    id: buildChangeReviewId(assembly.from_snapshot_id, assembly.to_snapshot_id, assembly.input_digest),
    schema_version: CHANGE_REVIEW_SCHEMA_VERSION,
    from_snapshot_id: assembly.from_snapshot_id,
    to_snapshot_id: assembly.to_snapshot_id,
    compatibility: assembly.compatibility,
    before_entity_ids: assembly.before_entity_ids,
    after_entity_ids: assembly.after_entity_ids,
    changes: assembly.changes,
    governance_findings: assembly.governance_findings,
    decision_impacts: assembly.decision_impacts,
    confirmed_paths: assembly.confirmed_paths,
    unresolved_impacts: assembly.unresolved_impacts,
    review_required_ids: assembly.review_required_ids,
    visual_spec: document_.spec,
    fidelity_receipt: document_.receipt,
    generation_metadata: {
      schema_version: CHANGE_REVIEW_SCHEMA_VERSION,
      producer: input.producer,
      source_artifact_ids: [...(input.source_artifact_ids ?? [])].sort(),
      input_digest: assembly.input_digest,
      unavailable_domains: assembly.unavailable_domains,
    },
  };

  const views = [document_.primary, ...document_.details];
  const drawn = new Set(
    views.flatMap((v) =>
      v.audience.model.nodes.filter((n) => n.placeholder_for === undefined).map((n) => n.source_entity_id),
    ),
  );

  const findings = validateChangeReview({
    model,
    before_ids: assembly.before_ids,
    after_ids: assembly.after_ids,
    rendered_entity_ids: [...drawn].sort(),
    unsupported_change_types: assembly.unsupported_change_types,
    duplicate_change_ids: assembly.duplicate_change_ids,
  });

  const beforeSet = new Set(assembly.before_entity_ids);
  const afterSet = new Set(assembly.after_entity_ids);
  const runtimeModel = {
    // Carried so a plan built in the browser records the grammar the page
    // actually drew, exactly as `buildMotionPlan` does on this side.
    grammar: document_.spec.visual_grammar,
    nodes: views.flatMap((v) => v.audience.model.nodes.map(runtimeNode)),
    edges: views.flatMap((v) =>
      v.audience.model.edges.map((e) => ({ id: e.id, from: e.from_id, to: e.to_id, kind: e.kind })),
    ),
    entities: Object.fromEntries(
      assembly.visual.nodes.map((n) => [
        n.source_entity_id,
        { label: n.label, kind: n.kind, before: beforeSet.has(n.source_entity_id), after: afterSet.has(n.source_entity_id) },
      ]),
    ),
    changes: model.changes.map(runtimeChange),
    paths: model.confirmed_paths.map((p) => ({
      id: p.id,
      kind: p.kind,
      from_change: p.from_change_id,
      to: p.to_entity_id,
      entities: p.entity_ids,
      description: p.description,
    })),
    unresolved: model.unresolved_impacts.map((u) => ({
      id: u.id,
      change: u.change_id,
      statement: u.statement,
      boundary: u.boundary ?? null,
    })),
    lenses: REVIEW_LENSES.map((l) => ({ id: l.id, label: l.label, description: l.description, caveat: l.caveat })),
    glyphs: CHANGE_GLYPH,
  };

  const reachable = document_.coverage.primary_entity_ids.concat(document_.coverage.detail_entity_ids).sort();

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    // Everything this page needs is in this page. The policy says so, so a
    // future edit that reaches for a CDN fails in the browser rather than
    // silently making the artifact require a network.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'">`,
    `<title>${escapeText(input.subject)} — architecture change review</title>`,
    `<style>${REVIEW_STYLES}</style>`,
    `</head>`,
    // The scene contract @rvs/validator collects on; see the same declaration
    // in @rvs/visual-explorer's artifact for why it sits on the body and why
    // there is no `.scene-inner`. §64.
    `<body class="scene" data-scene-id="architecture-change-review" data-scene-type="change-review">`,
    header(input, model, document_),
    qualifications(model, findings),
    `<main class="rvs-layout">`,
    controls(model, input.initial_lens ?? DEFAULT_REVIEW_VIEW_STATE.lens),
    hasChanges ? stage(document_) : noChange(model),
    aside(),
    `</main>`,
    legend(),
    fidelity(document_),
    help(),
    `<script type="application/json" id="rvs-review">${jsonIsland(runtimeModel)}</script>`,
    `<script>${REVIEW_RUNTIME}</script>`,
    `</body>`,
    `</html>`,
  ].join("\n");

  return {
    html,
    // Digested from the inputs and the composed document rather than from the
    // markup, so a purely cosmetic change to the shell does not present itself
    // as a change to what the review says.
    digest: digestOf({
      subject: input.subject,
      review: model.id,
      audience: document_.spec.audience,
      detail_mode: document_.spec.detail_mode,
      spec: document_.spec.id,
      receipt: document_.receipt,
      coverage: document_.coverage,
      lens: input.initial_lens ?? DEFAULT_REVIEW_VIEW_STATE.lens,
      motion: input.motion ?? "compare",
      findings,
    }),
    model,
    document: document_,
    findings,
    reachable_entity_ids: reachable,
  };
}

function header(input: ChangeReviewArtifactInput, model: ChangeReviewModel, doc: ComposedDocument): string {
  const counts = doc.coverage;
  return [
    `<header class="rvs-header">`,
    `<h1>${escapeText(input.subject)}</h1>`,
    `<p class="rvs-caption">${escapeText(input.caption ?? "Before / delta / after architecture change review")}</p>`,
    `<p class="rvs-counts">${escapeText(model.from_snapshot_id)} → ${escapeText(model.to_snapshot_id)} · compatibility: ${escapeText(model.compatibility.status)}</p>`,
    `<p class="rvs-counts">${model.changes.length} changes · ${model.governance_findings.length} governance findings · ${model.decision_impacts.length} decision impacts · ${model.review_required_ids.length} marked for review upstream</p>`,
    `<p class="rvs-counts">${counts.source_entity_ids.length} entities · ${counts.primary_entity_ids.length} in the review · ${counts.detail_entity_ids.length} in detail views · ${counts.hidden_entity_ids.length} not drawn</p>`,
    `<p class="rvs-counts">Audience: ${escapeText(doc.spec.audience)} · Detail: ${escapeText(doc.spec.detail_mode)} · Grammar: ${escapeText(doc.spec.visual_grammar)} · Motion: ${escapeText(doc.spec.motion_intent)}</p>`,
    `<button type="button" id="rvs-help-toggle" aria-expanded="false" aria-controls="rvs-help">Keyboard help</button>`,
    `</header>`,
  ].join("");
}

/**
 * What this review cannot claim, said before the diagram rather than after it.
 *
 * A partial review that looks complete is worse than no review: the reader
 * acts on an absence they believe is a finding. So an uncomparable domain is
 * named, an incompatibility is named, and neither is allowed to read as "no
 * change here".
 */
function qualifications(model: ChangeReviewModel, findings: readonly ChangeReviewFinding[]): string {
  const lines: string[] = [];
  if (model.compatibility.status !== "compatible") {
    lines.push(
      `<p><strong>Compatibility: ${escapeText(model.compatibility.status)}.</strong> ${escapeText(
        model.compatibility.reasons.join(" "),
      )}</p>`,
    );
  }
  if (model.generation_metadata.unavailable_domains.length > 0) {
    lines.push(
      `<p>These domains could not be compared, so this review says nothing about them — which is not the same as saying nothing changed in them: ${escapeText(
        model.generation_metadata.unavailable_domains.join(", "),
      )}.</p>`,
    );
  }
  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length > 0) {
    lines.push(
      `<details open><summary>${errors.length} validation error(s)</summary><ul>${errors
        .map((f) => `<li>${escapeText(f.code)}: ${escapeText(f.message)}</li>`)
        .join("")}</ul></details>`,
    );
  }
  if (lines.length === 0) return "";
  return `<section class="rvs-notice" aria-label="What this review cannot claim"><h2>Qualifications</h2>${lines.join("")}</section>`;
}

function controls(model: ChangeReviewModel, lens: ReviewLens): string {
  return [
    `<section class="rvs-controls" aria-label="Review controls">`,
    `<label for="rvs-search">Search entities</label>`,
    `<input id="rvs-search" type="search" autocomplete="off" spellcheck="false" placeholder="Name or identifier">`,
    `<ul id="rvs-results" class="rvs-results" aria-label="Search results"></ul>`,
    `<label for="rvs-lens">Lens</label>`,
    `<select id="rvs-lens">`,
    REVIEW_LENSES.map(
      (l) =>
        `<option value="${escapeAttribute(l.id)}"${l.id === lens ? " selected" : ""} title="${escapeAttribute(l.description)}">${escapeText(l.label)}</option>`,
    ).join(""),
    `</select>`,
    `<p id="rvs-lens-caveat" class="rvs-empty"></p>`,
    // Motion is offered, never imposed. Nothing in the sequence is absent
    // from the list below it, so a reader who never presses this -- or whose
    // system asks for reduced motion -- has read the same review.
    `<button type="button" id="rvs-animate">Animate what changed</button>`,
    `<h2>Changes (${model.changes.length})</h2>`,
    `<ul id="rvs-change-list" class="rvs-results" aria-label="Changes"></ul>`,
    `<p id="rvs-status" class="rvs-status" role="status" aria-live="polite"></p>`,
    `</section>`,
  ].join("");
}

function stage(doc: ComposedDocument): string {
  const detail = doc.details
    .map(
      (view) =>
        `<section class="rvs-detail" aria-label="${escapeAttribute(view.display_label)}"><h2>${escapeText(view.display_label)}</h2>${view.render.svg}</section>`,
    )
    .join("");
  return [
    `<section id="rvs-stage" class="rvs-stage" aria-label="Before, delta and after states">`,
    `<h2>Before · Delta · After</h2>`,
    doc.primary.render.svg,
    detail,
    `</section>`,
  ].join("");
}

/**
 * The no-change state.
 *
 * Not an empty diagram. A change map with nothing on it looks exactly like a
 * change map that failed to load, and the reader has no way to tell which they
 * are looking at -- so this says, in words, that the comparison ran and found
 * nothing material.
 */
function noChange(model: ChangeReviewModel): string {
  return [
    `<section id="rvs-stage" class="rvs-stage" aria-label="Comparison result">`,
    `<h2>No material graph changes</h2>`,
    `<p>No material graph changes were detected between these compatible snapshots.</p>`,
    `<p class="rvs-counts">${model.before_entity_ids.length} entities in ${escapeText(model.from_snapshot_id)}, ${model.after_entity_ids.length} in ${escapeText(model.to_snapshot_id)}. The comparison ran and returned no change; this is a result, not a missing diagram.</p>`,
    `</section>`,
  ].join("");
}

function aside(): string {
  return [
    `<aside class="rvs-inspector" aria-label="Change inspector">`,
    `<div id="rvs-inspector" aria-live="polite"></div>`,
    `<div id="rvs-evidence" class="rvs-detail"></div>`,
    `</aside>`,
  ].join("");
}

/**
 * The legend, which is not decoration.
 *
 * The three route kinds are the whole of the causal story, and the difference
 * between them is the difference between a cause and a coincidence. Leaving
 * that to line style alone would mean a reviewer had to infer the distinction
 * from a dash pattern.
 */
function legend(): string {
  const routes: ReadonlyArray<readonly [string, string]> = [
    ["Confirmed (solid)", "An upstream layer traced this exact route. RVS is repeating a recorded claim."],
    ["Related (dashed)", "Both ends cite the same evidence, and no upstream route connects them. A reason to look, not an established cause."],
    ["Unresolved (dotted)", "A relation exists whose far end upstream could not resolve. The question was asked and not answered."],
  ];
  const changes = (Object.keys(CHANGE_GLYPH) as ReviewChangeType[]).map(
    (type) => `<li><span class="rvs-change" data-change="${escapeAttribute(type)}"><span class="rvs-change-glyph">${escapeText(CHANGE_GLYPH[type])}</span> <span>${escapeText(type)}</span></span></li>`,
  );
  return [
    `<section class="rvs-legend rvs-fidelity" aria-label="Legend">`,
    `<h2>Legend</h2>`,
    `<h3>Change types</h3>`,
    `<ul>${changes.join("")}</ul>`,
    `<h3>Route kinds</h3>`,
    `<ul>${routes.map(([label, what]) => `<li><strong>${escapeText(label)}</strong> — ${escapeText(what)}</li>`).join("")}</ul>`,
    `<p>Every state on this page carries a glyph and a word as well as a colour, and every route carries a line treatment as well as a colour.</p>`,
    `</section>`,
  ].join("");
}

/**
 * The fidelity receipt, drawn on the page rather than left in a file.
 *
 * A reader looking at a review that moved forty entities into detail views
 * should be able to learn that from the page they are looking at, not from a
 * JSON artifact they would have to know to go and find.
 */
function fidelity(doc: ComposedDocument): string {
  const rows = [
    ["Drawn in the review", doc.coverage.primary_entity_ids.length],
    ["Moved to a detail view", doc.coverage.detail_entity_ids.length],
    ["Represented by a collapsed group", doc.coverage.collapsed_entity_ids.length],
    ["Not drawn, and named in the receipt", doc.coverage.hidden_entity_ids.length],
  ] as const;
  const hidden = doc.coverage.hidden_entity_ids;
  return [
    `<section class="rvs-fidelity" aria-label="What this review shows">`,
    `<h2>What this review shows</h2>`,
    `<table><thead><tr><th scope="col">Disposition</th><th scope="col">Entities</th></tr></thead><tbody>`,
    rows.map(([label, count]) => `<tr><th scope="row">${escapeText(label)}</th><td>${count}</td></tr>`).join(""),
    `</tbody></table>`,
    `<p>Reason codes: ${escapeText(doc.receipt.reason_codes.join(", "))}</p>`,
    hidden.length === 0
      ? `<p>Every entity is drawn somewhere in this document.</p>`
      : `<details><summary>${hidden.length} entities are not drawn</summary><ul>${hidden
          .map((id) => `<li>${escapeText(id)}</li>`)
          .join("")}</ul></details>`,
    `</section>`,
  ].join("");
}

function help(): string {
  return [
    `<section id="rvs-help" class="rvs-help" aria-label="Keyboard help" hidden>`,
    `<h2>Keyboard</h2>`,
    `<dl>`,
    KEYBOARD_HELP.map(([key, what]) => `<dt>${escapeText(key)}</dt><dd>${escapeText(what)}</dd>`).join(""),
    `</dl>`,
    `<p>Every action in this review is reachable from the keyboard, and nothing is conveyed by colour alone.</p>`,
    `<p>Motion only emphasises what this page already says. Sequences are finite, never repeat, never block a control, and are skipped entirely when your system asks for reduced motion.</p>`,
    `<p>This review is read-only. It does not comment on a pull request, approve or block a merge, or take any other action.</p>`,
    `</section>`,
  ].join("");
}
