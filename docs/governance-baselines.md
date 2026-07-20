# Governance Baselines (Milestone 7)

A short, focused reference on the baseline lifecycle: what a baseline is,
how it is established and rotated, exactly what `--force` does and does
not override, and how a CI pipeline should pin one. For the broader
snapshot/diff/blast-radius model a baseline feeds into, see
[docs/architecture-governance.md](architecture-governance.md). For how
`rvs governance check --ci` consumes a configured baseline, see
[docs/continuous-intelligence.md](continuous-intelligence.md).

## What a baseline is

A `GovernanceBaseline` is a previously captured `IntelligenceSnapshot`
promoted to "the thing everything else gets compared against." It is not a
new artifact shape — it wraps an existing snapshot verbatim plus a
promotion record:

```ts
interface GovernanceBaseline {
  schema_version: number;
  id: string;                  // governance:baseline:<sanitized snapshot id>
  snapshot: IntelligenceSnapshot;
  repository_id: string;
  established_at: string;      // caller-supplied wall-clock ISO timestamp
  evidence_refs: GovernanceEvidenceRef[]; // deduped + sorted copy of snapshot.evidence_refs
}
```

`buildBaselineId(snapshotId)` (`ids.ts`) produces the `id` deterministically
from the wrapped snapshot's own id — there is no separate baseline-id
input. `established_at` is the one wall-clock exception: it is excluded
from any determinism comparison, and `packages/governance-intelligence`
never calls `Date.now()`/`new Date()` internally to produce it — the CLI
layer supplies it (`new Date().toISOString()` in
`runGovernanceBaselineSet`).

## Establishing and reading a baseline

```bash
rvs governance baseline show
rvs governance baseline set <snapshot> [--force]
rvs governance baseline validate
```

- **`<snapshot>`** (positional, required for `set`) — a snapshot id or
  filename under `.rvs/cache/governance/snapshots/`, or a path, resolved
  by `resolveSnapshotRefPath()`: first tried as a path relative to the
  repo root, then as `<GOVERNANCE_SNAPSHOTS_DIR>/<ref>`, then as
  `<GOVERNANCE_SNAPSHOTS_DIR>/<ref>.json`. If none resolve, the command
  throws `No snapshot found for "<ref>" (checked as a path relative to
  the repo root, and as a snapshot id/filename under
  .rvs/cache/governance/snapshots/). Run \`rvs snapshot create\` first.`
- **`rvs governance baseline set`** writes the promoted baseline to
  `.rvs/cache/governance/baseline-snapshot.json` (`BASELINE_SNAPSHOT_FILE`),
  always overwriting whatever was there — there is no baseline history
  file; only the most recently promoted baseline is ever on disk at that
  path.
- **`rvs governance baseline show`** prints the currently configured
  baseline's id, wrapped snapshot id, `established_at`, each artifact's
  `provenance` (and `schema_version` when present), and whether the CLI's
  on-disk envelope carries embedded raw artifact JSON (`rawArtifacts`) — a
  CLI-layer addition described below, not part of the core
  `GovernanceBaseline` shape.
- **`rvs governance baseline validate`** re-checks the *currently
  configured* baseline's own internal schema compatibility against the
  running `@rvs/governance-intelligence` package (`validateBaseline()`,
  `baseline.ts`) — see "Schema-compatibility refusal" below. It exits
  non-zero (`process.exitCode = 1`) whenever the result is anything other
  than `"compatible"`.

None of `showBaseline`/`setBaseline`/`validateBaseline` (`baseline.ts`)
touch the filesystem directly — `showBaseline` takes a dependency-injected
`readSnapshotFile` callback, and the other two operate purely on
already-in-memory data. `showBaseline` returns `undefined` (never throws)
whenever:

