# Verified Preview & Delivery (Milestone 10.6)

`--verified` turns `rvs graph open` and `rvs graph review` from commands that
*write a file* into commands that **propose** one. The artifact they render is
staged somewhere else, measured against a named verification profile, and
allowed to replace what is already at `--output` only if every required check
passed. When anything fails — or when the machinery that does the measuring
cannot run at all — the file already at the target is left byte for byte as it
was, and a repair receipt says why.

This is not another renderer. Every drawing still comes from the command that
owns that surface; every check still comes from the validator that owns that
rule. What is new is the decision layer between them.

```
visual candidate
   └─ contract validation        @rvs/visual-intelligence
   └─ fidelity validation        @rvs/visual-intelligence
   └─ graph / reference          @rvs/visual-composition, @rvs/visual-change-review
   └─ layout validation          @rvs/validator   (browser)
   └─ accessibility validation   @rvs/visual-intelligence + @rvs/validator (browser)
   └─ interaction validation     @rvs/validator   (browser)
        │
        ├─ every required family passed → atomic replace of the target
        └─ anything else                → target preserved, repair receipt written
```

## The vocabulary

These six words mean six different things, and the whole design depends on not
confusing them.

| Term | Meaning |
| --- | --- |
| **generated** | A renderer produced HTML. Nothing has looked at it. |
| **candidate** | Generated output staged under `.rvs/cache/visual-delivery/runs/`, with an identity, a digest and a named profile it will be measured against. |
| **verified** | These exact bytes completed every required family of a named, versioned profile. Not "approved", not "signed off", not "safe to merge". |
| **promoted** | A verified candidate was atomically moved into the target path, and the target was re-hashed afterwards to prove it. |
| **last known good** | The most recent artifact that *completed the required verification profile and was atomically promoted to this target*. Not the newest file, not the newest commit, not the newest render. |
| **verification stale** | A verified artifact is unchanged, but the profile version or the effective configuration it passed under is no longer what would be asked today. Not failed, and never silently re-labelled current. |

"Verified" is the strongest word this layer uses, and it is a measurement, not
an organisational decision. Nothing in the output says *approved design*,
*certified architecture*, *safe architecture* or *merge-ready*, because none of
those are things a validator can measure.

## Using it

```
rvs graph open   --verified --output artifacts/visuals/architecture-explorer.html
rvs graph review --from .rvs/cache/snapshots/before --to .rvs/cache/snapshots/after \
                 --verified --output artifacts/visuals/change-review.html
```

`--profile <id>` picks the profile; without it each command uses its own
default (below). Without `--verified` neither command comes near this layer:
they render and write exactly as they always have. That compatibility is
deliberate — the gate is something you ask for, not something that changes what
an existing command means.

There is no `rvs visualize preview` and no `rvs visualize verify`. Two ways to
do the same thing would be two things to keep in agreement; the flag on the
command that already produces the artifact is the smaller surface, and it is
the one that exists.

### Success

```
Generated candidate vdc_9f2b1c0e5a47d3b8c6104f2e (generation 12).
Ran 63 checks across 7 validator families under visual-interactive-v2.
Promoted verified artifact to artifacts/visuals/architecture-explorer.html.
Report: .rvs/cache/visual-delivery/runs/run-000012/visual-verification-report.json
Preview: Verified — file:///…/artifacts/visuals/architecture-explorer.html
```

### Rejection

```
Generated candidate vdc_41a0e77c9b2f5d6183ae02cc (generation 13).
Ran 63 checks across 7 validator families under visual-interactive-v2.
3 blocking findings; candidate not promoted.
Last known good preserved: artifacts/visuals/architecture-explorer.html (vva_5c81…).
Receipt: .rvs/cache/visual-delivery/runs/run-000013/repair-receipt.json
Report: .rvs/cache/visual-delivery/runs/run-000013/visual-verification-report.json
Preview: Last known good retained — file:///…/artifacts/visuals/architecture-explorer.html
```

