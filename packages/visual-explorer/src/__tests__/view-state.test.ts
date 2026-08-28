import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_STATE,
  MAX_REACH_DEPTH,
  decodeViewState,
  encodeViewState,
  type ExplorerViewState,
} from "../view-state.js";
import { buildExplorerModel } from "../source.js";
import { estateSource } from "./fixtures.js";

const model = buildExplorerModel(estateSource());
const decode = (encoded: string) => decodeViewState(encoded, model);

describe("a shared view reopens where the reader left it", () => {
  it("round-trips a complete state", () => {
    const state: ExplorerViewState = {
      focus: "alpha-core",
      route_to: "beta-store",
      direction: "both",
      depth: 4,
      lens: "governance",
      query: "beta",
    };
    const decoded = decode(encodeViewState(state));
    expect(decoded.rejected).toEqual([]);
    expect(decoded.state).toEqual(state);
  });

  it("round-trips the default state, and encodes nothing it does not need to", () => {
    const encoded = encodeViewState(DEFAULT_VIEW_STATE);
    expect(encoded).toBe("d=downstream&n=2&l=none");
    expect(decode(encoded).state).toEqual(DEFAULT_VIEW_STATE);
  });

  it("tolerates the leading fragment marker a browser hands back", () => {
    expect(decode("#f=alpha-core").state.focus).toBe("alpha-core");
  });

  it("produces the same encoding for the same state every time", () => {
    const state: ExplorerViewState = { focus: "beta-api", direction: "upstream", depth: 1, lens: "evidence", query: "api" };
    const baseline = encodeViewState(state);
    for (let run = 0; run < 5; run++) expect(encodeViewState(state)).toBe(baseline);
  });
});

describe("a view state names entities, and nothing else", () => {
  it("refuses an entity this artifact does not contain", () => {
    // The security property of the whole file. An id that is not in *this*
    // model never becomes state, so nothing downstream is ever asked to
    // resolve it.
    const decoded = decode("f=some-other-repository-entity");
    expect(decoded.state.focus).toBeUndefined();
    expect(decoded.rejected).toEqual(['unknown entity "some-other-repository-entity"']);
  });

  it("refuses a filesystem path dressed as an entity", () => {
    for (const hostile of [
      "/etc/passwd",
      "../../../../etc/passwd",
      "C:\\Users\\someone\\.ssh\\id_rsa",
      "file:///etc/passwd",
      "https://example.invalid/steal",
    ]) {
      const decoded = decode(`f=${encodeURIComponent(hostile)}`);
      expect(decoded.state.focus, hostile).toBeUndefined();
      expect(decoded.rejected.length, hostile).toBe(1);
    }
  });

  it("refuses a route destination on the same terms as a focus", () => {
    const decoded = decode("f=alpha-core&t=/var/log/system.log");
    expect(decoded.state.focus).toBe("alpha-core");
    expect(decoded.state.route_to).toBeUndefined();
    expect(decoded.rejected).toHaveLength(1);
  });

  it("keeps a rejection message from becoming a place to hide a payload", () => {
    const decoded = decode(`f=${encodeURIComponent("<img src=x onerror=alert(1)>".repeat(6))}`);
    expect(decoded.rejected).toHaveLength(1);
    expect(decoded.rejected[0]).not.toContain("<");
    expect(decoded.rejected[0]).not.toContain(">");
    expect(decoded.rejected[0].length).toBeLessThan(80);
  });
});

describe("a malformed field is reported, never silently ignored", () => {
  it("bounds the traversal depth a state may ask for", () => {
    expect(decode("n=3").state.depth).toBe(3);
    for (const bad of [String(MAX_REACH_DEPTH + 1), "-1", "1e9", "2.5", "Infinity", "NaN", ""]) {
      const decoded = decode(`n=${bad}`);
      expect(decoded.state.depth, bad).toBe(DEFAULT_VIEW_STATE.depth);
      expect(decoded.rejected.length, bad).toBe(1);
    }
  });

  it("refuses an unknown lens or direction", () => {
    expect(decode("l=secret").rejected).toEqual(['unknown lens "secret"']);
    expect(decode("d=sideways").rejected).toEqual(['unknown direction "sideways"']);
    expect(decode("l=secret").state.lens).toBe("none");
  });

  it("refuses a query a search box would never receive", () => {
    const decoded = decode(`q=${encodeURIComponent("<script>alert(1)</script>")}`);
    expect(decoded.state.query).toBe("");
    expect(decoded.rejected).toEqual(["query contained characters a search box does not accept"]);
    // And accepts one a reader plausibly typed.
    expect(decode("q=alpha-core").state.query).toBe("alpha-core");
  });

  it("names an unknown or malformed field rather than skipping past it", () => {
    const decoded = decode("z=1&novalue&f=alpha-core");
    expect(decoded.state.focus).toBe("alpha-core");
    expect(decoded.rejected.sort()).toEqual(['malformed field "novalue"', 'unknown field "z"']);
  });

  it("survives an undecodable value", () => {
    const decoded = decode("q=%E0%A4%A");
    expect(decoded.rejected).toEqual(['undecodable value for "q"']);
    expect(decoded.state).toEqual(DEFAULT_VIEW_STATE);
  });

  it("returns the default state for an empty fragment, with nothing to report", () => {
    expect(decode("")).toEqual({ state: DEFAULT_VIEW_STATE, rejected: [] });
    expect(decode("#")).toEqual({ state: DEFAULT_VIEW_STATE, rejected: [] });
  });
});
