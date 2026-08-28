import { describe, expect, it } from "vitest";
import { EXPLORER_LENSES, applyLens, reachFrom, searchEntities, traceRoute } from "../interaction.js";
import { buildExplorerModel } from "../source.js";
import { chainSource, estateSource, sourceEdge, sourceNode } from "./fixtures.js";

const estate = () => buildExplorerModel(estateSource());

describe("search answers the question it was asked and orders the answer", () => {
  it("returns nothing for an empty query rather than everything", () => {
    // "No query" and "query that matched nothing" are different states, and a
    // search that answered the first with the whole graph would make the
    // reader believe they had filtered when they had not.
    expect(searchEntities(estate(), "")).toEqual([]);
    expect(searchEntities(estate(), "   ")).toEqual([]);
  });

  it("ranks an exact name above a prefix, a prefix above a substring, and an identifier last", () => {
    const model = buildExplorerModel({
      nodes: [
        sourceNode("core", { label: "Core" }),
        sourceNode("core-adapter", { label: "Core Adapter" }),
        sourceNode("billing", { label: "Billing Core Service" }),
        sourceNode("core-hidden", { label: "Ledger" }),
      ],
      edges: [],
    });
    expect(searchEntities(model, "core").map((h) => h.node_id)).toEqual([
      "core",
      "core-adapter",
      "billing",
      "core-hidden",
    ]);
  });

  it("breaks a tie on identifier, so two runs list results in one order", () => {
    const model = buildExplorerModel({
      nodes: ["zeta", "alpha", "mid"].map((id) => sourceNode(id, { label: `Service ${id}` })),
      edges: [],
    });
    expect(searchEntities(model, "service").map((h) => h.node_id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("is case-insensitive and matches the identifier a policy chose not to draw", () => {
    const hits = searchEntities(estate(), "BETA-WORKER");
    expect(hits[0].source_entity_id).toBe("beta-worker");
  });

  it("respects a limit without pretending the rest did not match", () => {
    const model = buildExplorerModel(chainSource(30));
    expect(searchEntities(model, "n0", 5)).toHaveLength(5);
    expect(searchEntities(model, "n0").length).toBeGreaterThan(5);
  });
});

describe("reach is bounded, and says that it is", () => {
  it("stops at the requested depth and discloses that there is more", () => {
    const model = buildExplorerModel(chainSource(12));
    const reach = reachFrom(model, "n000", { max_depth: 3 });
    expect(reach.node_ids).toEqual(["n000", "n001", "n002", "n003"]);
    expect(reach.truncated).toBe(true);
  });

  it("does not claim truncation when the neighbourhood genuinely ended", () => {
    const model = buildExplorerModel(chainSource(4));
    expect(reachFrom(model, "n000", { max_depth: 10 }).truncated).toBe(false);
  });

  it("records the depth each entity was first reached at", () => {
    const reach = reachFrom(buildExplorerModel(chainSource(6)), "n000", { max_depth: 2 });
    expect(reach.depth_of).toEqual({ n000: 0, n001: 1, n002: 2 });
  });

  it("distinguishes what depends on this from what this depends on", () => {
    const model = estate();
    expect(reachFrom(model, "alpha-core", { max_depth: 1 }).node_ids).toEqual([
      "alpha-core",
      "alpha-store",
      "beta-api",
    ]);
    expect(reachFrom(model, "alpha-core", { direction: "upstream", max_depth: 1 }).node_ids).toEqual([
      "alpha-api",
      "alpha-core",
    ]);
    expect(reachFrom(model, "alpha-core", { direction: "both", max_depth: 1 }).node_ids).toEqual([
      "alpha-api",
      "alpha-core",
      "alpha-store",
      "beta-api",
    ]);
  });

  it("answers an unknown entity with an empty result rather than an invented one", () => {
    expect(reachFrom(estate(), "not-an-entity")).toEqual({
      node_ids: [],
      edge_ids: [],
      depth_of: {},
      truncated: false,
    });
  });

  it("terminates on a cycle instead of walking it forever", () => {
    const model = buildExplorerModel({
      nodes: ["a", "b", "c"].map((id) => sourceNode(id)),
      edges: [sourceEdge("a", "b"), sourceEdge("b", "c"), sourceEdge("c", "a")],
    });
    expect(reachFrom(model, "a", { max_depth: 6 }).node_ids).toEqual(["a", "b", "c"]);
  });
});

describe("a traced route is the shortest one, and the same one every time", () => {
  it("finds the route and the relationships it travelled", () => {
    const route = traceRoute(estate(), "alpha-api", "beta-worker");
    expect(route.found).toBe(true);
    expect(route.node_ids).toEqual(["alpha-api", "alpha-core", "beta-api", "beta-worker"]);
    expect(route.edge_ids).toEqual([
      "e-alpha-api-alpha-core",
      "e-alpha-core-beta-api",
      "e-beta-api-beta-worker",
    ]);
  });

  it("picks the same shortest route when two are equally short", () => {
    // Two two-hop routes exist. Either is a correct answer; only one is a
    // reproducible one, and a diagram that redrew itself differently on the
    // second run would make two reviewers disagree about the same repository.
    const model = buildExplorerModel({
      nodes: ["src", "via-z", "via-a", "dst"].map((id) => sourceNode(id)),
      edges: [
        sourceEdge("src", "via-z"),
        sourceEdge("src", "via-a"),
        sourceEdge("via-z", "dst"),
        sourceEdge("via-a", "dst"),
      ],
    });
    const first = traceRoute(model, "src", "dst");
    expect(first.node_ids).toEqual(["src", "via-a", "dst"]);
    for (let run = 0; run < 5; run++) {
      expect(traceRoute(model, "src", "dst")).toEqual(first);
    }
  });

  it("says no route exists rather than offering a nearly-right one", () => {
    const route = traceRoute(estate(), "beta-worker", "alpha-api");
    expect(route.found).toBe(false);
    expect(route.node_ids).toEqual([]);
  });

  it("finds upstream what it could not find downstream", () => {
    expect(traceRoute(estate(), "beta-worker", "alpha-api", { direction: "upstream" }).found).toBe(true);
  });

  it("treats an entity as trivially routed to itself", () => {
    expect(traceRoute(estate(), "alpha-core", "alpha-core")).toEqual({
      node_ids: ["alpha-core"],
      edge_ids: [],
      found: true,
    });
  });
});

describe("a lens changes emphasis and never membership", () => {
  it("keeps every entity and every relationship, whichever lens is on", () => {
    const model = estate();
    for (const lens of EXPLORER_LENSES) {
      const lensed = applyLens(model, lens.id);
      expect(lensed.nodes.map((n) => n.id), lens.id).toEqual(model.nodes.map((n) => n.id));
      expect(lensed.edges.length, lens.id).toBe(model.edges.length);
    }
  });

  it("brings forward what the lens is about and mutes the rest", () => {
    const governance = applyLens(estate(), "governance");
    const forward = governance.nodes.filter((n) => n.emphasis !== "muted").map((n) => n.id);
    // The blocking finding, and the entity the reader asked about.
    expect(forward.sort()).toEqual(["alpha-api", "beta-worker"]);
  });

  it("never mutes an entity the reader named", () => {
    // Focus is the reader's instruction. A lens that de-emphasised the thing
    // they asked to see would be answering a question nobody asked.
    for (const lens of EXPLORER_LENSES) {
      const lensed = applyLens(estate(), lens.id, ["beta-store"]);
      expect(lensed.nodes.find((n) => n.id === "alpha-api")!.emphasis, lens.id).toBe("focal");
    }
  });

  it("mutes what falls outside an active focus set", () => {
    const focused = applyLens(estate(), "none", ["alpha-core", "alpha-store"]);
    const muted = focused.nodes.filter((n) => n.emphasis === "muted").map((n) => n.id).sort();
    expect(muted).toEqual(["beta-api", "beta-store", "beta-worker"]);
  });

  it("publishes what each lens does in words, not only in a colour", () => {
    for (const lens of EXPLORER_LENSES) {
      expect(lens.label.length, lens.id).toBeGreaterThan(0);
      expect(lens.description.length, lens.id).toBeGreaterThan(10);
    }
  });
});
