// Recognizes 3 forms of decision-document body structure and reduces each
// to a common RawParsedDecision shape. Mirrors
// @rvs/repository-model/src/markdown-adapter.ts's remark/mdast pattern
// rather than hand-rolling markdown parsing a second way in this repo.
//
// Form 1: heading-pattern sections, e.g. Michael Nygard-style
//   "## Status" / "## Context" / "## Decision" / "## Consequences".
// Form 2: a single leading key/value table (e.g. "| Status | Accepted |").
// Form 3: neither -- only a title and free-form body text is recovered.
//
// A document can exhibit more than one form at once (e.g. a table plus
// heading sections); normalization.ts decides field precedence.

import type { Heading, List, Root, RootContent, Table, TableRow } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface RawParsedDecision {
  title?: string;
  leadParagraph: string;
  sections: Record<string, string>;
  /** Top-level list items found within each section, in document order -- used by assumptions.ts/consequences.ts/alternatives.ts to recover one labeled item per bullet. */
  listItemsBySection: Record<string, string[]>;
  table?: Record<string, string>;
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseDecisionMarkdown(raw: string): RawParsedDecision {
  const tree = processor.parse(raw) as Root;

  const firstHeading = tree.children.find((node): node is Heading => node.type === "heading" && node.depth === 1);
  const title = firstHeading ? mdastToString(firstHeading) : undefined;

  const firstParagraph = tree.children.find((node) => node.type === "paragraph");
  const leadParagraph = firstParagraph ? mdastToString(firstParagraph) : "";

  const { sections, listItemsBySection } = extractSections(tree);

  return {
    title,
    leadParagraph,
    sections,
    listItemsBySection,
    table: extractFirstTable(tree),
  };
}

function extractSections(tree: Root): { sections: Record<string, string>; listItemsBySection: Record<string, string[]> } {
  const headings: { node: Heading; index: number }[] = [];
  tree.children.forEach((node, index) => {
    if (node.type === "heading" && node.depth >= 2 && node.depth <= 3) {
      headings.push({ node, index });
    }
  });

  const sections: Record<string, string> = {};
  const listItemsBySection: Record<string, string[]> = {};
  for (let i = 0; i < headings.length; i += 1) {
    const { node, index } = headings[i];
    const nextIndex = headings[i + 1]?.index ?? tree.children.length;
    const bodyNodes = tree.children.slice(index + 1, nextIndex) as RootContent[];
    const key = normalizeSectionKey(mdastToString(node));
    if (key.length === 0) continue;

    const text = bodyNodes
      .filter((n) => n.type !== "table")
      .map((n) => mdastToString(n))
      .join("\n\n")
      .trim();
    sections[key] = text;

    const listItems = bodyNodes
      .filter((n): n is List => n.type === "list")
      .flatMap((list) => list.children.map((item) => mdastToString(item).trim()))
      .filter((text) => text.length > 0);
    if (listItems.length > 0) listItemsBySection[key] = listItems;
  }
  return { sections, listItemsBySection };
}

function normalizeSectionKey(headingText: string): string {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/^decision:\s*/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const LABEL_PREFIX_PATTERNS = [/^\[([a-z_ ]+)\]\s*(.*)$/i, /^([a-z_ ]+):\s*(.*)$/i];

/**
 * Recovers a `[label] statement` or `label: statement` structured item from
 * a single list-item's flattened text, used identically by
 * assumptions.ts/consequences.ts/alternatives.ts. The label is matched
 * case-insensitively against the caller's own enum values; an unrecognized
 * or absent label returns `label: undefined` rather than a guess.
 */
export function parseLabeledListItem(itemText: string, validLabels: readonly string[]): { label: string | undefined; statement: string } {
  for (const pattern of LABEL_PREFIX_PATTERNS) {
    const match = itemText.match(pattern);
    if (match) {
      const candidate = match[1].trim().toLowerCase().replace(/\s+/g, "_");
      if (validLabels.includes(candidate)) {
        return { label: candidate, statement: match[2].trim() };
      }
    }
  }
  return { label: undefined, statement: itemText.trim() };
}

function extractFirstTable(tree: Root): Record<string, string> | undefined {
  const tableNode = tree.children.find((node): node is Table => node.type === "table");
  if (!tableNode || tableNode.children.length < 2) return undefined;

  const rows = tableNode.children as TableRow[];
  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow.children.map((cell) => mdastToString(cell).trim().toLowerCase());
  const firstBodyRow = bodyRows[0];
  if (!firstBodyRow) return undefined;

  const result: Record<string, string> = {};
  firstBodyRow.children.forEach((cell, i) => {
    const key = headers[i];
    if (key) result[key] = mdastToString(cell).trim();
  });
  return Object.keys(result).length > 0 ? result : undefined;
}
