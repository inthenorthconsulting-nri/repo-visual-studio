import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@rvs/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRepositoryModel } from "../repository-model.js";

// Confirms the default exclude patterns (packages/core/src/config.ts)
// actually keep secret-bearing files out of the scanned file list, not
// just that the glob strings are present in the generated config. Uses
// non-dot filenames (server.pem, id.key) so the assertions exercise the
// new exclude patterns themselves rather than fast-glob's separate
// dot:false hidden-file behavior.
let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), "rvs-security-exclusions-"));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const path = join(repoRoot, relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("default source exclusions", () => {
  it("keeps secret-bearing and generated-output files out of the scan even when they sit under an included directory", async () => {
    writeFile("package.json", JSON.stringify({ name: "secure-service" }));
    writeFile("README.md", "# Secure Service\n");
    writeFile("src/index.ts", "export {};\n");
    writeFile("src/certs/server.pem", "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n");
    writeFile("src/keys/id.key", "fake-private-key-material\n");
    writeFile(".rvs/cache/repository-model.json", "{}");
    writeFile("artifacts/visuals/deck.html", "<html></html>");

    const config = defaultConfig("secure-service");
    const model = await buildRepositoryModel(repoRoot, config);
    const paths = model.files.sampledPaths;

    expect(paths).toContain("src/index.ts");
    expect(paths).not.toContain("src/certs/server.pem");
    expect(paths).not.toContain("src/keys/id.key");
    expect(paths.some((p) => p.includes(".rvs/cache"))).toBe(false);
    expect(paths.some((p) => p.startsWith("artifacts/"))).toBe(false);
  });
});
