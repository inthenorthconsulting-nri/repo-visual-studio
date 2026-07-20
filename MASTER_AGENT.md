# Master Agent — Routing and Operating Authority

This document is the canonical entry point for any agent (Claude Code,
Cursor, Codex, or a similar repository agent) working in
`repo-visual-studio`. It answers, in order: what kind of task is this, which
RVS intelligence layer (if any) does it need, is a branch or PR required,
what must be validated before editing, what write actions need explicit
authorization, which skill to load, and what a completion report must
contain.

It is deliberately short. Procedures, examples, and full policy text live in
the referenced skills and `docs/*.md` files — this document routes to them,
it does not restate them.

**Precedence** (highest first): explicit user instruction → repository
security/safety rules → this document → the task-specific skill it selects
→ that skill's supporting reference → general documentation. Tool-specific
adapter files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) point back here and
must not duplicate or override the rules below. Where an existing
instruction conflicts with this document, report the conflict and resolve
it toward the more conservative (less destructive, less presumptive of
authorization) reading.

---

## 1. Non-negotiable principles

### 1.1 Evidence before action

Before modifying code, an agent must:

1. Inspect repository status (`git status --short`).
2. Identify the repository root.
3. Read applicable instructions (this document, the repository-local
   `docs/*.md`, any relevant `SKILL.md`).
4. Determine the current branch (`git branch --show-current`).
5. Determine the branch's relationship to its expected base
   (`git rev-list --left-right --count <base>...HEAD`).
6. Identify uncommitted changes and who they likely belong to.
7. Classify the task (§2).
8. Select only the intelligence workflow the task actually requires (§3).
9. Inspect the relevant source files and their tests before editing.
10. State any material uncertainty rather than guessing past it.

Never infer architecture, capabilities, product purpose, or portfolio
relationships where an RVS artifact (`repository-model.json`,
`architecture-intelligence.json`, `capability-model.json`,
`product-identity.json`, `portfolio-model.json`) can establish the answer
from evidence instead.

### 1.2 Minimum necessary intelligence

Run only the intelligence layer(s) a task needs — never the full stack by
default. See the routing table in §3 and the matrix in §4. A one-line bug
fix does not need Architecture Intelligence; a portfolio comparison does not
need to rescan every repository from zero when compatible artifacts already
exist (§5).

### 1.3 No hidden write actions

These actions always require **explicit, current-turn** user authorization
— a prior authorization for one does not carry to the next:

- Creating a commit · Amending a commit · Rebasing · Resetting
- Force-pushing · Pushing a branch
- Opening a PR · Updating an existing PR's base/title in a way that changes
  its scope · Merging a PR
- Deleting a branch · Creating a release · Publishing a package
- Modifying CI secrets · Changing repository settings

Concretely: a request to *implement* code does not authorize committing it.
A request to *commit* does not authorize pushing it. A request to *push*
does not authorize opening a PR. A request to *open a PR* does not
authorize merging it. Each boundary is crossed only on its own explicit
instruction.

### 1.4 Preserve unrelated work

Never overwrite, discard, reset, stage, commit, or reformat changes the
current task didn't create. When the working tree is already dirty at task
start:

- Identify which changes pre-existed the task.
- Keep the task's own changes scoped and separable.
- Never fold pre-existing changes into the task's commit.
- Stop before any destructive operation and report the conflict instead of
  resolving it unilaterally.

### 1.5 Honest completion

Never report: tests as passing when they were not run; packaged behavior as
verified when only source tests ran; PDF/export correctness when only file
existence was checked; determinism when only one run was performed; a clean
working tree without checking it; a branch as pushed without confirming the
remote; a PR as open without retrieving its actual state via `gh pr view`
or equivalent.

---

## 2. Task classification router

Classify every incoming request into exactly one primary class before
acting (a request may touch more than one class in sequence — e.g.
implement, then later address review feedback — but classify each turn's
actual ask).

