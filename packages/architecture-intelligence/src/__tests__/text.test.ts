import { describe, expect, it } from "vitest";
import { compressToAtomicClaim } from "../text.js";

describe("compressToAtomicClaim", () => {
  it("returns short text unchanged", () => {
    expect(compressToAtomicClaim("A short sentence.", 40)).toBe("A short sentence.");
  });

  it("truncates on a whole-word boundary, never mid-word", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const result = compressToAtomicClaim(long, 10);
    expect(result.split(" ")).toHaveLength(10);
    expect(long.startsWith(result)).toBe(true);
  });

  it("prefers a full leading sentence when it fits within the budget", () => {
    const text = "This is the first sentence. This is a much longer second sentence that would exceed the tiny budget given here.";
    const result = compressToAtomicClaim(text, 6);
    expect(result).toBe("This is the first sentence.");
  });

  it("strips Markdown table rows and separators", () => {
    const text = "Summary text.\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\nMore prose after the table.";
    const result = compressToAtomicClaim(text, 40);
    expect(result).not.toContain("|");
    expect(result).toContain("Summary text.");
  });

  it("strips heading, list, and emphasis markup", () => {
    const text = "## Heading\n- **bold** item\n_emphasis_ text here";
    const result = compressToAtomicClaim(text, 40);
    expect(result).not.toMatch(/[#*_]/);
  });

  it("returns an empty string for empty input", () => {
    expect(compressToAtomicClaim("", 40)).toBe("");
  });
});
