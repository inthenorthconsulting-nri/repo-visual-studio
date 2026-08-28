import { describe, expect, it } from "vitest";
import { buildExplorerModel } from "../source.js";
import { chainSource, estateSource, shuffled, sourceEdge, sourceNode } from "./fixtures.js";

describe("the explorer's model restates upstream and adds nothing", () => {
  it("draws a container as a container rather than as one more box", () => {
    const model = buildExplorerModel(estateSource());
    expect(model.nodes.map((n) => n.id)).not.toContain("pkg-alpha");
    expect(model.groups.map((g) => g.id).sort()).toEqual(["pkg-alpha", "pkg-beta"]);
    expect(model.groups.find((g) => g.id === "pkg-alpha")!.member_ids).toEqual([
      "alpha-api",
      "alpha-core",
      "alpha-store",
    ]);
    // And the containment arrow goes with it: containment drawn twice, once as
    // a frame and once as an arrow, reads as two different relationships.
    expect(model.edges.some((e) => e.kind === "contains")).toBe(false);
  });

  it("marks a container it did not invent as established upstream", () => {
    // `synthetic` is how a fidelity receipt tells a reader which groupings the
    // system made up. A package that exists on disk is not one of them.
    expect(buildExplorerModel(estateSource()).groups.every((g) => !g.synthetic)).toBe(true);
  });

  it("carries severity, decision status, resolution and confidence through verbatim", () => {
    const model = buildExplorerModel(estateSource());
    const byId = new Map(model.nodes.map((n) => [n.id, n] as const));
    expect(byId.get("beta-worker")!.severity).toBe("blocking");
    expect(byId.get("alpha-core")!.decision_status).toBe("accepted");
    expect(byId.get("alpha-api")!.severity).toBeUndefined();
    expect(model.edges.find((e) => e.id === "e-beta-store-alpha-store")!.resolution).toBe("unresolved");
  });

  it("says nothing about cycles it was not told about", () => {
    // The estate fixture contains a cycle by construction (alpha-core reaches
    // beta-api, beta-store reaches alpha-store). This builder can see it and
    // still declines to claim it: cycles are @rvs/knowledge-graph's finding,
    // and a second detector producing a second answer is a second truth.
    const model = buildExplorerModel(estateSource());
    expect(model.has_cycles).toBe(false);
    expect(model.edges.every((e) => !e.in_cycle)).toBe(true);
  });

  it("keeps the reader's focus and the caller's critical path, and invents neither", () => {
    const model = buildExplorerModel(estateSource());
    expect(model.nodes.find((n) => n.id === "alpha-api")!.emphasis).toBe("focal");
    expect(model.nodes.find((n) => n.id === "alpha-core")!.emphasis).toBe("primary");
    expect(model.nodes.find((n) => n.id === "beta-store")!.emphasis).toBe("normal");
    expect(model.paths).toHaveLength(1);
    expect(model.paths[0].critical).toBe(true);
    expect(model.paths[0].node_ids).toEqual(["alpha-api", "alpha-core", "beta-api"]);

    // One node is not a path. Publishing a one-node "critical path" would be
    // an assertion about a route that nobody made.
    const single = buildExplorerModel({ ...estateSource(), critical_path_node_ids: ["alpha-api"] });
    expect(single.paths).toEqual([]);
  });

  it("drops an edge whose endpoint is not drawn rather than dangling it", () => {
    const source = estateSource();
    const model = buildExplorerModel({
      ...source,
      edges: [...source.edges, sourceEdge("alpha-api", "pkg-beta")],
    });
    const drawn = new Set(model.nodes.map((n) => n.id));
    expect(model.edges.every((e) => drawn.has(e.from_id) && drawn.has(e.to_id))).toBe(true);
  });

  it("chooses one container for a node claimed by two, and chooses the same one every time", () => {
    const source = estateSource();
    const contested = {
      ...source,
      edges: [
        ...source.edges,
        sourceEdge("pkg-beta", "alpha-core", { edge_type: "contains", id: "c-pkg-beta-alpha-core" }),
      ],
    };
    const chosen = buildExplorerModel(contested).nodes.find((n) => n.id === "alpha-core")!.group_id;
    expect(chosen).toBe("pkg-alpha");
    for (let seed = 1; seed <= 5; seed++) {
      const model = buildExplorerModel({ ...contested, edges: shuffled(contested.edges, seed) });
      expect(model.nodes.find((n) => n.id === "alpha-core")!.group_id).toBe(chosen);
    }
  });

  it("produces the same model five times over, and under any input order", () => {
    const source = estateSource();
    const baseline = JSON.stringify(buildExplorerModel(source));
    for (let run = 0; run < 5; run++) {
      expect(JSON.stringify(buildExplorerModel(source))).toBe(baseline);
    }
    for (let seed = 1; seed <= 5; seed++) {
      const model = buildExplorerModel({
        ...source,
        nodes: shuffled(source.nodes, seed),
        edges: shuffled(source.edges, seed * 7),
        severities: shuffled(source.severities ?? [], seed),
        decisions: shuffled(source.decisions ?? [], seed),
      });
      expect(JSON.stringify(model), `seed ${seed}`).toBe(baseline);
    }
  });

  it("draws every source entity that is not a container", () => {
    const source = chainSource(12);
    const model = buildExplorerModel(source);
    expect(model.nodes.map((n) => n.source_entity_id)).toEqual(source.nodes.map((n) => n.source_entity_id));
    expect(model.groups).toEqual([]);
    expect(model.containment_depth).toBe(0);
  });

  it("keeps an unresolved node rather than tidying it away", () => {
    // The one class of entity a diagram is most tempted to drop is the one a
    // reader most needs to see: a reference the analysis could not resolve.
    const source = estateSource();
    const model = buildExplorerModel({
      ...source,
      nodes: [...source.nodes, sourceNode("ghost", { resolution_status: "unresolved", confidence: "unverifiable" })],
    });
    const ghost = model.nodes.find((n) => n.id === "ghost");
    expect(ghost).toBeDefined();
    expect(ghost!.resolution).toBe("unresolved");
    expect(ghost!.confidence).toBe("unverifiable");
  });
});
