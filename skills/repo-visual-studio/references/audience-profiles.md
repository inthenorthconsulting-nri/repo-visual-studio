# Audience profiles

Two profiles ship in Milestone 1. Pass one via `rvs brief --audience <id>`.

## `executive`

- **Audience**: executives / decision-makers
- **Purpose**: decision — the deck ends by asking for something specific
- **Duration**: ~10 minutes
- **Technical depth**: low
- **Decision required**: yes
- **Sections**: `context` → `target_state` → `status` → `decision`

The final scene is always headlined "Decision requested" with a placeholder
body ("[fill in the specific approval or go/no-go being asked of this
audience]") — the CLI cannot know what decision is actually being asked for,
so this section must be edited by hand in `.rvs/cache/narrative-brief.yml`
before re-running `rvs create slides` if a real decision needs to appear.

## `architecture-review`

- **Audience**: technical leadership
- **Purpose**: review — informational, no decision ask
- **Duration**: ~20 minutes
- **Technical depth**: high
- **Decision required**: no
- **Sections**: `context` → `architecture` → `status`

Produces an architecture scene (technology/structure diagram) and a metrics
scene (files scanned, contributors, commits) that the `executive` profile
also includes, but skips the closing decision ask.

## Choosing between them

Match audience purpose, not just job title — a senior engineer wanting a
structural walkthrough should get `architecture-review`, while a founder
who needs to approve a go/no-go should get `executive`, regardless of either
person's actual role.