| # | Class | Example asks | Required route |
|---|---|---|---|
| 2.1 | Repository orientation | "What does this repo do?", "Explain the architecture", "Where is X implemented?" | Repository inspection → Architecture Intelligence |
| 2.2 | Capability analysis | "What can this do?", "Which capabilities are partial?", "What gaps exist?" | Architecture Intelligence → Capability Intelligence |
| 2.3 | Product identity / executive narrative | "Create a product overview", "Build an executive deck", "What differentiates this repo?" | Architecture Intelligence → Capability Intelligence → Product Identity Intelligence → Executive Narrative → Showcase Plan (all claims pass claim control) |
| 2.4 | Portfolio analysis | "Compare these products", "Where do capabilities overlap?", "Build an ecosystem deck" | Validate existing product artifacts → Portfolio Intelligence → Portfolio Narrative → Portfolio Plan |
| 2.5 | Code implementation | "Add a feature", "Fix a defect", "Refactor X", "Add a CLI command" | Repository inspection → load the implementation-relevant skill → inspect code/tests → task branch (if new task, §6) → implement → validate |
| 2.6 | CI / test failure | "Fix the failing Action", "Diagnose test failures", "Resolve TS errors" | Inspect branch/tree → inspect the failing check or logs → reproduce locally → minimal correction → targeted tests → required broader validation |
| 2.7 | Documentation task | "Update the README", "Document a feature", "Correct stale commands" | Inspect implementation → verify commands/contracts against source → update docs → run documentation/link validation where it exists |
| 2.8 | Repository maintenance | "Remove dead code", "Review dependencies", "Clean stale artifacts", "Prepare a release" | Load `repository-maintenance` skill → relevant maintenance sub-workflow (§9) |
| 2.9 | PR review / review feedback | "Review this PR", "Address review comments", "Is this safe to merge?" | Load `pr-governance` skill → read PR context/diff → inspect unresolved comments/checks → validate findings → apply only authorized fixes → re-run validation |
| 2.10 | Governance / continuous intelligence | "What changed architecturally between the last release and now?", "Is this PR a CI-blocking regression?", "Explain this governance finding" | Validate/build `IntelligenceSnapshot`s → Governance Intelligence (`rvs governance compare`/`check`/`explain`) → findings/report — diagnosis only, never a code fix |

Class-specific rules:

- **2.2** — do not route directly to Capability Intelligence if the
  required Architecture Intelligence artifact is missing or stale; regenerate
  it first (§5).
- **2.4** — do not rescan every repository when compatible product artifacts
  already exist; do not invent a relationship from a shared vendor or
  platform name alone (portfolio evidence rules live in
  `docs/portfolio-intelligence.md`).
- **2.5** — run Architecture Intelligence only when repository orientation
  is materially needed for the change; do not run Product or Portfolio
  Intelligence for ordinary code implementation.
- **2.6** — no intelligence synthesis is required unless the failure itself
  involves a generated intelligence artifact (e.g. a stale
  `capability-model.json` breaking `rvs validate --ci`).
- **2.7** — derive documentation from inspecting the implementation, not
  from remembered prose, whenever the implementation can be inspected
  directly.
- **2.9** — do not open a new PR when the actual task is to update an
  existing one (see `skills/pr-governance/references/task-boundaries.md`).
- **2.10** — Governance Intelligence never re-scans a repository and never
  calls an external model; it only reads already-cached
  `IntelligenceSnapshot`s and the artifacts the other four layers already
  produced (§3, §4). A request to *fix* what a governance finding surfaced
  is a separate Code implementation task (§2.5), routed through
  `pr-governance` and the relevant code-owning skill — Governance
  Intelligence itself never modifies code.

---

## 3. Intelligence routing matrix

| User intent | Architecture Intelligence | Capability Intelligence | Product Intelligence | Portfolio Intelligence | Governance Intelligence |
|---|---|---|---|---|---|
| Explain repository structure | Required | No | No | No | No |
| Identify implemented capabilities | Required | Required | No | No | No |
| Create a product showcase | Required | Required | Required | No | No |
| Compare products | Artifact validation only | Artifact validation only | Required as input | Required | No |
| Fix a code defect | Optional (only if orientation is needed) | No | No | No | No |
| Review a CI failure | No, unless the failure touches a generated artifact | No | No | No | No |
| Update the README | Optional | Optional | No | No | No |
| Build a portfolio executive deck | Inputs only | Inputs only | Required as input | Required | No |
| What changed architecturally between two states | Cached snapshot input only | Cached snapshot input only | Cached snapshot input only | Cached snapshot input only, opt-in | Required |
| Is this PR/change a CI-blocking regression | Cached snapshot input only | Cached snapshot input only | Cached snapshot input only | Cached snapshot input only, opt-in | Required |
| Explain a governance finding or report | No | No | No | No | Required |

"Artifact validation only" and "Inputs only" mean: read and structurally
validate the already-generated artifact; do not re-synthesize it from
scratch. See §5 for exactly when regeneration is warranted instead.
"Cached snapshot input only" means the same thing one layer further up:
Governance Intelligence never re-derives architecture, capability, product,
or portfolio state itself — it reads the `IntelligenceSnapshot` fingerprint
those layers' already-cached artifacts were reduced to
(`rvs snapshot create`) and never re-scans source or calls an external
model (`docs/architecture-governance.md`).

Full per-layer usage detail, prerequisites, and CLI commands are in
`skills/repo-visual-studio/references/intelligence-routing.md` and the
per-layer reference files it points to.