The command exits non-zero when nothing was promoted. A gate that exits zero on
rejection is a gate nobody notices. Full detail stays in the JSON; stdout stays
readable.

## Preview is a file, not a server

There is no HTTP server, no bound port, no watch mode and no background
process. This is a decision, not an omission.

The artifacts are single self-contained HTML files: every style, script and
glyph is inside them, they carry a Content-Security-Policy that forbids loading
anything, and they open from `file://` with the network unplugged. A local
server would add a bound port, a lifetime to manage, a process that can outlive
the command that started it, and a second route for repository content to leave
the machine — in exchange for showing the same bytes the filesystem already
shows. So preview is a path, a URL, and one honest sentence about what the
reader is looking at.

The four things a reader can be told, and only these four:

| Status | Means |
| --- | --- |
| `Verified` | This run promoted; the target holds the artifact you just generated. |
| `Candidate validating` | Measurement is in progress. |
| `Candidate rejected` | The candidate failed and there is nothing at the target. |
| `Last known good retained` | The candidate did not promote; what is at the target is an earlier verified artifact, not your edit. |

The last distinction is the one worth having. A reader who was told "verified"
while looking at last week's file would believe their change is on screen.

**Because nothing runs in the background, there is no generation race to
protect against inside a single command.** Concurrency is still handled, and it
is handled where it actually exists: two `rvs` processes against one repository.
Run numbers are claimed with `mkdir`, which is atomic — exactly one of two
racing processes gets `run-000042` and the other gets `EEXIST` and takes 43 —
and promotion refuses any candidate whose generation is not greater than the
generation currently recorded at the target. So if candidate 42 finishes after
candidate 43 has already promoted, 42 cannot replace it *even if 42 passes*.
A counter file read-then-written would hand both processes the same number,
which is precisely the case this is built to make impossible.

## Staging, promotion and preservation

```
.rvs/cache/visual-delivery/
├── runs/
│   └── run-000012/
│       ├── candidate.html                       (removed on promotion, kept on rejection)
│       ├── visual-verification-report.json      (always)
│       ├── repair-receipt.json                  (only when nothing was promoted)
│       └── repair-receipt.md                    (the same receipt, for a person)
└── targets/
    └── <target-key>/verified.json               (current + up to 5 previous, metadata only)
```

All of it is under `.rvs/cache/`, which is git-ignored. No candidate directory,
verified record or receipt is ever tracked.

**Staging.** A candidate is written somewhere that is not the target, and it is
written completely before anything looks at it. Both halves matter: generating
into the target and validating afterwards means a failed validation has already
destroyed the artifact it was supposed to protect, and validating a file that is
still being written means measuring a document nobody generated — half an HTML
file parses. Writes go to a `.partial` name and are renamed into place, so a
reader of the staging directory never sees a half-written candidate.

**Promotion.** Copy the verified candidate to a uniquely-named temporary file
*beside the target*, `rename()` it over the target, then re-hash the target from
disk and compare it against the candidate digest. The target is never opened for
truncation, so no failure can leave it half-replaced. Promotion refuses —
before touching a single byte — when the result is not `passed`, when the staged
file no longer hashes to what was verified, when the candidate's generation is
not newer than the target's, or when the target resolves outside the repository.

**Preservation.** On any refusal the target is not opened at all. The proof is
byte-level: `digest(target before) == digest(target after)`, taken from the
file, not from DOM equivalence.

**Retention.** Eight run directories, five previous verified records, metadata
only. No artifact bytes are kept in the verified history — an unbounded pile of
HTML in a cache directory is a different kind of defect.

## Profiles

A profile is a **named, versioned, closed** set of validator families plus the
configuration they run under. Closed is the important word: callers pick a
profile by name and cannot supply validator code, a rule expression, or a
threshold of their own. A gate whose strictness the thing being gated can
choose is not a gate.

