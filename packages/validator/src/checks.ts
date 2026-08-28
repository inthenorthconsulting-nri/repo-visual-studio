export type CheckStatus = "pass" | "fail" | "warn";

export interface SceneCheckResult {
  rule: "overflow" | "node-overlap" | "min-font-size" | "contrast" | "missing-evidence";
  status: CheckStatus;
  message: string;
}

export interface SceneReport {
  scene_id: string;
  scene_index: number;
  scene_type: string;
  checks: SceneCheckResult[];
}

export interface CollectOptions {
  minFontSizePx: number;
  contrastThresholdNormal: number;
  contrastThresholdLarge: number;
  largeTextPx: number;
}

// Runs inside the page via page.evaluate — must be a self-contained function
// with no references to the outer TypeScript module scope.
export function collectSceneReports(options: CollectOptions): SceneReport[] {
  function parseColor(value: string): [number, number, number] {
    const nums = (value.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
    return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
  }

  function relativeLuminance([r, g, b]: [number, number, number]): number {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
    const l1 = relativeLuminance(a) + 0.05;
    const l2 = relativeLuminance(b) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  const scenes = Array.from(document.querySelectorAll<HTMLElement>(".scene"));

  return scenes.map((scene, index) => {
    const checks: SceneCheckResult[] = [];
    const sceneId = scene.dataset.sceneId ?? String(index);
    const sceneType = scene.dataset.sceneType ?? "unknown";

    // --- overflow ---
    const inner = scene.querySelector<HTMLElement>(".scene-inner");
    if (inner) {
      const overflowAmount = inner.scrollHeight - inner.clientHeight;
      if (overflowAmount > 2) {
        checks.push({
          rule: "overflow",
          status: "fail",
          message: `Content overflows by ${Math.round(overflowAmount)}px`,
        });
      } else {
        checks.push({ rule: "overflow", status: "pass", message: "Content fits within the scene bounds" });
      }
    }

    // --- node overlap ---
    //
    // The other layout rule. `overflow` asks whether a fixed-frame scene
    // holds its content; a surface that scrolls on purpose -- the explorer and
    // the change review both do -- declares no `.scene-inner` and so is asked
    // nothing at all by it. That left the layout family reporting "passed"
    // over zero measurements on exactly the two artifacts the delivery gate
    // exists to gate, which is not a pass, it is an absence.
    //
    // What is measured instead is the invariant every grammar in
    // @rvs/visual-grammar is built to hold and none of them states in the
    // output: two entity boxes never occupy the same place. A drawing where
    // they do has lost the thing a reader uses the geometry for -- which box
    // the label belongs to, which box the arrow lands on -- however well the
    // page scrolls.
    //
    // Boxes are compared within one `<svg>` only. A multi-view composition
    // stacks several drawings on one page, and two views' coordinate spaces
    // overlapping in the viewport is the layout working, not failing. The
    // painted rectangle is measured rather than the group, because the group's
    // bounding box includes the change marker a delta view hangs off the
    // corner, and a badge deliberately drawn outside the box is not a
    // collision.
    const drawn: Array<{ root: Element; id: string; left: number; top: number; right: number; bottom: number }> = [];
    for (const el of Array.from(scene.querySelectorAll<HTMLElement>("[data-rvs-node]"))) {
      const root = el.closest("svg");
      if (root === null) continue;
      const shape = el.querySelector("rect") ?? el;
      const measured = shape.getBoundingClientRect();
      // Zero-sized means collapsed or hidden -- a detail view behind
      // `display:none` is not on the page and cannot collide with anything.
      if (measured.width <= 0 || measured.height <= 0) continue;
      drawn.push({
        root,
        id: el.getAttribute("id") ?? el.getAttribute("data-rvs-node") ?? "",
        left: measured.left,
        top: measured.top,
        right: measured.right,
        bottom: measured.bottom,
      });
    }

    // Sorted by position, then id, so the same drawing always reports the same
    // pair first however the DOM happened to be walked.
    drawn.sort((a, b) => a.top - b.top || a.left - b.left || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // A shared border is not an overlap, and neither is a pixel of rounding
    // from the viewBox mapping, so a collision has to be real in both axes.
    const tolerancePx = 2;
    const collisions: string[] = [];
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        const a = drawn[i];
        const b = drawn[j];
        // Sorted by top: once one box starts below another's bottom, so does
        // every box after it.
        if (b.top >= a.bottom - tolerancePx) break;
        if (a.root !== b.root) continue;
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapX > tolerancePx && overlapY > tolerancePx) collisions.push(`${a.id} / ${b.id}`);
      }
    }

    if (drawn.length === 0) {
      checks.push({ rule: "node-overlap", status: "pass", message: "No drawn entities to check" });
    } else if (collisions.length > 0) {
      checks.push({
        rule: "node-overlap",
        status: "fail",
        message: `${collisions.length} overlapping entity box pair(s): ${collisions.slice(0, 3).join(", ")}`,
      });
    } else {
      checks.push({
        rule: "node-overlap",
        status: "pass",
        message: `${drawn.length} entity boxes drawn without overlap`,
      });
    }

    // --- min font size + contrast on visible text elements (excluding footnote citations) ---
    const textElements = Array.from(
      scene.querySelectorAll<HTMLElement>("h1, p, li, span, text"),
    ).filter((el) => !el.closest(".citations") && el.textContent && el.textContent.trim().length > 0);

    // The size a reader actually sees, not the size the markup declares.
    //
    // `getComputedStyle(el).fontSize` on an SVG `<text>` reports the attribute
    // -- 14px -- however the element is transformed on its way to the screen.
    // Grammar SVGs are drawn inside a `<g transform="scale(...)">` that fits
    // the layout to the scene, and the SVG itself is then scaled again by the
    // viewBox mapping when CSS gives it a width other than its intrinsic one.
    // Both shrink the glyph; neither touches the computed style. So a page
    // whose smallest text renders at 9px reported "smallest text is 14.0px"
    // and passed. `getScreenCTM` is the composition of every transform between
    // the element and the viewport, and its uniform scale factor -- the square
    // root of the determinant, which is exact for the uniform scales these
    // renderers emit and a fair average for any other -- converts the declared
    // size into the CSS pixels the text occupies.
    function renderedScale(el: Element): number {
      const graphical = el as SVGGraphicsElement;
      if (typeof graphical.getScreenCTM !== "function") return 1;
      const ctm = graphical.getScreenCTM();
      if (ctm === null) return 1;
      const determinant = Math.abs(ctm.a * ctm.d - ctm.b * ctm.c);
      const scale = Math.sqrt(determinant);
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    let minFontSize = Infinity;
    let worstContrast = Infinity;
    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      const declared = Number.parseFloat(style.fontSize);
      const fontSize = Number.isNaN(declared) ? declared : declared * renderedScale(el);
      if (!Number.isNaN(fontSize)) minFontSize = Math.min(minFontSize, fontSize);

      const bg = window.getComputedStyle(scene).backgroundColor;
      const textColor = style.color;
      const ratio = contrastRatio(parseColor(textColor), parseColor(bg));
      const threshold = fontSize >= options.largeTextPx ? options.contrastThresholdLarge : options.contrastThresholdNormal;
      if (ratio < threshold) worstContrast = Math.min(worstContrast, ratio);
    }

    if (textElements.length === 0) {
      checks.push({ rule: "min-font-size", status: "pass", message: "No text content to check" });
      checks.push({ rule: "contrast", status: "pass", message: "No text content to check" });
    } else {
      checks.push(
        minFontSize < options.minFontSizePx
          ? {
              rule: "min-font-size",
              status: "fail",
              message: `Smallest text is ${minFontSize.toFixed(1)}px (minimum ${options.minFontSizePx}px)`,
            }
          : { rule: "min-font-size", status: "pass", message: `Smallest text is ${minFontSize.toFixed(1)}px` },
      );
      checks.push(
        worstContrast < Infinity
          ? {
              rule: "contrast",
              status: "fail",
              message: `Text/background contrast ratio as low as ${worstContrast.toFixed(2)}:1`,
            }
          : { rule: "contrast", status: "pass", message: "All checked text meets the contrast threshold" },
      );
    }

    // --- missing evidence ---
    const isEvidenceBearingType = sceneType === "headline" || sceneType === "metric" || sceneType === "architecture";
    const hasCitations = Boolean(scene.querySelector(".citations"));
    if (isEvidenceBearingType && !hasCitations) {
      checks.push({
        rule: "missing-evidence",
        status: "warn",
        message: `Scene type "${sceneType}" carries no evidence citations`,
      });
    } else {
      checks.push({ rule: "missing-evidence", status: "pass", message: "Evidence present or not required for this scene type" });
    }

    return { scene_id: sceneId, scene_index: index, scene_type: sceneType, checks };
  });
}
