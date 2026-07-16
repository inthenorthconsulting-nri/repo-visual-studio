# @rvs/cli

Generates evidence-traceable HTML slide decks and PDF exports from a Git repository.

## Install

```bash
npm install -g @rvs/cli
# or, project-local:
npm install @rvs/cli
npx rvs doctor
```

## Usage

```bash
rvs doctor                                   # check environment, versions, asset resolution
rvs init                                     # write .rvs/config.yml
rvs inspect                                  # scan repo -> .rvs/cache/*.json
rvs brief --audience executive|architecture-review
rvs create slides --design-system executive-dark|editorial-light|technical-grid
rvs create workflow --all --renderer both    # GitHub Actions workflow diagrams
rvs validate --ci                            # deterministic overflow/contrast/evidence checks
rvs export pdf                               # requires: npx playwright install chromium
```

Run `rvs doctor` after installing to confirm CLI version, Node version, install/asset paths, schema versions, and Playwright/Chromium availability.
