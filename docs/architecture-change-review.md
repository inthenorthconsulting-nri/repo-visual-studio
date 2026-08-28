# Before / Delta / After Architecture Change Review (Milestone 10.4)

`rvs graph review` takes two architecture snapshots RVS already produced, asks
the comparison engine RVS already has what changed between them, and writes one
self-contained HTML file showing what existed before, what changed, what exists
after — and how each change connects to capabilities, governance findings,
decisions, downstream reach and unresolved questions.

It computes no difference of its own. `diffGraphs` is the same function
`rvs graph compare` calls, over the same two snapshots, with the same options.
A review that showed a different set of changes than the comparison it claims
to be visualising would be worse than no review.

## What it does not decide

Everything in the document arrived from somewhere else:

| Shown | Established by |
| --- | --- |
| what changed | `@rvs/knowledge-graph` `diffGraphs` |
| governance findings and severities | `@rvs/governance-intelligence` |
| decision state and drift | `@rvs/decision-intelligence` |
| downstream reach and blast radius | `rvs graph impact`'s cached results |
| capability and product links | the same impact results |

No architecture diff, capability regression, governance finding, decision
drift, impact path or blast radius is re-derived here. Where an upstream
artifact is missing, the review says the domain is unavailable and reports what
it does have — it does not reconstruct the missing part heuristically, and it
never shows "no change" for a domain it could not compare.

The review is read-only in the strongest sense available to a program: it
writes a file. It does not comment on a pull request, approve one, block one,
or reach the network at all.

## The three states

One layout, drawn three times.

The `delta` grammar lays out the **union** of the before and after states once,
then filters that single geometry into three panels. Laying each panel out
independently would let an unchanged component sit somewhere else on the right,
and the reader would have to search for it before they could tell it had not
moved — which is exactly the question a change review is asking. Shared
geometry means anything that moved on the page genuinely moved in the
architecture.

The middle panel is the same geometry again, filtered to what changed. A
component in the Delta panel sits at exactly the height it sits at on both
sides of it, so the eye travels left to right across one row and sees one
entity in all three states. It holds every changed entity plus both endpoints
of every changed relationship — a rerouted dependency drawn with nothing at
either end tells a reader that *something* moved and not what it moved between.

A missing counterpart is drawn as missing. A removed component has no After
box, an added one has no Before box, and neither gets a stand-in invented for
the sake of symmetry: where no stable identity exists on one side, the honest
drawing is an absence.

## The eight change semantics

`added`, `removed`, `modified`, `rerouted`, `regressed`, `resolved`,
`qualified`, `unresolved` — each mapped from an upstream change entry, never
renamed on the way through. A `removed` component is not shown as
"deprecated": one is a fact about the graph and the other is a claim about
intent.

An arriving change type the vocabulary does not have is **counted and
reported** (`CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE`) rather than mapped onto a
neighbouring type that would read as a claim nobody made.

## Causal review

The most important thing 10.4 gets right or wrong, and the rule is one line:
**adjacency is not causality.**

`causality.ts` contains no traversal, no neighbour lookup and no transitive
closure, because each of those would let "these two entities are near each
other" become "this change caused that regression". Three relations exist and
are labelled as what they are:

- **confirmed** — an upstream layer emitted this exact route: an impact path
  from the knowledge graph's bounded traversal, or a decision-impact entry
  recording that a decision was reached from the changed entity. The route
  carries the id of the artifact it was read from, so a reviewer can check it.
- **related** — both ends cite the same evidence artifact and no upstream route
  connects them. A reason to look, not a cause.
- **unresolved** — a relation exists whose far end upstream could not resolve.
  Named, so the reader knows the question was asked and not answered.

Routes are ordered confirmed, then related, then unresolved, so a coincidence
never leads.

**Only depth-1 reach becomes a drawn route.** `impact-results.json` records
*that* a deeper entity was reached and at what depth, but not the entities in
between — so drawing origin → entity for a depth-4 reach would draw a direct
relationship that does not exist. Deeper reach still reaches the reader through
the blast radius the change already carries, and the command says how many
routes it declined to draw.

## Unknown impact has fixed wording

The three statements this package is allowed to use:

- "No confirmed downstream consumers were found in the analyzed evidence."
- "Downstream consumer reach is unresolved."
- "No evidence-backed path was found within the configured traversal boundary."

Never "no downstream impact", "safe change", or "no consumers". Those are
claims about the architecture; the first three are statements about the
evidence, which is all the review has. A test asserts the banned phrasings
appear on no fixture's page.

## The six lenses

`architecture`, `capabilities`, `governance`, `decisions`, `impact`,
`unresolved`. Each is a *selection* — it changes visibility and emphasis and
nothing else. No lens changes a change set, a severity, a decision state, an
impact calculation, or one number in the fidelity receipt, which is why
`applyReviewLens` returns muted ids rather than a filtered set.

