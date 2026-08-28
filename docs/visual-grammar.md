# Semantic Diagram Grammar (Milestone 10.1)

This document describes `@rvs/visual-grammar`: the layout engines and SVG
renderer that turn a `VisualCommunicationSpec` and a `VisualGraphModel` into
a drawing. It owns **geometry and markup**, and nothing else. It decides
nothing about what is true and nothing about what may be dropped — by the
time it is called, `@rvs/visual-intelligence` has already chosen the grammar,
applied the degradation policy, and written the fidelity receipt.

```
VisualCommunicationSpec + VisualGraphModel      (@rvs/visual-intelligence)
  -> normalizeVisualGraphModel()                (canonical order, every call)
  -> GRAMMAR_ENGINES[spec.visual_grammar]       (render.ts)
  -> layered | nested | lanes | stages | matrix | fishbone | delta  (layout/)
  -> GrammarLayout { nodes, edges, groups, labels, width, height }
  -> fitTransform()                             (geometry.ts, never scales up)
  -> renderGrammar() -> "<svg …>"               (render.ts)
  -> RenderResult { svg, view_box, content, scale, boxes }
```

Scope: **one model in, one deterministic SVG string out.** No DOM, no
browser, no Playwright, no HTML. The package emits SVG *as text*; it never
touches an `SVGElement`.

## Purity, enforced by the compiler

`packages/visual-grammar/tsconfig.json` overrides `"lib": ["ES2022"]`,
dropping `DOM` from the inherited base. Reaching for `document` here is a
compile error rather than a review comment. The package depends on
`@rvs/visual-intelligence` and nothing else.

## Fifteen grammars, seven engines

`GRAMMAR_ENGINES` maps every published grammar to the engine that draws it,
and a test asserts the map is total — a grammar the vocabulary publishes but
no engine can draw would be a promise the system does not keep.

| Engine | Grammars | Shape it asserts |
| --- | --- | --- |
| `layered` | `architecture`, `dependency_graph`, `data_flow`, `tree`, `state_machine` | direction of dependency |
| `nested` | `nested`, `layer_stack` | containment |
| `lanes` | `swimlane`, `sequence` | who does what, and when |
| `stages` | `process`, `timeline` | ordered progression |
| `matrix` | `matrix`, `metric_row` | membership and magnitude, not flow |
| `fishbone` | `fishbone` | causes converging on one effect |
| `delta` | `delta` | before against after |

Each engine draws its own claim. A test renders the same model through six
grammars and requires six *different* geometries: if the renderer inferred a
shape from the intent instead of obeying `spec.visual_grammar`, grammar
selection upstream would be decoration.

### Layered

Kahn topological order with the queue seeded and drained in sorted id order,
longest-path layering, then **exactly four** barycenter sweeps — a fixed
count, never "until stable", because a convergence test makes output depend
on floating-point noise. Nodes stranded by a cycle are appended one layer
past the deepest and sorted by id. That is an arbitrary choice, and stating
it is the point: the alternative is dropping a back edge, which would make
the drawing disagree with the graph.

### Nested

Containers laid out as boxes with a header band, children packed inside, and
only *inter-container* edges drawn as crossings. Nodes with no container are
collected into an `__ungrouped` pseudo-container rather than dropped — a node
without a parent is still a node.

### Lanes

`swimlane` gives every lane a row and shares one column grid across all of
them, so two nodes with the same `order` line up vertically and read as
concurrent. `sequence` transposes this: actors become columns and messages
are drawn horizontally at the sender's row.

### Stages

`process` buckets nodes by stage and lays the buckets out left to right;
`timeline` is the same layout plus a stage-caption axis. Stage order comes
from the model's `order` field, never from array position.

### Matrix

Rows are containers, columns are node kinds, both sorted. Co-occupants of a
cell stack rather than overlap. It emits `edges: []` **deliberately**: a
matrix asserts membership, and drawing connectors across one would imply a
flow the grammar is not claiming. A test asserts no edge is ever emitted.

### Fishbone

The effect is chosen by a fixed precedence — focal node, else the terminal
node with the most inbound edges, else the lowest id. Categories come from
containers where they exist and from node kind otherwise. Ribs alternate
above and below the spine, and each cause connects to the **spine**, not to
the next cause, because a cause chain and a cause list are different claims.

### Delta

Both panels are laid out **once**, over the union of both states, and then
filtered. Laying each panel out independently would let an untouched
component land somewhere else on the right-hand side and read as a change
that never happened. Shared geometry means anything that moved on the page
genuinely moved in the architecture — and a test proves it: every node
present in both panels has identical `y` and identical width, and the set of
`x` offsets across all shared nodes has exactly one member.

This engine computes **no diff**. `model.changes` arrives verbatim from an
upstream comparison artifact; nothing here decides what "changed" means.

## The canonical coordinate system is the only coordinate system

Every rendered document uses `sceneContentBox()` — 1088×576 within the
`rvs-stage-16x9-v1` stage — as its `viewBox`, and stamps
`data-rvs-coordinate-system` so a drawing can be checked against the system
it claims. `fitTransform()` applies a single uniform scale capped at
`Math.min(1, …)`: content that overflows is scaled down as a whole, and
content that fits is never blown up to fill the frame.

`RenderResult.boxes` republishes each node's rectangle in canonical units, so
the interactive explorer hit-tests the geometry that was actually drawn
rather than a second, separately-computed copy of it.

## Density is never resolved by shrinking type

