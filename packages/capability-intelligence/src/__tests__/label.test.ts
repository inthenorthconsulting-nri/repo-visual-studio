import { describe, expect, it } from "vitest";
import { humanizeCapabilityName } from "../label.js";
import { label } from "./fixtures.js";

describe("humanizeCapabilityName", () => {
  it("strips a leading implementation verb from a multi-word label", () => {
    const result = humanizeCapabilityName(label("parseQueryGuard"));
    expect(result.displayLabel).toBe("Query Guard");
  });

  it("records the implementation-verb-stripped basis for traceability", () => {
    const result = humanizeCapabilityName(label("load-widget-config"));
    expect(result.basis).toContain("implementation-verb-stripped");
  });

  it("leaves a label with no leading implementation verb unchanged", () => {
    const input = label("Widget Sync Service");
    const result = humanizeCapabilityName(input);
    expect(result).toEqual(input);
  });

  it("leaves a single-word label unchanged even if the word is an implementation verb", () => {
    const input = label("run");
    const result = humanizeCapabilityName(input);
    expect(result).toEqual(input);
  });

  it("never discards the original sourceLabel", () => {
    const result = humanizeCapabilityName(label("execWidgetSync"));
    expect(result.sourceLabel).toBe("execWidgetSync");
  });

  it("appends to, rather than overwrites, an existing basis", () => {
    const withBasis = { ...label("build-report-export"), basis: "environment-heuristic" };
    const result = humanizeCapabilityName(withBasis);
    expect(result.basis).toBe("environment-heuristic, implementation-verb-stripped");
  });
});
