# Interactive Architecture Explorer (Milestone 10.3)

A single HTML file that opens from a filesystem, with the network unplugged,
and lets a reader search the architecture, follow dependencies, trace a route
between two components, and read the evidence behind any of it.

Not a hosted service, not a dev server, not a daemon. `rvs graph open` writes a
file and stops. That constraint is what makes the artifact something a reviewer
can attach to a pull request, keep for six months, and reopen without a build.

## What it does not decide

The explorer establishes no relationship and asserts no fact. Every edge it
draws exists because an edge existed in the knowledge graph; every resolution
state, confidence and severity is copied verbatim. Its questions — *what
matches this text, what is downstream of this, how do these two connect, what
does this lens bring forward* — are all selection and emphasis over intelligence
someone else produced.

The one thing it deliberately declines to say is anything it was not told. A
model built from a graph carrying no cycle annotation reports `has_cycles:
false` even when the edges it was handed happen to form a cycle, because
"nobody said" and "no" are different answers and only one of them is honest.

## The packages

| File | Responsibility |
| --- | --- |
| `source.ts` | cached upstream artifacts → `VisualGraphModel` |
| `interaction.ts` | search, reach, route, lens — pure functions over the model |
| `view-state.ts` | encode/decode a shareable view, validated against the artifact |
| `artifact.ts` | assemble the one file |
| `runtime.ts` | the browser copy of the algorithms, authored as text |
| `styles.ts` | the inlined stylesheet |

`source.ts` imports nothing from `@rvs/knowledge-graph`,
`@rvs/governance-intelligence` or `@rvs/decision-intelligence`. Its intake
types are *structural* — plain object shapes whose field names match the cached
artifacts — and the CLI, which already reads those caches, passes the objects
straight through. Same zero-cross-import convention as every intelligence
layer, and it is what lets the explorer be tested against fixtures rather than
against a built repository.

## Two copies of the algorithms, one set of semantics

The explorer's query primitives exist twice: once in `interaction.ts` as
TypeScript, once in `EXPLORER_ALGORITHMS` as text shipped into the page. The
second copy is what the reader actually runs, and a behaviour that exists only
as browser code is a behaviour with no test.

So `runtime-parity.test.ts` loads `EXPLORER_ALGORITHMS` into a `node:vm`
context created from `Object.create(null)` — no `document`, no `window`, no
`fetch`, no `process`, no `require` — and runs both copies over the same
fixtures:

- **search** — 3 models × 9 queries
- **reach** — every origin × 3 directions × 5 depths
- **route** — every node pair × 3 directions
- **lens** — 5 lenses × 3 focus sets

Identical results, every time. The runtime executing at all in a context with
no host objects is itself the proof that the pure half is pure.

`EXPLORER_RUNTIME_WIRING` is the half that touches the page, and it is held to
a different property: it constructs no markup. Every insertion goes through
`textContent` or `createElement`, so a hostile label is text at every point and
can never become an element.

## The query primitives

**Search** ranks by *how* the query matched — exact id or label, label prefix,
label substring, id substring — never by importance. The explorer has no basis
for saying one component matters more than another, and inventing one would be
a claim dressed as a convenience. Ties break on id, so two runs list results in
one order. An empty query returns nothing, not everything.

**Reach** is bounded, and the bound is *disclosed*: `truncated` says whether
the answer is the whole neighbourhood or the part that fit within
`MAX_REACH_DEPTH` (6). An unbounded traversal on a large graph selects
everything, which tells the reader nothing while looking like it told them
something.

**Route** returns the shortest path, and among equally short paths the one
whose edge ids sort first. "Any shortest path" would be a correct answer and a
useless artifact: two runs would draw different routes through the same
architecture, and a reader comparing them would be comparing coin flips.

**Lenses** — governance, decisions, unresolved, evidence — change emphasis and
nothing else. A lens cannot remove an entity. Every one of them answers a
question where "there are none" and "you did not ask" must stay
distinguishable, so an entity outside the lens is *muted*: still drawn, still
in the document, still found by search, still announced by a screen reader.
Focal entities are never muted; the reader named them.

## Shareable view state, and the reason it is boring

A view encodes to `f=…&t=…&d=downstream&n=2&l=none&q=…` in the URL fragment.
Deliberately not a compact binary format, which would make a hostile state
harder to read and no harder to construct.

The security property is one branch of the decoder: **view state names
entities, and entities are resolved against the model embedded in this
artifact.** An id that is not an entity of this artifact never becomes state,
so nothing downstream is ever asked to resolve it. `/etc/passwd`,
`../../../../etc/passwd`, `C:\Users\…`, `file:///etc/passwd` and
`https://example.invalid/steal` are all rejected on identical terms — not
because any of them is recognised as dangerous, but because none of them is an
entity.

Rejections are *reported*, never silently dropped. A reader who followed a link
to an entity that no longer exists is told the entity is gone, rather than
shown a default view and left to conclude they misremembered. Rejection
messages are sanitised and truncated, so a rejected value cannot turn a
diagnostic into a place to hide a payload.

Depth is matched as digits before it is read as a number. `Number("")` is `0`,
and `0` is a depth in range, so a coercion would let an empty field quietly
mean "no hops" — an answer the reader never asked for, arriving with nothing
rejected to tell them so.