The forbidden default for this milestone is "too dense, so use a smaller
font". Font sizes come from `GrammarStyle.font_size` and are constant: a test
renders a 2-node model and a 40-node model and requires the **same set** of
`font-size` values in both. `RenderResult` exposes no font scale, and its
`scale` is capped at 1 and applies to the whole drawing, so it can never be
used to squeeze one crowded region.

When content genuinely will not fit, the answer was already taken upstream —
`@rvs/visual-intelligence` splits before it shrinks and files a receipt. See
[`visual-intelligence.md`](visual-intelligence.md).

Long labels are *truncated*, not shrunk: `sizeNode()` caps a box at
`MAX_NODE_WIDTH` and wraps to at most two lines, and the full label always
ships in `<title>`. That is a visual truncation, not an information loss, and
deliberately produces no receipt entry.

## Determinism

`renderGrammar()` calls `normalizeVisualGraphModel()` on its input rather
than trusting the caller's array order. Node *positions* were order-independent
without it, but serialisation order was not — and every downstream digest,
cached artifact, and screen-reader reading order depends on the bytes.

Two further defences:

- `formatNumber()` rounds coordinates to two decimals, so `0.1 + 0.2` and
  `0.3` serialise identically and floating-point association order cannot
  leak into the output. `-0` is normalised to `0`.
- `attributes()` never sorts. Attribute order is caller-controlled and
  therefore part of what the determinism comparison covers.

The proofs render every grammar five times and across five deterministic
shuffles of every ordered collection, and require a byte-identical document
each time. Text measurement is separately proved to be a pure function of the
string and to scale linearly with font size.

## Content from a repository is drawn, never executed

Every string this package writes came from repository evidence: a file path,
a Terraform resource name, a commit subject, an ADR title. None of it is
trusted. A repository containing a file called `</text><script>…` is not an
attack on RVS so much as a fact about that repository, and the drawing of it
must stay a drawing.

- `escapeText()` escapes `& < >` for element content; `escapeAttribute()` also
  escapes `" '`. Two functions because the contexts genuinely differ, and
  over-escaping text would put `&quot;` in front of a reader who wrote a
  quotation mark.
- **Escaping, never stripping.** A label that reads `<Root>` in the repository
  reads `<Root>` in the diagram. Silently deleting characters would make the
  picture disagree with the evidence it cites.
- `isForbiddenAttribute()` drops every `on*` handler, `href`, and
  `xlink:href` **centrally**, at the point of attribute emission. A call site
  cannot introduce an event handler even by accident.
- No `<script>`, `<iframe>`, `<foreignObject>`, `<use>`, `<image>`, `<a>`, or
  CDATA section is ever emitted, for any grammar and any payload.

The security proofs scan the document's *tags* rather than its whole text,
because a label rendered as `&lt;img src=x onerror=…&gt;` contains
`onerror=` and is perfectly safe. After escaping, no text content can contain
`<` or `>`, so extracting `<[^>]*>` returns exactly the markup — and if
escaping ever broke, a payload would appear there as the tag it was trying to
become.

Nothing about the rendering machine leaks into the drawing either: no
absolute path, no hostname, no home directory, no timestamp. Evidence is
carried as a *reference* (`data-rvs-evidence-count`, and the path in the
model), never as evidence content — a diagram travels much further than the
repository it describes.

## Accessibility

- The `<svg>` carries `role="img"` and `aria-labelledby` pointing at a
  `<title>` and a `<desc>` it defines.
- The description **states the reduction**, so a screen-reader user learns
  the picture is partial at the same moment a sighted reader sees the
  collapsed-group label.
- Every node emits `<title>` with its complete label and `<desc>` with its
  kind and state, so a truncated box is still fully named.
- Every generated id is prefixed from the **id scope** of the render, so two
  drawings can share one HTML document without the second silently
  redefining the first's arrowhead markers. A test renders two diagrams and
  requires disjoint id sets, and a second test requires every `url(#…)`
  reference to resolve to a marker the same document defines.
- The id scope defaults to the spec id, which is right when a spec produces
  one drawing and wrong when it produces several. The explorer renders a
  single spec as an overview plus one detail view per split, and all of them
  land in one document: with the spec id as the prefix, every view minted
  the same `-title`, `-desc` and `-arrow-*` ids. `aria-labelledby` resolves
  to the *first* matching id in a document, so each detail view was
  announced with the overview's name and description while its own were
  unreachable — the reduction each view discloses was, for a screen-reader
  user, the wrong reduction. A caller that draws a spec more than once
  therefore passes `id_scope` naming the view being drawn, and
  `packages/visual-composition/src/__tests__/element-ids.test.ts` requires
  that no id is minted twice however many views a spec produced, that every
  view's `aria-labelledby` points at its own title and description, and that
  the ids stay identical across runs.

Colour carries no meaning alone: node accent follows a fixed precedence
(change kind → severity → resolution → emphasis) and every state that has an
accent also has a non-colour cue — dashed strokes for unresolved edges, a
dashed border for synthetic containers, and text in `<desc>`. Decision status
deliberately drives no colour at all; `superseded` is a fact about a record,
not a warning.

The semantic design tokens that will replace `NEUTRAL_STYLE` arrive in
Milestone 10.5. `GrammarStyle` is the seam they fill: it names roles
(`ink.primary`, `line.muted`, `state.blocking`) and never colours (`blue`,
`red`), so a token set can be swapped without a renderer learning what a
palette is.

## See also

- [`visual-intelligence.md`](visual-intelligence.md) — grammar selection, degradation policy, budgets
- [`fidelity-receipts.md`](fidelity-receipts.md) — what a reduction has to disclose
