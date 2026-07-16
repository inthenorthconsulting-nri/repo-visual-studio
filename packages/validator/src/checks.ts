export type CheckStatus = "pass" | "fail" | "warn";

export interface SceneCheckResult {
  rule: "overflow" | "min-font-size" | "contrast" | "missing-evidence";
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

    // --- min font size + contrast on visible text elements (excluding footnote citations) ---
    const textElements = Array.from(
      scene.querySelectorAll<HTMLElement>("h1, p, li, span, text"),
    ).filter((el) => !el.closest(".citations") && el.textContent && el.textContent.trim().length > 0);

    let minFontSize = Infinity;
    let worstContrast = Infinity;
    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      const fontSize = Number.parseFloat(style.fontSize);
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
