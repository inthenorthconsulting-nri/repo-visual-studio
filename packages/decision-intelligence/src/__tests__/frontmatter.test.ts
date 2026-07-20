import { describe, expect, it } from "vitest";
import { extractFrontmatter } from "../frontmatter.js";

describe("extractFrontmatter: no frontmatter block", () => {
  it("returns the raw content unchanged as body when there is no leading '---' delimiter", () => {
    const raw = "# Title\n\nBody text.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe(raw);
  });

  it("does not treat a '---' that is not at the very start of the document as frontmatter", () => {
    const raw = "Intro line.\n---\ntitle: x\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe(raw);
  });

  it("treats an empty string as having no frontmatter", () => {
    const result = extractFrontmatter("");
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("");
  });
});

describe("extractFrontmatter: valid frontmatter", () => {
  it("parses a well-formed block and strips it from the body", () => {
    const raw = "---\ntitle: Use Postgres\nstatus: accepted\n---\n# Use Postgres\n\nBody text.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Use Postgres", status: "accepted" });
    expect(result.body).toBe("# Use Postgres\n\nBody text.\n");
  });

  it("supports CRLF line endings", () => {
    const raw = "---\r\ntitle: Use Postgres\r\n---\r\nBody.\r\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "Use Postgres" });
    expect(result.body).toBe("Body.\r\n");
  });

  it("handles a document that ends immediately after the closing delimiter (no trailing newline)", () => {
    const raw = "---\ntitle: x\n---";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "x" });
    expect(result.body).toBe("");
  });

  it("parses nested structures (arrays, nested maps) as ordinary data", () => {
    const raw = "---\nauthors:\n  - Alice\n  - Bob\nmeta:\n  reviewed: true\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ authors: ["Alice", "Bob"], meta: { reviewed: true } });
  });
});

describe("extractFrontmatter: malformed YAML falls back to undefined frontmatter", () => {
  it("falls back to undefined frontmatter for unparseable YAML but still strips the delimiter block from body", () => {
    const raw = "---\n[this is not: valid: yaml\n---\nBody text.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body text.\n");
  });

  it("falls back to undefined frontmatter for duplicate keys (the yaml parser rejects them by default)", () => {
    const raw = "---\ntitle: First\ntitle: Second\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body.\n");
  });

  it("falls back to undefined frontmatter for pathologically deep nesting instead of crashing", () => {
    const depth = 2000;
    const nested = "[".repeat(depth) + "1" + "]".repeat(depth);
    const raw = `---\nx: ${nested}\n---\nBody.\n`;
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body.\n");
  });
});

describe("extractFrontmatter: parsed-but-not-an-object falls back to undefined frontmatter", () => {
  it("treats a scalar frontmatter body as undefined", () => {
    const raw = "---\njust a plain scalar string\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body.\n");
  });

  it("treats an array frontmatter body as undefined", () => {
    const raw = "---\n- one\n- two\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body.\n");
  });

  it("treats an empty (null-parsing) frontmatter block as undefined", () => {
    const raw = "---\n\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body.\n");
  });
});

describe("extractFrontmatter: untrusted YAML content safety", () => {
  it("resolves YAML anchors/aliases as inert data rather than executing anything", () => {
    const raw = "---\nid: &id ADR-1\nalias_id: *id\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ id: "ADR-1", alias_id: "ADR-1" });
  });

  it("parses an oversized frontmatter block without crashing or truncating data", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `field_${i}: value_${i}`);
    const raw = `---\n${lines.join("\n")}\n---\nBody.\n`;
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toBeDefined();
    expect(result.frontmatter?.["field_0"]).toBe("value_0");
    expect(result.frontmatter?.["field_4999"]).toBe("value_4999");
    expect(result.body).toBe("Body.\n");
  });

  it("round-trips unusual unicode content (including a lone surrogate) in a string value without throwing", () => {
    const raw = "---\ntitle: \"héllo wörld \\uD800 \\u{1F600}\"\n---\nBody.\n";
    expect(() => extractFrontmatter(raw)).not.toThrow();
  });

  it("round-trips ordinary multi-byte unicode content faithfully", () => {
    const raw = "---\ntitle: 日本語のタイトル\n---\nBody.\n";
    const result = extractFrontmatter(raw);
    expect(result.frontmatter).toEqual({ title: "日本語のタイトル" });
  });
});
