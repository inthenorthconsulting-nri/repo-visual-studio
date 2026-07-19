# Repository Agent Instructions

Read and follow, in order:

1. [`MASTER_AGENT.md`](MASTER_AGENT.md) — routing, intelligence selection,
   authorization boundaries, task startup/completion protocol.
2. The task-specific skill `MASTER_AGENT.md` routes to
   (`skills/repo-visual-studio/`, `skills/pr-governance/`, or
   `skills/repository-maintenance/`).
3. Any repository-local security and safety rules that apply to the tool
   you're running as.

Do not duplicate `MASTER_AGENT.md`'s routing table or PR-governance rules
here — this file exists so agents that look for `AGENTS.md` by convention
find the real routing authority instead of a stale copy of it.
