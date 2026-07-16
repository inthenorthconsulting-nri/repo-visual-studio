import type { Heading, Root, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface MarkdownSection {
  heading: string;
  depth: number;
  text: string;
  startLine: number;
  endLine: number;
}

export interface ParsedMarkdownDocument {
  path: string;
  title: string;
  leadParagraph: string;
  sections: MarkdownSection[];
}

const processor = unified().use(remarkParse);

export function parseMarkdown(path: string, raw: string): ParsedMarkdownDocument {
  const tree = processor.parse(raw) as Root;

  let title = path;
  const firstHeading = tree.children.find(
    (node): node is Heading => node.type === "heading" && node.depth === 1,
  );
  if (firstHeading) {
    title = mdastToString(firstHeading);
  }

  const firstParagraph = tree.children.find((node) => node.type === "paragraph");
  const leadParagraph = firstParagraph ? mdastToString(firstParagraph) : "";

  const sections = extractSections(tree);

  return { path, title, leadParagraph, sections };
}

function extractSections(tree: Root): MarkdownSection[] {
  const headings: { node: Heading; index: number }[] = [];
  tree.children.forEach((node, index) => {
    if (node.type === "heading" && node.depth >= 2 && node.depth <= 3) {
      headings.push({ node, index });
    }
  });

  const sections: MarkdownSection[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const { node, index } = headings[i];
    const nextIndex = headings[i + 1]?.index ?? tree.children.length;
    const bodyNodes = tree.children.slice(index + 1, nextIndex) as RootContent[];
    const text = bodyNodes.map((n) => mdastToString(n)).join(" ").trim();

    const startLine = node.position?.start.line ?? 0;
    const lastBodyNode = bodyNodes[bodyNodes.length - 1];
    const endLine = lastBodyNode?.position?.end.line ?? node.position?.end.line ?? startLine;

    sections.push({
      heading: mdastToString(node),
      depth: node.depth,
      text,
      startLine,
      endLine,
    });
  }

  return sections;
}