| Profile | Families | Browser |
| --- | --- | --- |
| `visual-standard-v1` | schema, fidelity, reference, accessibility | no |
| `visual-interactive-v2` *(default for `graph open`)* | schema, fidelity, reference, layout, accessibility, interaction, motion | yes |
| `visual-change-review-v2` *(default for `graph review`)* | schema, fidelity, reference, layout, accessibility, interaction, motion | yes |
| `visual-print-v1` | schema, fidelity, reference, layout, typography, contrast | yes |

`standard` exists so a machine with no browser can still verify everything a
browser is not needed for — and say plainly that it did not verify the rest.
`interactive` and `change-review` share a family list and differ in identity: a
change review carries governance and decision overlays and a comparison motion
mode, and a reader of a verified record needs to know which surface was
measured. `print` drops interaction and motion, which do not exist on a page
nobody can click.

Changing what a profile checks means minting the next version, never editing
this one. A verified artifact records the profile id it passed, so "verified"
always answers "verified against what".

### Verification digest

```
verification_digest = SHA-256 over
    schema version
  + artifact digest              (the candidate's bytes)
  + visual spec id + source digest
  + artifact type + target path
  + profile id, version, family list, browser requirement, warning policy
  + the effective config digest  (minimum font size, contrast level, render scale)
  + the semantic version of every validator the profile's families use
```

No wall-clock component. Two runs over identical candidate bytes under
identical rules produce an identical digest; a digest that changed means a rule
changed. The verified artifact's own id is derived from it, so two machines
that verified the same bytes under the same rules agree on the name — and
`verified_at` is recorded but is never identity.

The validator versions in that digest are *semantic* versions of each check as
this layer orchestrates it, not package versions: every workspace package reads
`0.1.0`, which would make the digest blind to exactly the change it exists to
notice. Bumping one is the deliberate act that turns every verification made
under the old behaviour into `stale`.

### Stale, not current and not failed

A verified record whose profile version or configuration digest no longer
matches what would be asked today is **stale**. It still says truthfully what
it passed; what it passed is no longer the question. It is not re-labelled
verified, and the historical truth — "last known good under
`visual-interactive-v1`" — is not discarded because a v2 exists.

## The four verification states

| State | Means | May promote |
| --- | --- | --- |
| `passed` | Every required family ran and none raised a blocking finding. | **yes** |
| `failed` | A required family ran and found the artifact wanting. | no |
| `incomplete` | A required family could not be run. Nothing is claimed about the artifact. | no |
| `stale` | A previously passing artifact, under rules that have since changed. | no |

Only `passed` promotes. There is no override.

Keeping `incomplete` distinct from `failed` is the point of having four states.
When Chromium cannot start, the honest report is *browser verification
unavailable; candidate not promoted; last known good preserved* — with the
finding code `VISUAL_VERIFICATION_BROWSER_UNAVAILABLE` and the repair
`install-browser-runtime`, which is a repair to the machine and deliberately
not one of the ten visual repairs. Calling that a visual failure would blame
the drawing for the machine, and promoting because validation did not finish
would be the worst answer of the three. A browser check that hangs times out
(120s by default) and produces `incomplete` for the same reason.

Warning-severity findings do not block, because the validators that own those
rules already decided which of their findings block. The delivery layer
re-grades nothing.

## What the gate actually catches

Every finding below was raised by a check that already existed and already
owned its rule. This layer runs them, collects what comes back without
re-grading it, and puts the answer in one shape a receipt can render. A
finding's code, subject and severity leave verification exactly as they arrived
— including entity ids, evidence refs, governance severity, decision state and
fidelity information, all of which are asserted to survive delivery unchanged.