- `.rvs/governance.yml` doesn't exist at all (`config === undefined`), or
- the config exists but names no `baseline.snapshot` path, or
- the injected `readSnapshotFile` callback returns `undefined` ("not
  found"), or
- the callback throws (also treated as "not found").

`rvs governance baseline show`/`validate` both print
`No governance baseline is configured. ...` and return cleanly in this
case (`show` additionally points at
`rvs governance baseline set <snapshot>` and the `.rvs/governance.yml`
field to wire up next).

## `.rvs/governance.yml`'s `baseline` field

A promoted baseline file on disk is *not* automatically "the" baseline —
`.rvs/governance.yml` is human-owned and must name it explicitly:

```yaml
schema_version: 1
baseline:
  snapshot: .rvs/cache/governance/baseline-snapshot.json
```

`rvs governance baseline set` never writes `.rvs/governance.yml` itself
(mirroring `.rvs/config.yml` being written only by `rvs init`); if the
currently loaded config's `baseline.snapshot` doesn't already equal
`.rvs/cache/governance/baseline-snapshot.json`, it prints a reminder
naming the exact line to add.

## Compatibility assessment on promotion

`rvs governance baseline set` always computes and prints a compatibility
result before writing anything:

```
Compatibility with prior baseline: "<status>".
  - <reason>
  - <reason>
```

- If there **is** a prior configured baseline, compatibility is
  `assessSnapshotCompatibility(priorBaseline.snapshot, newSnapshot)` — the
  same function `require_compatible_snapshot` policy rules and
  `rvs governance compare`'s top-level report use (see
  [docs/architecture-governance.md](architecture-governance.md#compatibility-assessment)
  for the full breakdown of what it checks). Its `status` is one of
  `"compatible"`, `"compatible_with_warnings"`, `"partial"`, or
  `"incompatible"`.
- If there is **no** prior baseline (first baseline ever established for
  the repository), `setBaseline()` returns an explicit
  `{status: "compatible", reasons: ["No prior baseline exists for this
  repository; this is the first baseline established, so there is nothing
  to compare it against."]}` rather than fabricating a comparison against
  nothing.

## `--force` semantics

`setBaseline()` itself (the pure function in `governance-intelligence`)
**never throws or refuses** on an incompatible result — per the package's
design, whether to proceed with an incompatible baseline swap is a
CLI-layer decision, not the pure function's. The refusal lives entirely in
`runGovernanceBaselineSet` (`packages/cli/src/commands/governance-baseline.ts`):

- If `compatibility.status === "incompatible"` and `--force` was **not**
  passed: the command logs
  `Refusing to set an incompatible baseline without --force. Re-run with
  --force to proceed anyway, or investigate the incompatibility reasons
  above first.`, sets `process.exitCode = 1`, and returns **without**
  writing `baseline-snapshot.json` — the previously configured baseline is
  left completely untouched.
- If `compatibility.status === "incompatible"` and `--force` **was**
  passed: the command logs a warning —
  `Setting an incompatible baseline because --force was passed. Governance
  comparisons against this baseline may be unreliable.` — and proceeds to
  write the new baseline anyway.
- **`"partial"` and `"compatible_with_warnings"` are never refused**, with
  or without `--force` — only `"incompatible"` triggers the refusal path.
  A `"partial"` promotion (e.g. one side of the comparison is missing an
  artifact's provenance) writes normally, with the compatibility reasons
  printed for visibility only.

`--force` only overrides the incompatible-*prior*-baseline check performed
during promotion. It has no effect on `rvs governance baseline validate`'s
separate schema-version check (there is no `--force` flag on `validate`).

## Schema-compatibility refusal on validate

`rvs governance baseline validate` checks a *different* thing than
`set`'s compatibility check: not "is this new snapshot compatible with the
prior baseline's snapshot," but "is the already-configured baseline itself
still readable by the currently running package version."
`validateBaseline(baseline, currentSchemaVersion)` runs two independent
checks and surfaces both if both fail:

- `baseline.schema_version !== currentSchemaVersion` → reason:
  `baseline.schema_version is <N>, but the current governance-intelligence
  schema version is <M>.`
- `baseline.snapshot.schema_version !== currentSchemaVersion` → reason:
  `baseline.snapshot.schema_version is <N>, but the current
  governance-intelligence schema version is <M>.`

Any failure produces `status: "incompatible"` with both applicable reasons
present; otherwise `status: "compatible"` with an empty `reasons` array.
There is no `"partial"`/`"compatible_with_warnings"` outcome for this
specific check — only `"compatible"` or `"incompatible"`. This is a
*refusal signal only* — `rvs governance baseline validate` itself never
deletes or rewrites the baseline file; it exits non-zero so a caller (a
human or a CI step) can decide to re-run `rvs governance baseline set` with
a freshly captured snapshot.

## Rotating a baseline

There is no dedicated "rotate" command — rotation is just running
`rvs governance baseline set <new-snapshot>` again. Each promotion:

1. Reads whatever baseline is currently configured (if any) as the "prior"
   side of the compatibility check.
2. Computes compatibility against the new snapshot.
3. Refuses (or warns and proceeds, with `--force`) exactly as described
   above.
4. Overwrites `.rvs/cache/governance/baseline-snapshot.json` in place —
   the prior baseline file is not retained or archived by this command.

If you need to keep prior baselines around (for audit trail or rollback),
copy `.rvs/cache/governance/baseline-snapshot.json` elsewhere, or retain
the underlying snapshot file under `.rvs/cache/governance/snapshots/`
before rotating — `rvs snapshot create` never deletes previously captured
snapshot files, only the promoted baseline pointer moves.

## The CLI's on-disk envelope (`rawArtifacts`)

`@rvs/governance-intelligence`'s own `IntelligenceSnapshot` deliberately
never embeds the raw architecture/capability/product/portfolio JSON it was
fingerprinted from — only a per-domain digest (see
[docs/architecture-governance.md](architecture-governance.md#intelligencesnapshot-and-rvs-snapshot-create)).
But `rvs governance compare` needs the *raw* artifact JSON on both sides to
actually run the diff engines. Rather than only ever being able to diff
against the live `.rvs/cache/*.json` on the current checkout, the CLI
layer (`packages/cli/src/governance-cache.ts`) saves every snapshot file —
including the promoted baseline file — as an envelope:

```ts
interface SnapshotEnvelope {
  snapshot: IntelligenceSnapshot;
  rawArtifacts: { architecture?: unknown; capability?: unknown; product?: unknown; portfolio?: unknown };
}
```

This is purely an addition of this CLI's own on-disk format — nothing in
`@rvs/governance-intelligence` reads or requires `rawArtifacts`;
`showBaseline()` only ever returns the typed `GovernanceBaseline` view
(`raw as GovernanceBaseline`, ignoring the extra key). `rvs governance
baseline show`'s "raw artifacts embedded: yes/no" line reflects whether
this CLI-layer field is present on the file actually on disk.

## Pinning a baseline in CI

`rvs governance check --ci` (see
[docs/continuous-intelligence.md](continuous-intelligence.md#rvs-governance-check---cis-exact-fail-condition))
reads whatever baseline `.rvs/governance.yml`'s `baseline.snapshot` names
— it does not accept a baseline override flag itself. The two supported
patterns for pinning a baseline in a CI pipeline are:

1. **Commit the baseline.** Check `.rvs/cache/governance/baseline-snapshot.json`
   and the `baseline.snapshot` line in `.rvs/governance.yml` into version
   control. Every CI run then compares against the exact same pinned
   snapshot until a maintainer deliberately runs
   `rvs governance baseline set` again (locally or in a dedicated,
   human-triggered CI job) and commits the result.
2. **Regenerate and validate on a schedule.** Run
   `rvs governance baseline set <latest-known-good-snapshot> && rvs
   governance baseline validate` as a separate, explicitly-triggered
   workflow (not on every PR), and gate that job on
   `rvs governance baseline validate`'s exit code before allowing the
   commit that updates the pinned baseline file.

Either way, `rvs governance baseline validate` is the recommended
pre-flight check to run at the start of a CI job that depends on the
pinned baseline still being schema-compatible with whatever
`@rvs/governance-intelligence` version CI has installed — see the example
GitHub Actions workflow in
[docs/continuous-intelligence.md](continuous-intelligence.md#example-ci-workflow-illustrative-only-not-verified-by-this-repositorys-own-ci).

## Known limitations

- **No baseline history.** Only the single most recently promoted baseline
  is ever on disk at `.rvs/cache/governance/baseline-snapshot.json`;
  rotating overwrites it in place with no automatic archive.
- **`--force` only overrides the incompatible-prior-baseline refusal on
  `set`.** It does not affect `validate`'s schema-version check, and it
  does not silence the printed compatibility reasons — those are always
  logged regardless of the flag.
- **Compatibility is assessed only against the immediately prior
  baseline**, not against any earlier history, since no history is
  retained.
- **`rawArtifacts` embedding is a CLI-layer convenience, not a portable
  contract.** A `GovernanceBaseline` produced by some other tool that
  implements the same JSON shape without `rawArtifacts` is fully valid
  from `@rvs/governance-intelligence`'s point of view, but `rvs governance
  compare` against it will fail to find raw artifact JSON to diff.

See also: [docs/architecture-governance.md](architecture-governance.md)
for `IntelligenceSnapshot` provenance and the diff engines a baseline
feeds; [docs/continuous-intelligence.md](continuous-intelligence.md) for
policy evaluation, `--ci`, and the example CI workflow;
[docs/governance-policies.md](governance-policies.md) for the
`require_compatible_snapshot` rule kind that reads a comparison's
top-level compatibility result.
