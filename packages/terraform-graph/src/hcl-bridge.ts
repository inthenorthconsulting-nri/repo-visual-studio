import { parse } from "@cdktf/hcl2json";

// @cdktf/hcl2json is the primary, real HCL2 parser (a HashiCorp/CDKTF-
// maintained, deterministic, fully-offline WASM binary — see
// docs/terraform-topology.md for the selection rationale). It returns block
// bodies but no line/column position data. The block locator below is a
// small, non-regex-primary lexer used ONLY to recover evidence line ranges
// for blocks the WASM parser already told us exist — it never re-derives
// Terraform semantics.
export interface ParsedTerraformFile {
  path: string; // repo-relative
  text: string;
  json: Record<string, unknown>;
}

export async function parseTerraformFile(repoRelPath: string, text: string): Promise<ParsedTerraformFile> {
  const json = (await parse(repoRelPath, text)) as Record<string, unknown>;
  return { path: repoRelPath, text, json };
}

export interface BlockLocation {
  startLine: number;
  endLine: number;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function skipString(text: string, openIndex: number): number {
  let i = openIndex + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i;
}

function skipLineComment(text: string, index: number): number {
  const nl = text.indexOf("\n", index);
  return nl === -1 ? text.length : nl;
}

function skipBlockComment(text: string, index: number): number {
  const end = text.indexOf("*/", index + 2);
  return end === -1 ? text.length : end + 2;
}

function skipHeredoc(text: string, index: number): number {
  const headerMatch = /^<<-?([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(index));
  if (!headerMatch) return index + 2;
  const marker = headerMatch[1];
  const searchFrom = index + headerMatch[0].length;
  const endRe = new RegExp(`^[ \\t]*${marker}\\s*$`, "m");
  const rest = text.slice(searchFrom);
  const endMatch = endRe.exec(rest);
  if (!endMatch) return text.length;
  return searchFrom + endMatch.index + endMatch[0].length;
}

// Walks forward from an opening `{` tracking brace depth, skipping over
// string literals, heredocs, and comments so braces inside them never throw
// off the count. Returns the index of the matching closing `}`, or -1.
function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (ch === "#") {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      i = skipLineComment(text, i);
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i);
      continue;
    }
    if (ch === "<" && text[i + 1] === "<") {
      i = skipHeredoc(text, i);
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Finds the `occurrence`-th (0-indexed) match of `headerPattern` in `text`
// and returns the line range of the block it introduces, from the header
// line through its matching closing brace. `headerPattern` must not itself
// include the opening brace.
export function locateBlock(text: string, headerPattern: RegExp, occurrence = 0): BlockLocation | undefined {
  const global = new RegExp(headerPattern.source, headerPattern.flags.includes("g") ? headerPattern.flags : `${headerPattern.flags}g`);
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = global.exec(text)) !== null) {
    if (count === occurrence) {
      const openBrace = text.indexOf("{", match.index);
      if (openBrace === -1) return undefined;
      const closeBrace = findMatchingBrace(text, openBrace);
      if (closeBrace === -1) return undefined;
      return { startLine: lineOf(text, match.index), endLine: lineOf(text, closeBrace) };
    }
    count++;
    if (global.lastIndex === match.index) global.lastIndex++;
  }
  return undefined;
}

// Finds a single line matching `linePattern` within [fromLine, toLine]
// (1-indexed, inclusive) — used for tighter single-attribute evidence (e.g.
// one `locals { }` entry) within an already-located parent block.
export function locateLineWithin(text: string, linePattern: RegExp, fromLine: number, toLine: number): number | undefined {
  const lines = text.split("\n");
  for (let lineNo = fromLine; lineNo <= toLine && lineNo <= lines.length; lineNo++) {
    if (linePattern.test(lines[lineNo - 1] ?? "")) return lineNo;
  }
  return undefined;
}

export function formatLines(loc: BlockLocation | undefined): string | undefined {
  if (!loc) return undefined;
  return loc.startLine === loc.endLine ? `${loc.startLine}` : `${loc.startLine}-${loc.endLine}`;
}