| Family | Owner | Examples |
| --- | --- | --- |
| schema | `@rvs/visual-intelligence` | grammar/intent mismatch, invalid detail mode |
| fidelity | `@rvs/visual-intelligence` | `VISUAL_FIDELITY_CRITICAL_PATH_LOST`, entity lost, receipt invalid |
| reference | `@rvs/visual-composition`, `@rvs/visual-change-review` | unaccounted entity, dangling change, missing baseline |
| layout | `@rvs/validator` (browser) | `rendered:overflow`, `rendered:node-overlap` |
| typography / contrast | `@rvs/visual-intelligence` + `@rvs/validator` | type below the legible floor, contrast under AA |
| accessibility | `@rvs/visual-intelligence` + `@rvs/validator` | missing accessible name, colour-only state, focus not visible |
| interaction | `@rvs/validator` (browser) | duplicate DOM id, unresolved `aria-labelledby`, unnamed or unreachable control |
| motion | `@rvs/visual-intelligence` | unknown motion target, information carried only by animation, missing reduced-motion fallback |

**Motion.** A static artifact is a valid artifact. No plan means nothing
claimed to move, which is a complete answer to "is the motion trustworthy" and
not a gap — so the family passes having run no checks, and says so rather than
reporting a clean count it did not earn. `rvs graph open` draws a static
surface and legitimately runs zero motion checks; `rvs graph review` builds the
compare sequence and runs real ones. Motion only fails when motion was
requested and is invalid.

**The duplicate DOM id guard.** The defect Milestone 10.5's packaging slice
found — one spec producing several views, every view minting the same `-title`,
`-desc` and `-arrow-*` ids, so each detail view was announced with the
overview's name while its own was unreachable — is now a delivery gate. A
candidate carrying duplicate meaningful DOM ids does not promote.

### A note on the layout family

`rendered:overflow` measures whether a fixed-frame scene holds its content, and
it is emitted only for scenes that declare a `.scene-inner`. The explorer and
the change review deliberately do not: they scroll, and failing them for
scrolling would be the checker being wrong rather than the page. That left the
layout family reporting "passed" over **zero** measurements on exactly the two
surfaces this milestone delivers — which is not a pass, it is an absence.

So `@rvs/validator` gained a second layout rule, in the package that owns
layout rather than hidden inside the delivery layer: **`node-overlap`**, which
measures the invariant every grammar in `@rvs/visual-grammar` is built to hold
and none of them states in its output — two entity boxes never occupy the same
place. It compares the painted rectangle of each `[data-rvs-node]` within one
`<svg>` root (two views of a multi-view composition sharing the viewport is the
layout working, not failing; a change marker hung off a corner is not a
collision), with a two-pixel tolerance so a shared border and a pixel of
viewBox rounding are not defects. `rvs validate --ci` treats it exactly like
overflow, under the same `fail_on_overflow` flag: both rules answer the same
question — did the drawing fit where it was put.

The rule was added inside the milestone that mints the `v1` profiles, so no
verification exists that was made under the earlier behaviour, and
`@rvs/validator:validateHtmlFile` stays at semantic version `1`.

## Repair receipts

Rejection writes `repair-receipt.json` (machine-readable, mandatory) and
`repair-receipt.md` (the same content, for a person). A receipt carries the
candidate id and digest, the verification status, every finding, whether the
target was preserved, the last-known-good id, the target digest, the generation
metadata, and where the rejected candidate was left so it can be opened and
looked at.

It is not a stack trace. A stack trace says where the code was; a receipt says
which invariant the artifact missed, on which subject, by how much, and what
class of change would satisfy it. Finding ids and codes are the owning
validator's — this layer mints no parallel vocabulary, so grepping
`VISUAL_A11Y_CONTRAST_INSUFFICIENT` finds both the receipt and the check.

The eleven repair categories: `reroute`, `move-label`, `increase-spacing`,
`split-view`, `reduce-detail`, `restore-anchor`, `fix-contrast`,
`increase-font-size`, `add-accessible-name`, `add-non-color-state-cue`,
`resolve-reference`.

They are **categories, not instructions**, and nothing executes them. "Increase
spacing" names no file, token or number, because the validator that raised the
finding knows the invariant and not the fix. Some codes map to no repair at
all — a non-deterministic tab order has no category among the eleven, and
offering a wrong one would be worse than offering none. There is no auto-fix, no
regeneration loop, and no autonomous repair anywhere in this layer: acting on a
receipt is a separate, separately-authorised implementation task.

