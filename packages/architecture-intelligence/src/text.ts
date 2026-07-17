// Compresses freeform Markdown documentation text into a short, atomic claim
// bounded by a word budget — used for purpose/responsibility slide content
// that previously used a blind character slice(0, 240), which could cut mid-
// word or leave a raw Markdown table fragment on the slide. Rules: strip
// table rows and heading/list/emphasis markup, then truncate on a whole-word
// (never mid-word) boundary, preferring a full leading sentence when it fits.

const MARKDOWN_TABLE_ROW = /^\s*\|.*\|\s*$/;
const MARKDOWN_TABLE_SEPARATOR = /^\s*\|?[\s:-]+\|[\s:|-]+\s*$/;
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9])/;

function stripMarkdownNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !MARKDOWN_TABLE_ROW.test(line) && !MARKDOWN_TABLE_SEPARATOR.test(line))
    .join(" ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compresses text down to a word budget, ending on a whole-word (and, where possible, whole-sentence) boundary — never mid-word. */
export function compressToAtomicClaim(rawText: string, maxWords = 40): string {
  const cleaned = stripMarkdownNoise(rawText);
  if (cleaned.length === 0) return cleaned;

  const sentences = cleaned.split(SENTENCE_SPLIT);
  let result = "";
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (wordCount === 0) {
      if (words.length <= maxWords) {
        result = sentence.trim();
        wordCount = words.length;
        continue;
      }
      result = words.slice(0, maxWords).join(" ");
      wordCount = maxWords;
      break;
    }
    if (wordCount + words.length > maxWords) break;
    result += ` ${sentence.trim()}`;
    wordCount += words.length;
  }

  return result.trim();
}
