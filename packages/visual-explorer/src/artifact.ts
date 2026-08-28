import type {
  DetailMode,
  VisualAudience,
  VisualEvidenceRef,
  VisualGraphModel,
  VisualNode,
} from "@rvs/visual-intelligence";
import { digestOf } from "@rvs/visual-intelligence";
import type { GrammarStyle } from "@rvs/visual-grammar";
import { escapeAttribute, escapeText } from "@rvs/visual-grammar";
import type { ComposedDocument } from "@rvs/visual-composition";
import { composeVisualDocument } from "@rvs/visual-composition";
import { EXPLORER_LENSES } from "./interaction.js";
import { MAX_REACH_DEPTH } from "./view-state.js";
import { EXPLORER_RUNTIME } from "./runtime.js";
import { EXPLORER_STYLES } from "./styles.js";

// Assembling the interactive artifact.
//
// It is one file. Not "one file plus a stylesheet", not "one file that pulls a
// library": a single self-contained document that opens from a filesystem
// with the network unplugged and behaves identically. That constraint is what
// makes it something a reviewer can attach to a pull request, keep for six
// months, and reopen without a build.
//
// The security posture, stated once:
//
//   * No external origin is referenced. A `Content-Security-Policy` meta tag
//     says so, and a test asserts no absolute URL of any kind appears.
//   * Graph content never becomes markup. Labels reach the page as JSON string
//     values and are written with `textContent`; nothing is concatenated into
//     HTML.
//   * Evidence references are rendered as text, never as links. They are
//     repository-relative locations for a person to open in their editor.
//   * No absolute local path is written into the artifact, so it discloses
//     nothing about the machine that produced it.

export interface ExplorerArtifactInput {
  producer: string;
  subject: string;
  model: VisualGraphModel;
  audience: string | VisualAudience;
  detail_mode: DetailMode;
  focal_entity_ids?: readonly string[];
  style?: GrammarStyle;
  /** A short description of what the reader is looking at. Drawn as text. */
  caption?: string;
}

export interface ExplorerArtifact {
  html: string;
  /** Content digest of the artifact's inputs. Stable across runs; never a timestamp. */
  digest: string;
  document: ComposedDocument;
  /** Entities the reader can reach: drawn in the overview or in a detail view. */
  reachable_entity_ids: string[];
}

/** The projection of a node the runtime needs. Deliberately small: what is not embedded cannot leak. */
interface RuntimeNode {
  id: string;
  entity: string;
  label: string;
  kind: string;
  emphasis: string;
  resolution: string;
  confidence: string;
  severity?: string;
  decision?: string;
  evidence: number;
  evidence_refs: string[];
  placeholder?: true;
}

/**
 * An evidence reference as one line of text.
 *
 * Path and line range only, exactly as upstream recorded them, and only when
 * the path is repository-relative. An absolute path is dropped rather than
 * rewritten: rewriting it would be guessing at a repository root, and
 * embedding it would put the producer's filesystem into a file meant to be
 * shared.
 */
function evidenceLine(ref: VisualEvidenceRef): string | undefined {
  if (ref.path === undefined) return ref.detail;
  if (ref.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref.path)) return undefined;
  return ref.lines === undefined ? ref.path : `${ref.path}:${ref.lines}`;
}

function runtimeNode(node: VisualNode): RuntimeNode {
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
    evidence_refs: node.evidence_refs.map(evidenceLine).filter((l): l is string => l !== undefined),
    ...(node.placeholder_for === undefined ? {} : { placeholder: true as const }),
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
  ["Tab / Shift+Tab", "Move between every control, result, and entity"],
  ["Enter or Space", "Focus the selected entity"],
  ["Escape", "Clear focus, route, lens, and search"],
  ["?", "Show or hide this help"],
];

/**
 * Builds the interactive explorer.
 *
 * The drawing comes from `@rvs/visual-composition` unchanged -- the same
 * overview, the same detail views, the same fidelity receipt as any other
 * delivery surface. Interactivity is added *around* it. An explorer that
 * re-derived its own picture would be a second source of truth wearing the
 * first one's name.
 */