Ordering is deterministic — severity, then family, then code, then subject id,
then finding id — so shuffling the order findings arrive in changes nothing
about what the receipt says or how it reads.

## Security

- **Candidates and configuration are untrusted.** No `eval`, no `new Function`,
  no unsafe `innerHTML`, no remote script or stylesheet, no arbitrary CSS, no
  shell execution from a candidate. Preview never executes repository source;
  it opens the generated viewer runtime RVS already ships inside the artifact.
- **Containment.** Staging paths must resolve inside
  `.rvs/cache/visual-delivery/`, and targets inside the repository. `../../`
  traversal and an absolute path outside the root are refused before anything
  is written. Containment is checked on the *real* path, so a symlink cannot be
  used to escape either root.
- **No network.** Verification and preview run with the network unplugged and
  are proved to under a hard socket block: `net.Socket.prototype.connect`,
  `net.connect`, `net.createConnection`, `http`/`https` `request`/`get` and
  `globalThis.fetch` all throw, and the packaged CLI still verifies and
  promotes identically. No remote fonts, no CDNs, no telemetry. (Chromium
  itself launches over a pipe, not a socket, so the full interactive profile
  runs under that block.)
- **No Git, no PR, no deployment.** This layer commits nothing, pushes nothing,
  comments on nothing, approves nothing and deploys nothing.
- **No post-verification mutation.** Once an artifact digest is verified, its
  bytes are not altered before promotion. The promoted file is byte-identical
  to the candidate that was measured, and to the file the ordinary command
  writes without `--verified` — the gate decides whether to publish; it has no
  renderer of its own.

## Determinism and packaged equivalence

Five runs over identical candidate bytes produce the same status, the same
findings in the same order, the same verification digest and the same receipt
content. The source CLI and the CLI installed from a real `pnpm pack` tarball
outside the workspace agree on all of it: candidate identity, verification
profile, verification digest, findings, repair receipt, promotion state,
promoted target bytes and last-known-good metadata — including through an
install path containing spaces, and with the network hard-blocked. Only the
clock and Playwright's browser-build string are normalised away, each with its
reason stated at the comparison.

`@rvs/visual-delivery` is bundled into `dist/bin.cjs` like every other internal
package and appears nowhere in the packed manifest's runtime `dependencies`;
see [`docs/packaging.md`](packaging.md).

### Why the packaged proof rejects on infrastructure

The end-to-end acceptance proof runs V1 → V2 → V3 against one target: a valid
candidate promotes, an invalid one is refused with V1's bytes surviving
exactly, and a corrected one promotes. At source level the middle stage is a
content rejection, proved separately for layout, fidelity, accessibility and
interaction against **real validator output on real rendered artifacts** —
never a forged finding.

Through the *installed CLI* the middle stage is an infrastructure refusal, and
that is a fact about the system rather than a gap in the proof: there is no way
to hand `rvs` an invalid candidate. It verifies only what its own renderers
have just produced, and those renderers are themselves guarded — the degradation
policy never drops a critical path (`VISUAL_PRESERVE_PRIMARY_PATH`) or an
unresolved reference (`VISUAL_PRESERVE_UNRESOLVED`), and the renderer grows its
frame to fit rather than shrinking type below the legible floor. No valid
repository content can drive a generated candidate into a content rejection.
That is the visual system working. The packaged proof therefore exercises the
refusal path the packaged CLI can genuinely reach, and the content rejections
are proved where the candidate can be controlled.

## Known limitations

Deliberately not built, and not worked around: a generalised rollback UI (the
verified record reveals the current and previous verified artifacts; nothing
rolls back automatically on a later failure), remote preview sharing, automatic
repair, multi-user review, cloud artifact hosting, screenshot approval, and
visual-diff approval workflows. Delivery covers HTML; nothing here is a
generalised artifact-deployment mechanism.
