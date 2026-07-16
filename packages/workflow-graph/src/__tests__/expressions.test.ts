import { describe, expect, it } from "vitest";
import { classifyExpressionConfidence, containsExpression, scanExpressions } from "../expressions.js";

describe("scanExpressions", () => {
  it("extracts expression bodies and reports dynamism", () => {
    const result = scanExpressions("${{ matrix.os }}");
    expect(result.isDynamic).toBe(true);
    expect(result.expressions).toEqual(["matrix.os"]);
  });

  it("extracts multiple expressions from one value", () => {
    const result = scanExpressions("${{ github.workflow }}-${{ github.ref }}");
    expect(result.expressions).toEqual(["github.workflow", "github.ref"]);
  });

  it("reports no expressions for a plain literal", () => {
    const result = scanExpressions("ubuntu-latest");
    expect(result.isDynamic).toBe(false);
    expect(result.expressions).toEqual([]);
  });
});

describe("classifyExpressionConfidence", () => {
  it("is confirmed when there are no expressions", () => {
    expect(classifyExpressionConfidence([])).toBe("confirmed");
  });

  it("is partially-resolved when every expression references a statically-known context", () => {
    expect(classifyExpressionConfidence(["github.repository"])).toBe("partially-resolved");
    expect(classifyExpressionConfidence(["github.repository_owner", "github.workflow"])).toBe("partially-resolved");
  });

  it("is dynamic when any expression references a non-static context", () => {
    expect(classifyExpressionConfidence(["matrix.os"])).toBe("dynamic");
    expect(classifyExpressionConfidence(["github.repository", "inputs.previous_job"])).toBe("dynamic");
  });
});

describe("containsExpression", () => {
  it("detects a GitHub Actions expression in a string", () => {
    expect(containsExpression("${{ matrix.os }}")).toBe(true);
    expect(containsExpression("build-and-${{ inputs.env }}")).toBe(true);
  });

  it("returns false for plain strings and non-strings", () => {
    expect(containsExpression("ubuntu-latest")).toBe(false);
    expect(containsExpression(undefined)).toBe(false);
    expect(containsExpression(42)).toBe(false);
  });

  it("is stateless across repeated calls on the same value (no lastIndex bug)", () => {
    const value = "${{ matrix.os }}";
    expect(containsExpression(value)).toBe(true);
    expect(containsExpression(value)).toBe(true);
    expect(containsExpression(value)).toBe(true);
  });
});