export function buildExplorerArtifact(input: ExplorerArtifactInput): ExplorerArtifact {
  const document_ = composeVisualDocument({
    producer: input.producer,
    subject: input.subject,
    semantic_intent: "architecture",
    model: input.model,
    audience: input.audience,
    detail_mode: input.detail_mode,
    format: "interactive",
    focal_entity_ids: input.focal_entity_ids,
    style: input.style,
  });

  const views = [document_.primary, ...document_.details];
  const runtimeModel = {
    // Carried so the browser's motion plans record the grammar they were
    // built for, exactly as `buildMotionPlan` does on this side. A plan that
    // says "dependency_graph" when the page drew a layer stack is a plan a
    // reviewer cannot check against what shipped.
    grammar: document_.spec.visual_grammar,
    nodes: views.flatMap((v) => v.audience.model.nodes.map(runtimeNode)),
    edges: views.flatMap((v) =>
      v.audience.model.edges.map((e) => ({ id: e.id, from: e.from_id, to: e.to_id, kind: e.kind })),
    ),
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
    `<title>${escapeText(input.subject)} — architecture explorer</title>`,
    `<style>${EXPLORER_STYLES}</style>`,
    `</head>`,
    // The scene contract @rvs/validator collects on.
    //
    // §64 asks that rendered accessibility checks run through the packaged
    // CLI, and the CLI's checker finds work by looking for `.scene` elements.
    // Declaring it here is what makes this artifact visible to the same
    // contrast and minimum-font-size checks a deck faces, rather than to a
    // second checker written for this surface -- which §32 explicitly
    // forbids.
    //
    // Two deliberate choices. The whole body is the scene, not just the
    // diagram: the controls, the inspector and the fidelity table are text a
    // reader has to read, and scoping the check to the drawing would report a
    // page as validated while never looking at most of its words. And there
    // is no `.scene-inner`, which is what switches the overflow check off:
    // this page is a document that scrolls on purpose, so measuring it
    // against a fixed slide frame would fail it for working correctly.
    `<body class="scene" data-scene-id="architecture-explorer" data-scene-type="explorer">`,
    header(input, document_),
    `<main class="rvs-layout">`,
    controls(document_),
    stage(document_),
    inspector(),
    `</main>`,
    fidelity(document_),
    help(),
    `<script type="application/json" id="rvs-model">${jsonIsland(runtimeModel)}</script>`,
    `<script>${EXPLORER_RUNTIME}</script>`,
    `</body>`,
    `</html>`,
  ].join("\n");

  return {
    html,
    // Digested from the inputs and the composed document rather than from the
    // markup, so a purely cosmetic change to the shell does not present itself
    // as a change to what the artifact says.
    digest: digestOf({
      subject: input.subject,
      audience: document_.spec.audience,
      detail_mode: document_.spec.detail_mode,
      spec: document_.spec.id,
      receipt: document_.receipt,
      coverage: document_.coverage,
    }),
    document: document_,
    reachable_entity_ids: reachable,
  };
}

function header(input: ExplorerArtifactInput, doc: ComposedDocument): string {
  const counts = doc.coverage;
  return [
    `<header class="rvs-header">`,
    `<h1>${escapeText(input.subject)}</h1>`,
    `<p class="rvs-caption">${escapeText(input.caption ?? "Interactive architecture explorer")}</p>`,
    `<p class="rvs-counts">${counts.source_entity_ids.length} entities · ${counts.primary_entity_ids.length} in the overview · ${counts.detail_entity_ids.length} in detail views · ${counts.hidden_entity_ids.length} not drawn</p>`,
    `<p class="rvs-counts">Audience: ${escapeText(doc.spec.audience)} · Detail: ${escapeText(doc.spec.detail_mode)} · Grammar: ${escapeText(doc.spec.visual_grammar)}</p>`,
    `<button type="button" id="rvs-help-toggle" aria-expanded="false" aria-controls="rvs-help">Keyboard help</button>`,
    `</header>`,
  ].join("");
}

function controls(doc: ComposedDocument): string {
  const entities = doc.primary.audience.model.nodes
    .filter((n) => n.placeholder_for === undefined)
    .map((n) => `<option value="${escapeAttribute(n.id)}">${escapeText(n.label)}</option>`)
    .join("");
  return [
    `<section class="rvs-controls" aria-label="Explore">`,
    `<label for="rvs-search">Search entities</label>`,
    `<input id="rvs-search" type="search" autocomplete="off" spellcheck="false" placeholder="Name or identifier">`,
    `<ul id="rvs-results" class="rvs-results" aria-label="Search results"></ul>`,
    `<label for="rvs-lens">Lens</label>`,
    `<select id="rvs-lens">`,
    EXPLORER_LENSES.map(
      (l) => `<option value="${escapeAttribute(l.id)}" title="${escapeAttribute(l.description)}">${escapeText(l.label)}</option>`,
    ).join(""),
    `</select>`,
    `<label for="rvs-direction">Direction</label>`,
    `<select id="rvs-direction">`,
    `<option value="downstream">Downstream</option>`,
    `<option value="upstream">Upstream</option>`,
    `<option value="both">Both</option>`,
    `</select>`,
    `<label for="rvs-depth">Reach (hops)</label>`,
    `<input id="rvs-depth" type="number" min="0" max="${MAX_REACH_DEPTH}" step="1" value="2">`,
    `<label for="rvs-route-to">Trace a route to</label>`,
    `<select id="rvs-route-to"><option value="">No route</option>${entities}</select>`,
    `<button type="button" id="rvs-clear">Clear everything</button>`,
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
    `<section id="rvs-stage" class="rvs-stage" aria-label="Architecture diagram">`,
    `<h2>Overview</h2>`,
    doc.primary.render.svg,
    detail,
    `</section>`,
  ].join("");
}

function inspector(): string {
  return `<aside id="rvs-inspector" class="rvs-inspector" aria-label="Entity inspector" aria-live="polite"></aside>`;
}

/**
 * The fidelity receipt, drawn on the page rather than left in a file.
 *
 * A reader looking at an overview that dropped forty entities should be able
 * to learn that from the page they are looking at, not from a JSON artifact
 * they would have to know to go and find.
 */
function fidelity(doc: ComposedDocument): string {
  const rows = [
    ["Drawn in the overview", doc.coverage.primary_entity_ids.length],
    ["Moved to a detail view", doc.coverage.detail_entity_ids.length],
    ["Represented by a collapsed group", doc.coverage.collapsed_entity_ids.length],
    ["Not drawn, and named in the receipt", doc.coverage.hidden_entity_ids.length],
  ] as const;
  const hidden = doc.coverage.hidden_entity_ids;
  return [
    `<section class="rvs-fidelity" aria-label="What this view shows">`,
    `<h2>What this view shows</h2>`,
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
    `<p>Every action in this explorer is reachable from the keyboard, and nothing is conveyed by colour alone.</p>`,
    `</section>`,
  ].join("");
}
