# Agent Operating Model (Milestone 6.2, part 1)

This document explains why `MASTER_AGENT.md` exists and the reasoning
behind its rules. `MASTER_AGENT.md` itself stays short and prescriptive on
purpose — read it for the actual routing table and policy text. This
document is the narrative version: the "why," not a restatement of the
"what."

## Why a master agent document

Prior milestones each added an intelligence layer — Architecture (3),
Capability (4), Product Identity and Executive Showcase (5), Portfolio (6)
— without a single document telling an agent which layer a given request
actually needs. Left unrouted, the default failure mode is either
under-running (skipping a layer whose evidence the task actually needed) or
over-running (synthesizing the full stack for a one-line bug fix, burning
time and risking stale-artifact confusion). `MASTER_AGENT.md` exists to make
that decision deterministic instead of re-derived from scratch, differently,
by every agent on every task.

Milestone 6.2 adds no new intelligence layer. It adds the operating layer
that decides *when* to use the ones that already exist, and it adds the
governance layer that was previously implicit and inconsistently applied:
one task per branch and PR, and an explicit authorization boundary at each
Git publication step.

## How routing works

`MASTER_AGENT.md` §2 classifies every request into one of nine task
classes (repository orientation, capability analysis, product identity,
portfolio analysis, code implementation, CI/test failure, documentation,
repository maintenance, PR review). Each class has a required route — a
fixed sequence of "load this skill, use this intelligence layer, do not use
that one." §3's matrix restates the same information the other direction,
by intelligence layer, so a request that doesn't cleanly match one of the
nine examples can still be checked against what each layer is actually for.

Classification happens once per turn's actual ask, not once per
conversation — a task can start as "implement X" (class 2.5) and later
become "address review feedback on X" (class 2.9); each is classified on
its own terms when it arrives.

## Intelligence selection

The core discipline is §1.2: minimum necessary intelligence. Every layer
after Architecture Intelligence is strictly additive evidence over the
layer below it — Capability Intelligence cannot produce a more-informed
answer than Architecture Intelligence gave it, so running Capability
Intelligence without fresh Architecture Intelligence underneath it produces
an answer that's confidently wrong rather than usefully partial. That's why
§2.2 explicitly forbids routing directly to Capability Intelligence when
the upstream artifact is missing or stale, rather than treating the
omission as an edge case.

The freshness/reuse rule (§4) exists for the opposite failure mode: without
it, every portfolio request would re-synthesize every product from scratch,
which is slow, and worse, silently discards the "no new repository
scanning" invariant the Portfolio Intelligence engine was built around
(`docs/portfolio-intelligence.md`). Reuse is the default; regeneration is
the exception, triggered by a specific, checkable staleness condition — not
by "it's been a while."

## Authorization boundaries

§1.3's four boundaries (commit, push, PR, merge) map directly onto
`skills/pr-governance/SKILL.md`. The reasoning is the same principle
applied to Git state as to intelligence layers: an authorization for one
step is evidence about that step alone, not a blanket grant. A user who
says "commit this" has made a decision about the commit; they have not, by
that sentence, also decided the PR should exist, what its title should
say, or that now is the right time to make the branch visible to
collaborators. Collapsing those into one authorization removes the user's
ability to stop between them — which is the entire value of having
separate boundaries in the first place.

## Task startup and completion

§6 and §7 exist so that "did the agent actually check, or did it assume"
is answerable from the completion report alone, without re-deriving it from
the transcript. A completion report that says "tests passed" without having
run them, or "branch pushed" without confirming the remote, is a bug in the
report — §1.5 names this directly as a category of failure to avoid, not
just a style preference.

## Handoffs

Long-running or multi-agent work needs a record that lets a different agent
continue safely without re-deriving context, and without inheriting
unverified claims as if they were established fact. §8's handoff shape
separates "Completed" (verified) from "Remaining," "Decisions made" from
"Known risks," and requires an "Exact next action" — a handoff that ends in
a vague "continue from here" forces the next agent to re-derive state that
should already be captured.

## Tool adapters

`AGENTS.md`, `CLAUDE.md`, and `.cursorrules` at the repository root are
thin — each points back to `MASTER_AGENT.md` rather than restating its
rules. This avoids the two failure modes duplication invites: drift (the
copies disagree after the next edit) and precedence ambiguity (which copy
wins when they do). `MASTER_AGENT.md` §0's precedence order is the single
source of truth for resolving any apparent conflict between these files.

## What this milestone deliberately does not add

Per its own scope boundary: no architecture-drift detection, no continuous
repository monitoring, no scheduled portfolio synthesis, no automated PR
approval or merging, no GitHub organization scanning, no external LLM call
anywhere in the routing or governance logic, and no Milestone 7 policy.
Those are Architecture Governance and Continuous Intelligence concerns —
deliberately out of scope here so that this milestone's operating layer
stays auditable and fully deterministic.