---

## 4. Artifact freshness and reuse

**Prefer reuse** of an already-generated artifact when all of the following
hold: its schema is supported by the current tooling; repository identity
matches; the commit identity matches or a mismatch has been intentionally
accepted; required upstream digests match; the artifact is structurally
valid (passes its validator with no `error`-severity warnings); and the
user has not asked for a fresh scan.

**Regenerate** the upstream intelligence artifact when any of: the artifact
is missing; it is stale relative to the relevant commit; its schema version
is incompatible with current tooling; repository identity mismatches; a
required evidence field is incomplete or absent; or the user explicitly
asks for fresh analysis.

Never regenerate portfolio inputs (`capability-model.json`,
`product-identity.json` for every product) merely because the portfolio
step is about to run — regenerate only the specific product artifact(s)
that actually fail the freshness check above.

The same rule applies one layer further up for Governance Intelligence:
prefer an existing `IntelligenceSnapshot`/baseline
(`rvs governance baseline show`) over building a new one with
`rvs snapshot create`, and never rebuild a snapshot merely because a
comparison is about to run — rebuild only the specific upstream artifact
that actually fails the freshness check, then re-snapshot.

---

## 5. Skill routing rules

Load the smallest applicable set of skills — never all three by default.

| Situation | Skill(s) to load |
|---|---|
| Architecture / capability / product / portfolio question or generation task | `repo-visual-studio` → the matching reference under `skills/repo-visual-studio/references/` |
| New implementation task (feature, fix, refactor, CLI addition) | `pr-governance` (branch/commit boundary) → whatever package-local convention applies to the code being touched |
| PR review or review-feedback task | `pr-governance` → `references/review-policy.md` |
| Repository cleanup, dependency review, doc/test maintenance, release prep | `repository-maintenance` → the matching reference, plus `pr-governance` once a branch/PR is needed for the resulting change |
| Portfolio presentation / export | `repo-visual-studio` → `references/portfolio-intelligence.md` + `references/presentation-and-export.md` |
| Governance / continuous-intelligence question (what changed, CI-blocking regression, explain a finding) | No dedicated skill yet — read `docs/architecture-governance.md` and `docs/continuous-intelligence.md` directly, then use the CLI surface they document (`rvs snapshot create`; `rvs governance baseline show\|set\|validate`; `rvs governance compare`/`check`/`explain`; `rvs export governance-report`/`governance-summary`) |

---

## 6. Task startup protocol

For every repository task, in order:

1. Read this document.
2. Read repository-local instructions (`AGENTS.md`/`CLAUDE.md` adapters,
   any `docs/*.md` directly relevant to the request).
3. Inspect `git status --short` and the current branch.
4. Determine the task class (§2).
5. Determine whether this is a **new task** or a **continuation** of
   existing, in-flight work (`skills/pr-governance/references/task-boundaries.md`).
6. Select the required skill reference(s) (§5).
7. Determine the required intelligence layer, if any (§3, §4).
8. Establish write authorization for the turn (§1.3) — read-only by
   default.
9. Establish commit/push/PR authorization for the turn (§1.3) — none by
   default.
10. Inspect the relevant implementation and its tests before editing.
11. State the execution boundary: what will and will not happen this turn.
12. Perform the task.

Do not re-ask questions the repository state or the user's own instructions
already answer. Where a safe assumption can be made, make it explicitly (say
what you assumed and why) and proceed rather than stalling on it.

---

## 7. Task completion protocol

Every completion report includes:

Task classification · Skill(s) used · Intelligence layer(s) used · Branch ·
Base branch and base commit · HEAD · Working-tree state · Files changed ·
Files created · Tests run · Tests passed/failed/skipped · Package/runtime
verification (or "not applicable/not run" — never implied) · Known
limitations · Unrelated findings (not implemented, just recorded) · Commit
status · Push status · PR status · Recommended next authorized action.

For a read-only task, state plainly that no files were modified. For
partial execution, separate **Completed** from **Blocked**, **Not
attempted**, and **Out of scope** — do not blur these into a single
"done."

---

## 8. Agent handoff record

For work that spans turns or agents, produce a handoff in this shape:

```
## Task
## Scope
## Branch and base
## Current state
## Completed
## Remaining
## Validation
## Decisions made
## Known risks
## Unrelated findings
## Authorization state
## Exact next action
```

No hidden reasoning, no speculative claims — only what's verified and what
a different agent would need to safely continue without re-deriving it.

---

## 9. Pointers to full policy

This document routes; it does not restate. For the full procedure, read:

- **PR governance** (branch/commit/PR/review/merge policy, one-task-per-
  branch enforcement): `skills/pr-governance/SKILL.md` and its
  `references/`; narrative version at `docs/pr-governance.md`.
