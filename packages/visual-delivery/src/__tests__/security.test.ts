import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DELIVERY_ROOT_SEGMENTS,
  DeliveryPathError,
  deliveryRoot,
  repoRelative,
  resolveContained,
  resolveTarget,
} from "../security.js";

// Containment.
//
// Every path this package writes to is derived from something a caller
// supplied, and the two ways out of a directory are traversal and links. Both
// are closed here rather than at each writer, so the assertions below are the
// only place either escape has to be caught.
//
// The symlink cases are the ones worth being careful about: a path can be
// inside the root by every string operation and outside it in fact, and only
// the filesystem knows. They are also the cases that need a path that does not
// exist yet -- the file about to be created is exactly the file nobody has
// checked.

describe("staging containment", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rvs-contain-"));
    outside = mkdtempSync(join(tmpdir(), "rvs-outside-"));
    mkdirSync(join(root, "runs", "run-000001"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("accepts an ordinary relative name beneath the root", () => {
    const staged = resolveContained(root, "runs/run-000001/architecture.html", "Candidate staging path");
    expect(staged).toBe(resolve(root, "runs/run-000001/architecture.html"));
  });

  it("refuses traversal out of the root", () => {
    for (const attempt of ["../escaped.html", "../../etc/passwd", "runs/../../escaped.html", "runs/run-000001/../../../x"]) {
      expect(() => resolveContained(root, attempt, "Candidate staging path"), attempt).toThrow(DeliveryPathError);
    }
  });

  it("refuses an absolute path pointing somewhere else", () => {
    expect(() => resolveContained(root, join(outside, "candidate.html"), "Candidate staging path")).toThrow(
      /resolves outside the delivery root/,
    );
  });

  it("refuses a path that is inside the root by name and outside it through a link", () => {
    // The classic escape: the name never leaves the root, and the bytes land
    // in someone else's directory. Only the filesystem can tell.
    symlinkSync(outside, join(root, "linked"));
    expect(() => resolveContained(root, "linked/candidate.html", "Candidate staging path")).toThrow(
      /through a link, which is outside it/,
    );
  });

  it("refuses a link that does not exist yet, by resolving the nearest ancestor that does", () => {
    symlinkSync(outside, join(root, "linked"));
    mkdirSync(join(outside, "deep", "deeper"), { recursive: true });
    expect(() => resolveContained(root, "linked/deep/deeper/not-written-yet.html", "Candidate staging path")).toThrow(
      DeliveryPathError,
    );
  });

  it("reports what was attempted and what the root was, rather than quietly correcting the path", () => {
    try {
      resolveContained(root, "../escaped.html", "Candidate staging path");
      expect.unreachable("containment should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DeliveryPathError);
      const failure = error as DeliveryPathError;
      expect(failure.attempted).toBe(resolve(root, "../escaped.html"));
      expect(failure.root).toBe(root);
      expect(failure.message).toContain("Candidate staging path");
    }
  });

  it("works when the root itself is a path with spaces in it", () => {
    const spaced = join(root, "a directory with spaces");
    mkdirSync(spaced, { recursive: true });
    expect(resolveContained(spaced, "my candidate.html", "Candidate staging path")).toBe(
      join(spaced, "my candidate.html"),
    );
    expect(() => resolveContained(spaced, "../../escaped.html", "Candidate staging path")).toThrow(DeliveryPathError);
  });
});

describe("promotion target containment", () => {
  let repoRoot: string;
  let outside: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "rvs-repo-"));
    outside = mkdtempSync(join(tmpdir(), "rvs-outside-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("accepts a repository-relative target, whether or not it exists yet", () => {
    expect(resolveTarget(repoRoot, "artifacts/visuals/architecture.html")).toBe(
      join(repoRoot, "artifacts/visuals/architecture.html"),
    );
  });

  it("accepts an absolute target inside the repository", () => {
    const absolute = join(repoRoot, ".rvs/out/architecture-explorer.html");
    expect(resolveTarget(repoRoot, absolute)).toBe(absolute);
  });

  it("refuses a target outside the repository, by traversal or by absolute path", () => {
    expect(() => resolveTarget(repoRoot, "../elsewhere.html")).toThrow(/resolves outside the repository/);
    expect(() => resolveTarget(repoRoot, join(outside, "elsewhere.html"))).toThrow(/resolves outside the repository/);
  });

  it("refuses a target that reaches outside through a link", () => {
    mkdirSync(join(repoRoot, "artifacts"), { recursive: true });
    symlinkSync(outside, join(repoRoot, "artifacts", "visuals"));
    expect(() => resolveTarget(repoRoot, "artifacts/visuals/architecture.html")).toThrow(/through a link/);
  });

  it("works when the repository path has spaces in it", () => {
    const spaced = join(repoRoot, "My Repositories", "repo visual studio");
    mkdirSync(spaced, { recursive: true });
    expect(resolveTarget(spaced, "artifacts/visuals/change review.html")).toBe(
      join(spaced, "artifacts/visuals/change review.html"),
    );
    expect(() => resolveTarget(spaced, "../../escaped.html")).toThrow(DeliveryPathError);
  });
});

describe("recorded paths", () => {
  it("records repository-relative paths with forward slashes, whatever the platform separator is", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "rvs-rel-"));
    try {
      expect(repoRelative(repoRoot, join(repoRoot, "artifacts", "visuals", "a.html"))).toBe("artifacts/visuals/a.html");
      expect(repoRelative(repoRoot, repoRoot)).toBe(".");
      expect(repoRelative(repoRoot, join(repoRoot, "a directory", "with spaces.html"))).toBe(
        "a directory/with spaces.html",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("puts every delivery artifact under one cache root", () => {
    expect(DELIVERY_ROOT_SEGMENTS).toEqual([".rvs", "cache", "visual-delivery"]);
    expect(deliveryRoot("/repo")).toBe(join("/repo", ".rvs", "cache", "visual-delivery"));
  });

  it("keeps the delivery root out of Git, so no candidate or verified record is ever committed", () => {
    const gitignore = readFileSync(resolve(import.meta.dirname, "../../../../.gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    // `.rvs/cache/` covers the whole delivery root: staged candidates,
    // receipts, reports and verified records all live beneath it, so none of
    // them can be committed by an ordinary `git add`.
    expect(gitignore).toContain(".rvs/cache/");
    expect(DELIVERY_ROOT_SEGMENTS.slice(0, 2).join("/")).toBe(".rvs/cache");
  });
});
