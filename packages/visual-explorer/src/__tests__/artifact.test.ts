import { describe, expect, it } from "vitest";
import { buildExplorerArtifact } from "../artifact.js";
import { buildExplorerModel } from "../source.js";
import { chainSource, estateSource, sourceNode } from "./fixtures.js";

const build = (over: Partial<Parameters<typeof buildExplorerArtifact>[0]> = {}) =>
  buildExplorerArtifact({
    producer: "test",
    subject: "estate",
    model: buildExplorerModel(estateSource()),
    audience: "engineering",
    detail_mode: "faithful",
    focal_entity_ids: ["alpha-api"],
    ...over,
  });

/**
 * Every element's opening tag, with script contents removed first.
 *
 * Scripts are excluded because JavaScript contains `<` as an operator, and a
 * naive scan would read `a.edge < b.edge ? -1 : 1` as the start of a tag. The
 * question these tests ask -- did graph content become an attribute? -- is
 * about markup, and the runtime is not markup.
 */
function tagsOutsideScripts(html: string): string[] {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/g, "");
  return [...withoutScripts.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]);
}

describe("the artifact is one file that works with the network unplugged", () => {
  it("references no external origin of any kind", () => {
    const { html } = build();
    // The SVG namespace is the one absolute URL a self-contained SVG must
    // carry. It is an identifier, not an address: nothing fetches it. Every
    // *other* absolute URL would be a thing this file goes and gets, so the
    // assertion allows exactly that one and nothing else.
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]*/g)].map((m) => m[0]);
    expect([...new Set(urls)]).toEqual(["http://www.w3.org/2000/svg"]);
    expect(html.match(/http:\/\/www\.w3\.org\/2000\/svg/g)!.length).toBe(
      html.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)!.length,
    );
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
  });

  it("declares a policy that would fail loudly if a later edit reached for one", () => {
    const { html } = build();
    expect(html).toContain(`http-equiv="Content-Security-Policy"`);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("frame-ancestors 'none'");
  });

  it("carries no way to run text as code and no way to reach the network", () => {
    const { html } = build();
    for (const forbidden of [
      "eval(",
      "new Function",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "import(",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "document.write",
      "localStorage",
      "sessionStorage",
      "navigator.",
      "location.href",
    ]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
  });

  it("has no anchor a reader could follow out of the file", () => {
    expect(build().html).not.toMatch(/<a\b/i);
  });
});

