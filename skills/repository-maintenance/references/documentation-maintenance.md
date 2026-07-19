# Documentation maintenance

Documentation must reflect the current implementation, not remembered
behavior or a prior milestone's state. Every check below means: open the
source, confirm the documented claim against it, then fix the documentation
— not the other way around.

## Supported checks

- Command verification — every `rvs <command>` shown in `README.md`,
  `docs/*.md`, or `skills/**/SKILL.md` actually exists in
  `packages/cli/src/bin.ts` with the flags shown.
- File-path verification — every path a doc references
  (`.rvs/cache/*.json`, `packages/*/src/...`) actually exists.
- Schema/version consistency — a documented JSON shape matches the current
  Zod/TypeScript type it describes.
- Cross-reference validation — a doc that says "see `docs/x.md#heading`"
  has that file and that heading.
- Link validation — relative links resolve; this repository has no
  external-link checker wired in, so external URLs are a "probable issue"
  at best, not a confirmed one, unless independently fetched.
- Stale milestone references — a doc claiming a limitation exists that a
  later milestone actually fixed (cross-check `docs/milestones.md`).
- Public API documentation — a package's documented exports match its
  actual `main`/`index.ts` exports.
- Skill documentation — each `SKILL.md`'s workflow commands and referenced
  files exist and resolve (this is exactly what
  `tests/agent-governance.test.ts` checks automatically for the
  agent-governance skills; extend that pattern rather than inventing a new
  one for other skills).
- README synchronization — the root `README.md`'s command walkthrough
  matches the actual current CLI surface.
- Example validation — a documented command example, run against a real or
  fixture repository, produces the output the doc claims.

## Rule

If a claim in documentation can be checked against source, check it against
source before restating it. Do not carry forward a doc's own prior wording
as if it were independently verified.