- **Repository maintenance** (health review, dependencies, docs, tests,
  dead code, release readiness): `skills/repository-maintenance/SKILL.md`
  and its `references/`; narrative version at
  `docs/repository-maintenance.md`.
- **RVS intelligence workflows** (architecture/capability/product/
  portfolio synthesis, presentation, export):
  `skills/repo-visual-studio/SKILL.md` and its `references/`; deep
  technical detail in `docs/architecture-intelligence.md`,
  `docs/capability-intelligence.md`, `docs/product-identity-intelligence.md`,
  `docs/portfolio-intelligence.md`, `docs/portfolio-showcase.md`.
- **Architecture governance and continuous intelligence** (comparison of
  two `IntelligenceSnapshot`s, policy findings, CI gating; no dedicated
  skill file yet, read these directly): `docs/architecture-governance.md`
  and `docs/continuous-intelligence.md`.
- **Why this operating model exists, and the reasoning behind §1-§8**:
  `docs/agent-operating-model.md`.

---

## 10. Safety and destructive-operation policy

The following require a clearly stated need, explicit user authorization
**for that specific command**, a stated recovery plan, and verification of
the affected scope before running — they are never run "to get to a clean
state" as a shortcut:

```
git reset --hard
git clean -fd
git push --force
git push --force-with-lease
git branch -D
git rebase
git commit --amend
git checkout -- .
git restore .
rm -rf
```

This is not a permanent prohibition — it is a higher bar. Prefer
non-destructive inspection (`git status`, `git diff`, `git stash`, `git log
--oneline`) and targeted restoration over any command above. Before any
command that could discard uncommitted work, run `git status --short`
first and stash (`git stash -u`) or otherwise preserve anything found.

---

## 11. Worked examples

**A — Explain architecture.** *"Explain how RVS discovers workflows."*
Read this document → load `repo-visual-studio` skill → use Architecture
Intelligence only → produce an evidence-backed explanation with citations →
no branch needed, this is read-only.

**B — Add a CLI command.** *"Add a command to export architecture
decisions."* Classify as new implementation (§2.5) → load `pr-governance`
skill → per §6 of that skill, a new task branch may be created locally from
the expected base once the tree is clean and the base is known → inspect
the relevant CLI/package contracts → implement and test → do not commit,
push, or open a PR without separate, explicit authorization for each.

**C — Fix review feedback.** *"Address the comments on the open PR."*
Classify as existing-task continuation (§2.9) → stay on the PR's branch →
read the unresolved comments → apply only the fixes those comments actually
call for → add follow-up commits once authorized → do not open another PR.

**D — Compare repositories.** *"Show capability overlaps across Product A,
B, and C."* Validate each product's existing artifacts → regenerate only
the ones that fail the freshness check (§4) → run Portfolio Intelligence →
apply portfolio claim control → build the portfolio presentation only if
asked.

**E — Upgrade dependencies.** *"Upgrade the major dependencies."* Classify
as repository maintenance (§2.8) → this is a new, independently reviewable
task, so it gets its own branch and its own PR, never folded into whatever
branch happens to be checked out → inventory versions and breaking changes
→ split unrelated major upgrades where appropriate → validate build,
package, and runtime behavior → do not publish anything automatically.

**F — What changed architecturally.** *"What changed architecturally
between the last release and now?"* Classify as governance / continuous
intelligence (§2.10) → read `docs/architecture-governance.md` → confirm a
baseline is configured (`rvs governance baseline show`) or establish one
(`rvs snapshot create`, `rvs governance baseline set <snapshot>`) → run
`rvs governance compare` to diff the baseline against the current state →
report findings from the cached `governance-report.json` (and blast-radius/
compatibility status) with citations, using `rvs governance explain <id>`
for any specific change or finding → no branch needed, this is read-only —
Governance Intelligence never re-scans the repository itself.

**G — Is this PR a CI-blocking regression, then fix it.** *"Is this PR a
CI-blocking regression? If so, fix it."* Two classes in one request, handled
in order. First, governance / continuous intelligence (§2.10): run `rvs
governance check --ci` against the configured baseline and report the exact
fail count and severities from its output — never guess at "blocking"
status. Second, only if a real blocking finding exists and a fix is
actually requested: reclassify as code implementation (§2.5), load
`pr-governance` plus whatever skill owns the affected code, and treat it as
a new, separately authorized task branch — Governance Intelligence
diagnoses the regression, it never edits code itself (per
`docs/architecture-governance.md`'s package summary: snapshotting,
diffing, compatibility/blast-radius assessment, policy evaluation,
narrative/plan synthesis — no code-modification capability anywhere in its
command surface).
