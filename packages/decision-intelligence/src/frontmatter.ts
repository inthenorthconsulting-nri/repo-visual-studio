// YAML frontmatter extraction. Reuses the existing `yaml` dependency's
// default-safe `parse()` (no custom tag resolution, no unsafe load) --
// decision documents are untrusted repository content.

import { parse as parseYaml } from "yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface FrontmatterExtraction {
  frontmatter: Record<string, unknown> | undefined;
  body: string;
}

export function extractFrontmatter(raw: string): FrontmatterExtraction {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { frontmatter: undefined, body: raw };
  }

  const body = raw.slice(match[0].length);

  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch {
    // Malformed frontmatter is not a hard failure -- the document falls
    // back to markdown-only parsing and normalization.ts treats a missing
    // frontmatter block the same as an unparseable one.
    return { frontmatter: undefined, body };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { frontmatter: undefined, body };
  }

  return { frontmatter: parsed as Record<string, unknown>, body };
}