describe("graph content is data, never markup", () => {
  it("keeps a hostile label out of the document structure", () => {
    const hostile = '</script><img src=x onerror="alert(1)">';
    const source = estateSource();
    const { html } = build({
      model: buildExplorerModel({
        ...source,
        nodes: [...source.nodes, sourceNode("nasty", { label: hostile })],
      }),
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("</script><img");
    // `onerror` does appear -- as the *text* of a box, which is exactly what a
    // faithful drawing of an entity with that name looks like. What must not
    // exist is an event handler, so this checks tag positions rather than the
    // whole file, which is where the difference between text and code lives.
    for (const tag of tagsOutsideScripts(html)) {
      expect(tag, tag).not.toMatch(/\son[a-z]+\s*=/i);
    }
    // The label survives -- escaped. Dropping it would be a quiet reduction
    // with no receipt, which is the other way to get this wrong.
    expect(html).toContain("&lt;/script&gt;");
  });

  it("closes the JSON island against a label that tries to end it early", () => {
    const source = estateSource();
    const { html } = build({
      model: buildExplorerModel({
        ...source,
        nodes: [...source.nodes, sourceNode("island", { label: '</script><script>alert(1)</script>' })],
      }),
    });
    const island = html.slice(html.indexOf(`id="rvs-model"`));
    const body = island.slice(island.indexOf(">") + 1, island.indexOf("</script>"));
    expect(() => JSON.parse(body)).not.toThrow();
    expect(body).toContain("\\u003c");
    expect(body).not.toContain("<");
  });

  it("counts exactly two script elements: the data island and the runtime", () => {
    const { html } = build();
    expect(html.match(/<script/g) ?? []).toHaveLength(2);
    expect(html.match(/<\/script>/g) ?? []).toHaveLength(2);
  });
});

describe("the artifact discloses nothing about the machine that produced it", () => {
  it("writes no absolute path, and drops an evidence reference that carries one", () => {
    const source = estateSource();
    const { html } = build({
      model: buildExplorerModel({
        ...source,
        nodes: [
          ...source.nodes,
          sourceNode("leaky", {
            evidence_refs: [
              { path: "/Users/someone/secret/project/src/leaky.ts", lines: "3-9" },
              { path: "C:\\Users\\someone\\project\\leaky.ts", lines: "1" },
              { path: "src/leaky.ts", lines: "1-4" },
            ],
          }),
        ],
      }),
    });
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("C:\\");
    expect(html).not.toMatch(/"\/[A-Za-z]/);
    // The relative one is kept: an evidence reference a reader can open is the
    // point, and dropping all three would hide the entity's provenance.
    expect(html).toContain("src/leaky.ts:1-4");
  });

  it("carries no timestamp, so two runs a day apart produce the same bytes", () => {
    const first = build();
    const second = build();
    expect(second.html).toBe(first.html);
    expect(second.digest).toBe(first.digest);
    expect(first.html).not.toMatch(/\b20\d{2}-\d{2}-\d{2}T/);
    expect(first.html).not.toMatch(/\b1[6-9]\d{11}\b/);
  });

  it("produces the same artifact five times over", () => {
    const baseline = build();
    for (let run = 0; run < 5; run++) {
      const again = build();
      expect(again.html).toBe(baseline.html);
      expect(again.digest).toBe(baseline.digest);
      expect(again.reachable_entity_ids).toEqual(baseline.reachable_entity_ids);
    }
  });

  it("changes its digest when what it says changes, and not when it does not", () => {
    const faithful = build();
    const simplified = build({ detail_mode: "simplified" });
    expect(simplified.digest).not.toBe(faithful.digest);
    expect(build({ caption: "A different caption" }).digest).toBe(faithful.digest);
  });
});

describe("the artifact says what it shows and what it left out", () => {
  it("puts the fidelity receipt on the page rather than in a file elsewhere", () => {
    const { html, document } = build({ model: buildExplorerModel(chainSource(60)), detail_mode: "simplified" });
    expect(html).toContain("What this view shows");
    expect(html).toContain("Drawn in the overview");
    expect(html).toContain("Not drawn, and named in the receipt");
    for (const code of document.receipt.reason_codes) expect(html).toContain(code);
  });

  it("names every entity it did not draw", () => {
    const artifact = build({ model: buildExplorerModel(chainSource(60)), detail_mode: "simplified" });
    const hidden = artifact.document.coverage.hidden_entity_ids;
    expect(hidden.length).toBeGreaterThan(0);
    expect(artifact.html).toContain(`${hidden.length} entities are not drawn`);
    for (const id of hidden) expect(artifact.html).toContain(id);
  });

  it("states plainly when it hid nothing", () => {
    const artifact = build();
    expect(artifact.document.coverage.hidden_entity_ids).toEqual([]);
    expect(artifact.html).toContain("Every entity is drawn somewhere in this document.");
  });

  it("reports as reachable exactly what it drew somewhere", () => {
    const artifact = build({ model: buildExplorerModel(chainSource(60)), detail_mode: "balanced" });
    expect(artifact.reachable_entity_ids).toEqual(
      [
        ...artifact.document.coverage.primary_entity_ids,
        ...artifact.document.coverage.detail_entity_ids,
      ].sort(),
    );
    expect(artifact.document.coverage.unaccounted_entity_ids).toEqual([]);
  });
});

describe("everything the explorer can do is reachable without a mouse or a colour", () => {
  it("declares a language and a title", () => {
    const { html } = build();
    expect(html).toContain(`<html lang="en">`);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
  });

  it("publishes its keyboard model on the page", () => {
    const { html } = build();
    for (const key of ["/", "Tab / Shift+Tab", "Enter or Space", "Escape"]) expect(html).toContain(key);
    expect(html).toContain("nothing is conveyed by colour alone");
  });

  it("gives every region and control an accessible name", () => {
    const { html } = build();
    for (const name of [
      `aria-label="Explore"`,
      `aria-label="Architecture diagram"`,
      `aria-label="Entity inspector"`,
      `aria-label="What this view shows"`,
      `aria-label="Keyboard help"`,
      `aria-label="Search results"`,
    ]) {
      expect(html).toContain(name);
    }
    for (const control of ["rvs-search", "rvs-lens", "rvs-direction", "rvs-depth", "rvs-route-to"]) {
      expect(html).toContain(`for="${control}"`);
      expect(html).toContain(`id="${control}"`);
    }
  });

  it("announces what changed, rather than only recolouring it", () => {
    const { html } = build();
    expect(html).toContain(`role="status"`);
    expect(html).toContain(`aria-live="polite"`);
    expect(html).toContain(`aria-expanded="false"`);
    expect(html).toContain(`aria-controls="rvs-help"`);
  });

  it("keeps a visible focus ring and honours a request for less motion", () => {
    const { html } = build();
    expect(html).toContain(":focus-visible");
    expect(html).not.toMatch(/outline\s*:\s*(none|0)/);
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("pairs every state colour with a second, non-colour signal", () => {
    // `rvs-muted` changes opacity as well as saturation; focus and route
    // change stroke width. A reader who cannot separate two hues can still
    // separate the states.
    const { html } = build();
    expect(html).toMatch(/\.rvs-muted\s*\{[^}]*opacity/);
    expect(html).toMatch(/\.rvs-focus[^{]*\{[^}]*stroke-width/);
    expect(html).toMatch(/\.rvs-route\s*\{[^}]*stroke-width/);
  });
});
