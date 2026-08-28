// Rendered interaction checks.
//
// Milestone 10.6 needed to answer a question nothing in this repository could
// answer before: does the artifact a reader is about to receive actually work
// for someone driving it from a keyboard, and does it say each thing once?
// The spec-level validators in @rvs/visual-intelligence check what the
// renderer was *asked* to draw. These check what the browser ended up with,
// which is the only place a duplicate id or an unreachable control exists.
//
// They live here, next to `collectSceneReports`, because this package already
// owns "what a real browser sees" -- and because the delivery layer that
// orchestrates them must not become a second place where visual truth is
// defined.

export type RenderedInteractionCode =
  | "RENDERED_DUPLICATE_ELEMENT_ID"
  | "RENDERED_LABELLEDBY_UNRESOLVED"
  | "RENDERED_CONTROL_UNNAMED"
  | "RENDERED_CONTROL_UNREACHABLE"
  | "RENDERED_REDUCED_MOTION_MISSING";

export const RENDERED_INTERACTION_CODES: readonly RenderedInteractionCode[] = [
  "RENDERED_CONTROL_UNNAMED",
  "RENDERED_CONTROL_UNREACHABLE",
  "RENDERED_DUPLICATE_ELEMENT_ID",
  "RENDERED_LABELLEDBY_UNRESOLVED",
  "RENDERED_REDUCED_MOTION_MISSING",
] as const;

export interface InteractionFinding {
  code: RenderedInteractionCode;
  /** What failed: a duplicated id, a control's own id or selector, or the document. */
  subject: string;
  message: string;
}

// Runs inside the page via page.evaluate -- must be a self-contained function
// with no references to the outer TypeScript module scope.
export function collectInteractionFindings(): InteractionFinding[] {
  const findings: InteractionFinding[] = [];

  // --- every id, counted -------------------------------------------------
  //
  // The check that caught the real defect this milestone inherited: one spec
  // rendered as several views minted `-title` and `-desc` once per view, and
  // `aria-labelledby` resolves to the first match in the document, so every
  // detail view was announced with the overview's name. A count is all it
  // takes to see that, and nothing before this looked.
  const counts: Record<string, number> = Object.create(null);
  const withId = Array.from(document.querySelectorAll("[id]"));
  for (const element of withId) {
    const id = element.getAttribute("id") ?? "";
    if (id === "") continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  for (const id of Object.keys(counts).sort()) {
    const count = counts[id];
    if (count > 1) {
      findings.push({
        code: "RENDERED_DUPLICATE_ELEMENT_ID",
        subject: id,
        message:
          'Element id "' +
          id +
          '" appears ' +
          String(count) +
          " times. An id resolves to the first match, so every later reference -- aria-labelledby, a marker, a fragment link -- reaches the wrong element.",
      });
    }
  }

  // --- aria-labelledby that points nowhere -------------------------------
  const labelledBy = Array.from(document.querySelectorAll("[aria-labelledby]"));
  for (const element of labelledBy) {
    const tokens = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((t) => t !== "");
    const missing = tokens.filter((token) => document.getElementById(token) === null);
    if (missing.length > 0) {
      const own = element.getAttribute("id");
      findings.push({
        code: "RENDERED_LABELLEDBY_UNRESOLVED",
        subject: own !== null && own !== "" ? own : element.tagName.toLowerCase(),
        message:
          "aria-labelledby names " +
          missing.sort().join(", ") +
          ", which no element in the document declares. The element is announced with no name at all.",
      });
    }
  }

  // --- controls a keyboard reader can reach and identify ------------------
  const controls = Array.from(
    document.querySelectorAll("button, input, select, textarea, a[href], [tabindex]"),
  ) as HTMLElement[];

  function visible(element: HTMLElement): boolean {
    if (element.hasAttribute("hidden")) return false;
    if (element.closest("[hidden]") !== null) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function describe(element: HTMLElement, index: number): string {
    const id = element.getAttribute("id");
    if (id !== null && id !== "") return id;
    return element.tagName.toLowerCase() + "[" + String(index) + "]";
  }

  function accessibleName(element: HTMLElement): string {
    const ariaLabel = (element.getAttribute("aria-label") ?? "").trim();
    if (ariaLabel !== "") return ariaLabel;

    const tokens = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter((t) => t !== "");
    const referenced = tokens
      .map((token) => document.getElementById(token))
      .filter((el): el is HTMLElement => el !== null)
      .map((el) => (el.textContent ?? "").trim())
      .join(" ")
      .trim();
    if (referenced !== "") return referenced;

    const id = element.getAttribute("id");
    if (id !== null && id !== "") {
      const label = document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
      if (label !== null) {
        const text = (label.textContent ?? "").trim();
        if (text !== "") return text;
      }
    }

    const wrapping = element.closest("label");
    if (wrapping !== null) {
      const text = (wrapping.textContent ?? "").trim();
      if (text !== "") return text;
    }

    const own = (element.textContent ?? "").trim();
    if (own !== "") return own;

    const title = (element.getAttribute("title") ?? "").trim();
    if (title !== "") return title;

    const placeholder = (element.getAttribute("placeholder") ?? "").trim();
    return placeholder;
  }

  controls.forEach((element, index) => {
    if (!visible(element)) return;
    if (element.hasAttribute("disabled")) return;
    const subject = describe(element, index);

    if (accessibleName(element) === "") {
      findings.push({
        code: "RENDERED_CONTROL_UNNAMED",
        subject,
        message:
          "A visible <" +
          element.tagName.toLowerCase() +
          "> carries no accessible name: no label, no aria-label, no aria-labelledby, no text. A reader who reaches it cannot tell what it does.",
      });
    }

    // Reachability, asked the only way that cannot be argued with: put focus
    // on it and see whether focus landed. A negative tabindex is reported
    // separately because such a control is reachable by script and by pointer
    // but never by Tab, and focus() would still succeed on it.
    const tabIndexAttribute = element.getAttribute("tabindex");
    if (tabIndexAttribute !== null && Number(tabIndexAttribute) < 0) {
      findings.push({
        code: "RENDERED_CONTROL_UNREACHABLE",
        subject,
        message:
          "Control carries tabindex=" +
          tabIndexAttribute +
          ", so it is reachable with a pointer and never with a keyboard.",
      });
      return;
    }

    element.focus();
    if (document.activeElement !== element) {
      findings.push({
        code: "RENDERED_CONTROL_UNREACHABLE",
        subject,
        message: "Control cannot take focus, so a keyboard reader cannot operate it.",
      });
    }
  });

  // --- motion a reader cannot turn off -----------------------------------
  //
  // The check is not "does this animate". Static is valid, and a page with no
  // motion is not a failure. The check is: if it animates, is there a
  // reduced-motion path at all.
  const css = Array.from(document.querySelectorAll("style"))
    .map((element) => element.textContent ?? "")
    .join("\n");
  const animates =
    /@keyframes|animation\s*:|transition\s*:/.test(css) || document.querySelector("[data-rvs-motion]") !== null;
  if (animates && !css.includes("prefers-reduced-motion")) {
    findings.push({
      code: "RENDERED_REDUCED_MOTION_MISSING",
      subject: "document",
      message:
        "The document animates but declares no prefers-reduced-motion rule, so a reader who asked their system for less motion still gets all of it.",
    });
  }

  return findings.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0,
  );
}
