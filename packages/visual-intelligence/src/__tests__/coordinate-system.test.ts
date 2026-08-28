import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_COORDINATE_SYSTEM, fitScale, sceneContentBox, sceneViewBox } from "../coordinate-system.js";

const repoFile = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");

describe("canonical coordinate system", () => {
  it("derives the content box from the stage and the scene padding", () => {
    const { width, height, scene_padding } = CANONICAL_COORDINATE_SYSTEM;
    expect(sceneContentBox()).toEqual({
      width: width - scene_padding.left - scene_padding.right,
      height: height - scene_padding.top - scene_padding.bottom,
    });
  });

  it("emits a viewBox over the content box, not the whole stage", () => {
    // A diagram is authored inside the padded scene area. A viewBox over the
    // full stage would silently shift every coordinate by the padding.
    const box = sceneContentBox();
    expect(sceneViewBox()).toBe(`0 0 ${box.width} ${box.height}`);
  });

  it("fits by the more constrained axis and never upscales past the viewport", () => {
    const { width, height } = CANONICAL_COORDINATE_SYSTEM;
    expect(fitScale(width, height)).toBe(1);
    expect(fitScale(width / 2, height)).toBeCloseTo(0.5, 10);
    expect(fitScale(width, height / 4)).toBeCloseTo(0.25, 10);
  });
});

// Milestone 10.59 asked for the 1280x720 / 1920x1080 ambiguity to be
// resolved and a single canonical coordinate model to exist. The stage size
// was, before this package, an undeclared literal repeated independently in
// three places. These tests pin the three against the contract so the next
// person to change one of them finds out here rather than in a misaligned
// PDF export.
describe("the canonical stage is the one the rest of RVS already uses", () => {
  const { width, height } = CANONICAL_COORDINATE_SYSTEM;

  it("matches the .stage rule in @rvs/renderer-html styles", () => {
    const css = repoFile("packages/renderer-html/src/styles.ts");
    expect(css).toContain(`width: ${width}px`);
    expect(css).toContain(`height: ${height}px`);
  });

  it("matches the fit calculation in the renderer's client script", () => {
    const script = repoFile("packages/renderer-html/src/client-script.ts");
    expect(script).toContain(String(width));
    expect(script).toContain(String(height));
  });

  it("matches the viewport @rvs/validator measures against", () => {
    const validator = repoFile("packages/validator/src/validate.ts");
    expect(validator).toMatch(new RegExp(`width:\\s*${width}`));
    expect(validator).toMatch(new RegExp(`height:\\s*${height}`));
  });

  it("declares a browser scaling baseline rather than assuming one", () => {
    expect(CANONICAL_COORDINATE_SYSTEM.browser_scaling_baseline.device_pixel_ratio).toBe(1);
    expect(CANONICAL_COORDINATE_SYSTEM.browser_scaling_baseline.css_pixels_per_unit).toBe(1);
  });
});
