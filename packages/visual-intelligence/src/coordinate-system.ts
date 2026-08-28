// Milestone 10.59's coordinate-system audit, expressed as a contract rather
// than as prose in a document nobody can assert against.
//
// The ambiguity this resolves: before Milestone 10 the number 1280x720
// appeared independently in three subsystems that never referenced each
// other --
//
//   * @rvs/renderer-html/src/styles.ts  .stage { width: 1280px; height: 720px }
//   * @rvs/renderer-html/src/client-script.ts  scale = min(innerW/1280, innerH/720)
//   * @rvs/validator/src/validate.ts    page viewport { width: 1280, height: 720 }
//
// ...plus @rvs/workflow-svg and @rvs/terraform-svg, which lay out into their
// own intrinsic SVG canvases and are then scaled to fit by CSS. Nothing
// declared which of those was authoritative, so a change to one silently
// desynchronised the others.
//
// From Milestone 10 forward there is exactly one canonical authoring
// coordinate system, declared here, and every subsystem that needs a
// dimension derives it from this module rather than restating a literal.

/**
 * The single canonical authoring coordinate space.
 *
 * Everything Milestone 10 lays out -- grammar SVG geometry, interactive
 * hit-boxes, split-view budgets -- is authored in these units. Presentation
 * surfaces scale *uniformly* from here; they never re-author at a different
 * size, because a non-uniform or re-authored scale would make a hit-box
 * computed in one subsystem wrong in another.
 */
export const CANONICAL_COORDINATE_SYSTEM = {
  id: "rvs-stage-16x9-v1",
  /** Authoring width in canonical units (1 unit == 1 CSS pixel at scale 1). */
  width: 1280,
  /** Authoring height in canonical units. */
  height: 720,
  aspect_ratio: "16:9",
  /**
   * The scene padding already baked into `.scene` in @rvs/renderer-html.
   * Grammar renderers subtract it to get their usable content box rather
   * than re-deriving it from the CSS.
   */
  scene_padding: { top: 72, right: 96, bottom: 72, left: 96 },
  /**
   * Browsers rasterise this stage at devicePixelRatio 1 for validation and
   * for PDF export, so a "pixel" in a validator report and a canonical unit
   * are the same thing. Recorded explicitly because contrast and font-size
   * checks are only meaningful against a stated rasterisation baseline.
   */
  browser_scaling_baseline: { device_pixel_ratio: 1, css_pixels_per_unit: 1 },
} as const;

export type CoordinateSystem = typeof CANONICAL_COORDINATE_SYSTEM;

/** The usable content box inside a scene, in canonical units. */
export function sceneContentBox(): { width: number; height: number } {
  const { width, height, scene_padding: pad } = CANONICAL_COORDINATE_SYSTEM;
  return {
    width: width - pad.left - pad.right,
    height: height - pad.top - pad.bottom,
  };
}

/**
 * The SVG `viewBox` every Milestone 10 grammar emits for a full-scene
 * diagram. Returned as a string in the exact form an SVG attribute takes so
 * no caller has to compose (and mis-order) it.
 */
export function sceneViewBox(): string {
  const box = sceneContentBox();
  return `0 0 ${box.width} ${box.height}`;
}

/**
 * The uniform scale that fits the canonical stage into a viewport. Shared by
 * the deck client script and the interactive explorer so both compute an
 * identical transform -- which is what makes an interactive hit-box
 * expressed in canonical units land where the reader sees the shape.
 */
export function fitScale(viewportWidth: number, viewportHeight: number): number {
  const { width, height } = CANONICAL_COORDINATE_SYSTEM;
  return Math.min(viewportWidth / width, viewportHeight / height);
}