Two of them carry a caveat drawn on the page whenever they are active, because
both are one reading away from being taken as a verdict:

- The **governance** lens shows which findings were recorded. An empty result
  means no finding was recorded, not that the change is safe to deploy.
- The **decisions** lens reports decision state as recorded upstream. It is not
  a correctness judgement, and RVS approves and rejects nothing.

## Adaptation, and the floor under it

Every review earns its grammar rather than being assigned one: a model carrying
change facts scores `delta` at weight 100, with `SemanticIntent = change` and
`MotionIntent = compare`. Nothing hard-codes "architecture review means
balanced".

The delta budgets are 30 / 21 / 13 nodes for faithful / balanced / simplified,
with an [anchor floor](adaptive-detail.md#the-anchor-floor) of 15 / 10 / 6. The
floor is what stops a simplified Delta view from becoming eight stand-ins and
zero real changed entities — within budget, fully disclosed, and impossible to
learn a change from.

10.4 added exactly one rank to the degradation policy:
`VISUAL_PRESERVE_CHANGE_SUBJECT` at rank 3, immediately after the focal entity
and the primary path. A changed entity is protected from hiding and, being
relocatable, may be paged into a detail view rather than dropped.

The order of passes is unchanged and shared with every other view: structural
equivalence, low-value leaves, split-before-shrink, hide, merge stand-ins,
residual paging. There is no separate release algorithm for Delta views —
`FIDELITY_ANCHOR_RELEASED` fires from the same graduated release every grammar
uses, and 10.4 is where that code finally became reachable by a test: release
only fires when the anchors themselves are relocatable, which change subjects
are and focal entities are not.

A Delta view's fidelity events are reported with the vocabulary every other
grammar uses — `FIDELITY_STRUCTURALLY_EQUIVALENT_COLLAPSED`,
`FIDELITY_STAND_INS_MERGED`, `FIDELITY_SPLIT_INTO_VIEWS`,
`FIDELITY_ANCHOR_RELEASED` — rather than change-prefixed duplicates of them.
A `FIDELITY_CHANGE_SPLIT_VIEW` alongside `FIDELITY_SPLIT_INTO_VIEWS` would be
two names for one event, and a reader comparing a review's receipt against an
explorer's would have to learn which pairs mean the same thing. The receipt
already records the grammar, so "this split happened in a delta view" is a
fact the reader can read off it.

Stand-ins merge only under pure collapse. Two stand-ins pointing at *different*
split views never merge, because a reader who cannot tell them apart cannot
reach either.

## Validation codes

Twelve, each reachable by an input a caller can produce, each with a test:

| Code | Fires when |
| --- | --- |
| `CHANGE_REVIEW_BASELINE_MISSING` | the before state has no entities |
| `CHANGE_REVIEW_TARGET_MISSING` | the after state has no entities |
| `CHANGE_REVIEW_INCOMPATIBLE_SNAPSHOTS` | the pair was not comparable |
| `CHANGE_REVIEW_DANGLING_CHANGE` | a change names an entity in neither state |
| `CHANGE_REVIEW_BEFORE_ENTITY_MISSING` | a declared before-counterpart is absent |
| `CHANGE_REVIEW_AFTER_ENTITY_MISSING` | a declared after-counterpart is absent |
| `CHANGE_REVIEW_UNSUPPORTED_CHANGE_TYPE` | a change type the vocabulary lacks |
| `CHANGE_REVIEW_FIDELITY_LOSS` | the receipt records entities not drawn |
| `CHANGE_REVIEW_REAL_ANCHOR_LOST` | changes exist and none is drawn |
| `CHANGE_REVIEW_GOVERNANCE_REFERENCE_MISSING` | a change cites an absent finding |
| `CHANGE_REVIEW_DECISION_REFERENCE_MISSING` | a change cites an absent decision |
| `CHANGE_REVIEW_NONDETERMINISTIC_ORDER` | duplicate ids, or an unsorted list |

No code is predeclared. A code nobody can reach is a promise of a check that
does not exist, and a reviewer who sees a clean run counts on every declared
check having run.

Validation *reports*; it repairs nothing it reports.

## Comparability

Two snapshots are comparable when they describe one repository at one graph
schema version and at least one upstream domain was read on both sides. An
incompatible pair fails the review by default and writes no file: a difference
between two things that cannot be compared is not a change.

Comparability turns on whether a domain was *read*, not on whether its
provenance is `complete`. `complete` means the snapshot recorded which upstream
version fed it, which is a statement about traceability; `rvs graph build`
records no upstream snapshot ids today, so requiring it would refuse every pair
RVS can actually produce. A check no real input can pass is not a safety
property.

A domain read on one side only makes the comparison **partial**, and a partial
review says so on its own face, naming the domains it cannot speak about:
*"…could not be compared between these snapshots, so nothing is reported about
them either way. That is not the same as saying nothing changed in them."*

## The no-change state

A comparison that ran and found nothing is a result, not a missing diagram. The
page says *"No material graph changes were detected between these compatible
snapshots"* and draws no `<svg>` at all — an empty architecture map would be a
picture of nothing pretending to be a picture of something.

## What the artifact contains, and what it cannot

- **No external origin.** A `Content-Security-Policy` meta tag, and a test
  asserting the only absolute URL in the file is the SVG namespace — an
  identifier nothing fetches.
- **No network primitive.** No `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `eval`, `new Function`, `innerHTML`, `outerHTML` or
  `insertAdjacentHTML` anywhere in the shipped runtime.
- **No `<a>` elements, no absolute local paths, and no remote addresses.**
  Evidence references are repository-relative locations rendered as text. An
  absolute path is dropped, and so is any path carrying a scheme: evidence is a
  place a reader goes to check a claim in their own checkout, and printing a
  remote address inside a document that circulates on a pull request would put
  an address somebody else chose in front of every reviewer.
- **No timestamp.** Five runs of every fixture produce byte-identical HTML, and
  shuffling the order of nodes, changes, findings, decisions and evidence
  produces the same model, spec, receipt, anchors, split views and bytes.
- **The viewer does not execute source data.** Labels reach the page through a
  JSON island whose `<`, `>` and `&` are escaped, and are written with
  `textContent`. A label of `<img src=x onerror=alert(1)>` is text inside
  `<title>` and `<text>` and appears in no tag position anywhere in the
  document — a test scans every tag in the output and asserts none carries an
  inline event handler.

## Two copies of the algorithms, one set of semantics

As in the explorer, the review's selection primitives exist twice: once in
TypeScript, once as `REVIEW_ALGORITHMS` text shipped into the page. The second
copy is what the reader runs, and a behaviour that exists only as browser code
is a behaviour with no test.

`runtime-parity.test.ts` loads both `EXPLORER_ALGORITHMS` and
`REVIEW_ALGORITHMS` into a `node:vm` context created from `Object.create(null)`
— no `document`, `window`, `fetch`, `process` or `require` — and runs them over
the **JSON the artifact actually embeds**, for every fixture:

- `rvsChangeMatchesLens` against `changeMatchesLens`, every change × six lenses
- `rvsLensEntityIds` against `lensEntityIds`
- `rvsReviewMutedIds` against what `applyReviewLens` mutes
- ordering contracts for the browser-only helpers: routes strongest-evidence
  first, changes and unresolved statements in id order verbatim, and panel
  presence reported from the model rather than inferred from a change type

## Keyboard, screen reader, motion

- Six labelled regions, real `<label for>` on the search and lens controls,
  `role="status"` with `aria-live="polite"`.
- Nothing is encoded by colour alone: every change type carries a
  `data-change` shape and a prose label, and each of the three route kinds is
  described in words "as well as a colour".
- Every font size is at least 14px (or the `rem` equivalent).
- Motion is `compare`: finite, semantic, and gone entirely under
  `prefers-reduced-motion`, which keeps focus synchronisation, route
  highlighting and screen-reader announcements. `--motion none` degrades
  nothing else about the review.

## The commands

```
rvs graph review --from <snapshot-dir> --to <snapshot-dir>
                 [--output <path>] [--audience <a>] [--detail <mode>]
                 [--lens architecture|capabilities|governance|decisions|impact|unresolved]
                 [--motion none|compare] [--verified] [--profile <id>]
```

Defaults: `artifacts/visuals/change-review.html`, `--audience engineering`,
`--detail balanced`, `--lens architecture`, `--motion compare`. A snapshot
directory is one holding `graph-snapshot.json`, `nodes.json` and `edges.json` —
the same shape `rvs graph compare --from` reads.

`--verified` stages the review, measures it against
`visual-change-review-v2` — the same families as the explorer's profile,
recorded against the review surface — and replaces `--output` only if every
required check passed, leaving the existing file byte-identical when anything
fails. The review's own findings travel into that verification as they are:
`validateChangeReview` runs over a model that no longer exists once HTML is on
disk, so its findings are carried through rather than re-derived, and
governance severity, decision state and evidence references reach the promoted
file unchanged. See [verified-preview.md](verified-preview.md).

```
rvs export change-review-summary --from <snapshot-dir> --to <snapshot-dir>
                                 [--output <path>]
```

The same review as Markdown, for a person to paste into a pull request
themselves. Both commands read through one collector, so the summary cannot
disagree with the review it summarises. Neither posts anything.

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

## See also

[interactive-architecture.md](interactive-architecture.md),
[verified-preview.md](verified-preview.md),
[adaptive-detail.md](adaptive-detail.md),
[fidelity-receipts.md](fidelity-receipts.md),
[visual-grammar.md](visual-grammar.md),
[visual-intelligence.md](visual-intelligence.md),
[graph-impact-analysis.md](graph-impact-analysis.md),
[packaging.md](packaging.md).