## What the artifact contains, and what it cannot

- **No external origin.** A `Content-Security-Policy` meta tag says so, and a
  test asserts that the only absolute URL anywhere in the file is the SVG
  namespace — an identifier nothing fetches — appearing exactly as many times
  as there are `xmlns=` attributes.
- **No `<a>` elements.** Evidence references are repository-relative locations
  rendered as text for a person to open in an editor, never as links.
- **No absolute local path.** The artifact discloses nothing about the machine
  that produced it; a test drops an absolute path into an evidence ref and
  asserts it does not survive while `src/leaky.ts:1-4` does.
- **No `eval`, `new Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic
  `import`, `innerHTML`, `localStorage`, or navigation.**
- **No timestamp.** Five runs produce byte-identical HTML and the same digest.
  The digest changes with detail mode and does not change with the caption.

Graph content reaches the page as JSON string values in an island whose `<`,
`>`, `&`, U+2028 and U+2029 are escaped, and is written with `textContent`.
A label of `"><img src=x onerror=alert(1)>` appears as text inside `<option>`,
`<title>` and `<text>`, and as an escaped JSON string — and in no tag position
anywhere in the document.

## The fidelity receipt travels with it

The artifact carries its receipt on the page, not only in a sidecar nobody
opens. Hidden entities are named. `reachable_entity_ids` — what the reader can
actually get to, in the overview or in a detail view — equals the coverage the
composed document reports, and the page states plainly whether every entity is
drawn somewhere in the document.

This is where the [anchor floor](adaptive-detail.md#the-anchor-floor) matters
in practice. Run against this repository's own graph before it existed, the
balanced overview held eight stand-ins and not one named entity: within budget,
fully disclosed, and impossible to learn a component's name from.

## Keyboard and screen reader

- A visible focus ring, never removed: `:focus-visible { outline: 3px solid … }`
  and no `outline: none` anywhere. Keyboard navigation that cannot be seen is
  keyboard navigation that does not work.
- Six `aria-label`s, five `for`/`id` pairs, `role="status"` with `aria-live`
  for results, and `aria-expanded`/`aria-controls` on the disclosure controls.
- Nothing is conveyed by colour alone. Muting lowers opacity *and* desaturates,
  so the distinction survives greyscale printing and colour-vision differences
  alike. Every state colour is paired with an opacity or a stroke width.
- Nothing is set to `display: none`. A de-emphasised entity is still in the
  document, still found by search, still read aloud.
- One transition, 120ms, removed entirely under `prefers-reduced-motion`.

## The command

```
rvs graph open [--output <path>] [--audience <a>] [--detail <mode>] [--focus <id>]...
               [--verified] [--profile <id>]
```

Defaults to `.rvs/out/architecture-explorer.html`, `--audience engineering`,
`--detail balanced`. It reads `nodes.json` and `edges.json` from the graph
cache, and `governance-findings.json` and `decisions.json` when they are there
— saying so when they are not, because a lens that brings nothing forward
because there is nothing and a lens that brings nothing forward because the
cache is cold look identical on screen.

A decision status the visual vocabulary does not have a shape for becomes
`unknown` and is *counted*, rather than mapped onto a neighbouring status that
would read as a claim nobody made.

Then it writes the file and stops. No server, no browser launch, no watcher.

`--verified` changes only *when* the file is written. The page is rendered into
a staging directory, measured against a named verification profile — structure,
fidelity, reference integrity, rendered layout, rendered accessibility and
keyboard interaction — and replaces `--output` atomically only if every
required check passed. If anything fails, or if the browser those checks need
cannot start, the file already at `--output` is left byte for byte as it was
and a repair receipt says why. Without the flag the command behaves exactly as
it always has. See [verified-preview.md](verified-preview.md).

## The same page from an installed package

Everything above is generated identically by an installed `@rvs/cli`
tarball and by this workspace's source. That is asserted rather than
assumed: `source-vs-package-equivalence.test.ts` packs the CLI, installs it
into a fresh project outside this repository under a path containing
spaces, cuts the checkout out of `PATH`, and requires the artifacts to
match — spec attributes, design tokens, the serialized model, the fidelity
receipt, every ARIA attribute, the SVG geometry, the motion plan and
runtime, and finally the whole file byte for byte. Playwright then drives
both real files through the same interactions and compares what a reader
would see. See [packaging.md](packaging.md#installed-tarball-equivalence).

## Comparing two snapshots

The explorer shows one architecture. To show what changed between two of them
— with governance findings, decision impacts, downstream reach and unresolved
questions attached to each change — see
[architecture-change-review.md](architecture-change-review.md). It extends this
runtime rather than replacing it: the review page ships `EXPLORER_ALGORITHMS`
unchanged and adds `REVIEW_ALGORITHMS` beside it, so search, focus, and the
evidence drawer behave in a review exactly as they behave here.

## See also

[architecture-change-review.md](architecture-change-review.md),
[verified-preview.md](verified-preview.md),
[adaptive-detail.md](adaptive-detail.md),
[fidelity-receipts.md](fidelity-receipts.md),
[visual-grammar.md](visual-grammar.md),
[visual-intelligence.md](visual-intelligence.md),
[packaging.md](packaging.md).
