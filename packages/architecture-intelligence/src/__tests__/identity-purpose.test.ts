import { describe, expect, it } from "vitest";
import { buildSystemIdentity } from "../synthesize/identity-purpose.js";
import { makeRepositoryModel } from "./fixtures.js";

describe("buildSystemIdentity", () => {
  it("falls back to the repo slug when the README title says nothing the slug doesn't already say", () => {
    // fixtures.ts's default README title equals the project_name.
    const identity = buildSystemIdentity(makeRepositoryModel());
    expect(identity.name.basis).not.toBe("readme-title");
    expect(identity.name.displayLabel).toBe("Sample Platform");
  });

  it("prefers a distinctive README H1 title over the raw repo slug", () => {
    const model = makeRepositoryModel({
      markdown_documents: [
        {
          path: "README.md",
          title: "Enterprise Looker Control Plane",
          leadParagraph: "sample-platform automates release governance for internal services.",
          sections: [],
        },
      ],
    });
    const identity = buildSystemIdentity(model);
    expect(identity.name.basis).toBe("readme-title");
    expect(identity.name.displayLabel).toBe("Enterprise Looker Control Plane");
    expect(identity.evidence.some((e) => e.path === "README.md")).toBe(true);
  });

  it("does not treat a markdown-adapter path fallback title as a product name", () => {
    const model = makeRepositoryModel({
      markdown_documents: [{ path: "README.md", title: "README.md", leadParagraph: "Some lead paragraph.", sections: [] }],
    });
    const identity = buildSystemIdentity(model);
    expect(identity.name.basis).not.toBe("readme-title");
  });

  it("uses the README lead paragraph for oneLineDescription when present", () => {
    const identity = buildSystemIdentity(makeRepositoryModel());
    expect(identity.oneLineDescription.inference).toBe("confirmed");
  });

  it("falls back to the package manifest description when there is no README lead paragraph", () => {
    const model = makeRepositoryModel({
      markdown_documents: [],
      tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json", manifestDescription: "A CLI that automates release governance." },
    });
    const identity = buildSystemIdentity(model);
    expect(identity.oneLineDescription.inference).toBe("derived");
    expect(identity.oneLineDescription.value).toContain("release governance");
    expect(identity.oneLineDescription.evidence[0]?.path).toBe("package.json");
  });

  it("marks oneLineDescription unresolved when neither README nor manifest description is available", () => {
    const model = makeRepositoryModel({
      markdown_documents: [],
      tech_stack: { primaryLanguage: "TypeScript", languages: ["TypeScript"], packageManagers: ["pnpm"], frameworks: ["commander"], manifestFile: "package.json" },
    });
    const identity = buildSystemIdentity(model);
    expect(identity.oneLineDescription.inference).toBe("unresolved");
  });
});
