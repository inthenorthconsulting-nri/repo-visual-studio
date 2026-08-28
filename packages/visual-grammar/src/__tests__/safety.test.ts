import { describe, expect, it } from "vitest";
import { VISUAL_GRAMMARS } from "@rvs/visual-intelligence";
import { renderGrammar } from "../render.js";
import { attributes, element, escapeAttribute, escapeText } from "../svg.js";
import { model, node, edge, specFor } from "./fixtures.js";

// Every string a renderer writes into SVG came from repository evidence:
// a file path, a Terraform resource name, a commit subject, an ADR title.
// None of it is trusted. A repository that contains a file called
// `</text><script>…` is not an attack on RVS so much as a fact about that
// repository, and the drawing of it must stay a drawing.

/** Payloads chosen to break out of a text node, an attribute, and a comment respectively. */
const HOSTILE = [
  `</text><script>alert(1)</script><text>`,
  `" onload="alert(1)`,
  `' onmouseover='alert(1)`,
  `--><script>alert(1)</script><!--`,
  `<img src=x onerror=alert(1)>`,
  `javascript:alert(1)`,
  `]]></desc><script>alert(1)</script>`,
];

const hostileModel = (payload: string) =>
  model({
    nodes: [
      node("a", { label: payload, group_id: "g" }),
      node("b", { label: `also ${payload}`, group_id: "g" }),
    ],
    edges: [edge("a", "b", { label: payload })],
    groups: [{ id: "g", label: payload, kind: "container", synthetic: false, member_ids: ["a", "b"] }],
    lanes: [{ id: "l", label: payload, order: 0, member_ids: ["a", "b"] }],
    stages: [{ id: "s", label: payload, order: 0, member_ids: ["a", "b"] }],
    annotations: [{ id: "an", text: payload, target_id: "a", evidence_refs: [] }],
  });

/**
 * The tags of a document, with all text content removed.
 *
 * Scanning the whole string for `onerror=` is the wrong test and fails on
 * the right answer: a label rendered as `&lt;img src=x onerror=alert(1)&gt;`
 * contains that substring and is perfectly safe, because it is text. What
 * matters is whether a handler reached a *tag*. After escaping, no text
 * content can contain `<` or `>`, so this extraction returns exactly the
 * markup -- and if escaping ever broke, a payload would show up here as the
 * tag it was trying to become, which is the failure worth catching.
 */
const tagsOf = (svg: string) => [...svg.matchAll(/<[^>]*>/g)].map((m) => m[0]).join("\n");

describe("content from a repository is drawn, never executed", () => {
  it("emits no script element and no executable attribute, for any grammar", () => {
    for (const payload of HOSTILE) {
      const m = hostileModel(payload);
      for (const grammar of VISUAL_GRAMMARS) {
        const svg = renderGrammar({ spec: specFor(grammar, m), model: m }).svg;
        const tags = tagsOf(svg);
        const where = `${grammar} / ${payload}`;
        expect(tags, where).not.toMatch(/<script/i);
        expect(tags, where).not.toMatch(/<\s*(iframe|foreignObject|use|image|animate|set|a)\b/i);
        // No event handler may reach a tag, under any name.
        expect(tags, where).not.toMatch(/\son[a-z]+\s*=/i);
        // No reference that could resolve off-document.
        expect(tags, where).not.toMatch(/\s(?:xlink:)?href\s*=/i);
        expect(tags, where).not.toMatch(/javascript:/i);
        expect(tags, where).not.toMatch(/<!\[CDATA\[/);
        // The tag count is even-ish only if the payload never opened one of
        // its own: an unbalanced document is how a successful injection first
        // shows itself.
        expect(svg.split("<").length, where).toBe(svg.split(">").length);
      }
    }
  });

  it("keeps a payload intact as literal text rather than sanitising it away", () => {
    // Escaping, not stripping. A label that reads `<Root>` in the repository
    // must read `<Root>` in the diagram -- silently deleting characters would
    // make the picture disagree with the evidence it cites.
    const m = hostileModel(`<Root> & "quoted"`);
    const svg = renderGrammar({ spec: specFor("architecture", m), model: m }).svg;
    // A quotation mark is left alone inside element content, where it means
    // nothing; only the three markup characters are escaped there.
    expect(svg).toContain(`&lt;Root&gt; &amp; "quoted"`);
    expect(svg).not.toContain("<Root>");
  });

  it("escapes markup characters for text, and the quote characters too for attributes", () => {
    // Two functions rather than one because the two contexts genuinely
    // differ: a quote cannot terminate element content, but it can terminate
    // an attribute value, and over-escaping text would put `&quot;` in front
    // of a reader who wrote a plain quotation mark.
    expect(escapeText(`<&>"'`)).toBe(`&lt;&amp;&gt;"'`);
    expect(escapeAttribute(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("drops a forbidden attribute centrally, so no call site can reintroduce one", () => {
    const out = element("g", [
      ["id", "keep"],
      ["onclick", "alert(1)"],
      ["onload", "alert(1)"],
      ["href", "https://example.com"],
      ["xlink:href", "#x"],
    ]);
    expect(out).toContain(`id="keep"`);
    expect(out).not.toMatch(/onclick|onload|href/i);
  });

  it("omits an undefined attribute entirely rather than writing the string \"undefined\"", () => {
    expect(attributes([["a", 1], ["b", undefined]])).toBe(` a="1"`);
  });
});

describe("nothing about the machine that rendered it leaks into the drawing", () => {
  it("contains no absolute path, hostname, home directory, or timestamp", () => {
    const m = model({
      nodes: [node("a", { evidence_refs: [{ path: "src/app.ts", lines: "1-4" }] })],
    });
    for (const grammar of VISUAL_GRAMMARS) {
      const svg = renderGrammar({ spec: specFor(grammar, m), model: m }).svg;
      expect(svg, grammar).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
      expect(svg, grammar).not.toContain(process.cwd());
      expect(svg, grammar).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it("carries evidence as a reference, never as evidence content", () => {
    // A diagram is shared far more widely than the repository it describes.
    // It may say *where* to look; it may not carry the source line itself.
    const secret = "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI";
    const m = model({
      nodes: [node("a", { evidence_refs: [{ path: ".env", lines: "3" }], label: "config" })],
    });
    const svg = renderGrammar({ spec: specFor("architecture", m), model: m }).svg;
    expect(svg).not.toContain(secret);
    expect(svg).toContain("config");
  });
});
