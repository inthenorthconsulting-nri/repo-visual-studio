import { describe, expect, it } from "vitest";
import type { CapabilityModel } from "@rvs/capability-intelligence";
import { buildProductRelationships } from "../product-relationships.js";
import type { PortfolioRelationshipType } from "../contracts.js";
import { makeCapability, makeCapabilityModel, makePortfolioCapability, makePortfolioCapabilityParticipation, makePortfolioConfig, makePortfolioProduct, makeSourceMetadata } from "./fixtures.js";

describe("buildProductRelationships", () => {
  describe("config-declared relationships (§10 priority 1)", () => {
    it.each<PortfolioRelationshipType>(["upstream_dependency", "downstream_dependency", "shared_platform", "shared_contract"])(
      "a %s approved_relationships entry always wins and produces exactly one confirmed relationship of that type",
      (relationship) => {
        const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
        const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
        const config = makePortfolioConfig({
          products: [
            { id: "product-a", artifact_root: "./artifacts/product-a" },
            { id: "product-b", artifact_root: "./artifacts/product-b" },
          ],
          approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship, note: `Declared: ${relationship}` }],
        });

        const result = buildProductRelationships([productA, productB], new Map(), [], new Map(), config);

        expect(result.relationships).toHaveLength(1);
        const rel = result.relationships[0]!;
        expect(rel.type).toBe(relationship);
        expect(rel.confidence).toBe("confirmed");
        expect(rel.statement).toBe(`Declared: ${relationship}`);
        expect(rel.capabilityIds).toEqual([]);
        expect(rel.evidenceIds).toHaveLength(1);
        expect(result.unresolvedRelationships).toEqual([]);
        expect([rel.productAId, rel.productBId].sort((x, y) => x.localeCompare(y))).toEqual([productA.id, productB.id].sort((x, y) => x.localeCompare(y)));
      },
    );

    it("the config-declared type coexists with, and is not overridden by, a shared_capability relationship for the same pair", () => {
      const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
      const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
      const sharedCapability = makePortfolioCapability({
        coverage: "shared",
        participation: [
          makePortfolioCapabilityParticipation({ productId: productA.id, qualified: false }),
          makePortfolioCapabilityParticipation({ productId: productB.id, qualified: false }),
        ],
      });
      const config = makePortfolioConfig({
        products: [
          { id: "product-a", artifact_root: "./artifacts/product-a" },
          { id: "product-b", artifact_root: "./artifacts/product-b" },
        ],
        approved_relationships: [{ product_a: "product-a", product_b: "product-b", relationship: "upstream_dependency", note: "Declared upstream." }],
      });

      const result = buildProductRelationships([productA, productB], new Map(), [sharedCapability], new Map(), config);

      const types = result.relationships.map((r) => r.type).sort();
      expect(types).toEqual(["shared_capability", "upstream_dependency"]);
      const upstream = result.relationships.find((r) => r.type === "upstream_dependency")!;
      expect(upstream.confidence).toBe("confirmed");
    });

    it("silently skips an approved_relationships entry whose product_a or product_b does not resolve to any known product id or configId, rather than producing a dangling relationship", () => {
      const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
      const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
      const config = makePortfolioConfig({
        products: [
          { id: "product-a", artifact_root: "./artifacts/product-a" },
          { id: "product-b", artifact_root: "./artifacts/product-b" },
        ],
        approved_relationships: [
          { product_a: "product-a", product_b: "nonexistent-product", relationship: "upstream_dependency", note: "Declared upstream." },
          { product_a: "nonexistent-product", product_b: "product-b", relationship: "shared_platform", note: "Declared platform." },
        ],
      });

      const result = buildProductRelationships([productA, productB], new Map(), [], new Map(), config);

      expect(result.relationships).toEqual([]);
      expect(result.unresolvedRelationships).toEqual([]);
    });
  });

  it("two products sharing a normalized capability (shared coverage, 2 participants) produce a shared_capability relationship", () => {
    const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
    const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
    const sharedCapability = makePortfolioCapability({
      id: "portfolio:capability:widget-sync",
      coverage: "shared",
      participation: [
        makePortfolioCapabilityParticipation({ productId: productA.id, qualified: false }),
        makePortfolioCapabilityParticipation({ productId: productB.id, qualified: false }),
      ],
    });

    const result = buildProductRelationships([productA, productB], new Map(), [sharedCapability], new Map(), undefined);

    expect(result.relationships).toHaveLength(1);
    const rel = result.relationships[0]!;
    expect(rel.type).toBe("shared_capability");
    expect([rel.productAId, rel.productBId].sort((x, y) => x.localeCompare(y))).toEqual([productA.id, productB.id].sort((x, y) => x.localeCompare(y)));
    expect(rel.capabilityIds).toEqual([sharedCapability.id]);
    expect(rel.statement).toContain("both implement the same normalized capability");
    expect(result.unresolvedRelationships).toEqual([]);
  });

  describe("actor/workflow-overlap fallback (§10 priority 3)", () => {
    // Two capabilities with zero lexical/domain/workflow/external-system overlap but
    // an identical single actor ("Operator"): capability-pair classification yields
    // "distinct" (score 0.15 < the 0.2 RELATED_FLOOR in capability-relationships.ts)
    // so it produces no capability-level relationship at all, while the products'
    // aggregated actor sets are identical (jaccard 1.0), comfortably above this
    // module's own 0.34 SHARED_ACTOR_THRESHOLD.
    function makeNonOverlappingCapability(sourceLabel: string, purpose: string, domainId: string, workflow: string) {
      return makeCapability({ sourceLabel, purpose, domainId, actors: ["Operator"], workflows: [workflow], externalSystems: [], evidence: [] });
    }

    it("fires when the pair has zero capability-level relationship of any kind", () => {
      const productA = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-a" }) });
      const productB = makePortfolioProduct({ displayName: "Product B", source: makeSourceMetadata({ configId: "product-b" }) });
      const capA = makeNonOverlappingCapability("Alpha Metrics Collector", "Coordinates alpha telemetry readings across nodes.", "aaa111", "alpha-flow");
      const capB = makeNonOverlappingCapability("Bravo Ledger Auditor", "Executes bravo ledger batch tasks nightly.", "bbb222", "bravo-flow");
      productA.currentCapabilityIds = [capA.id];
      productB.currentCapabilityIds = [capB.id];
      const capabilityModelsByProductId = new Map<string, CapabilityModel>([
        [productA.id, makeCapabilityModel({ includedCapabilities: [capA] })],
        [productB.id, makeCapabilityModel({ includedCapabilities: [capB] })],
      ]);

      const result = buildProductRelationships([productA, productB], capabilityModelsByProductId, [], new Map(), undefined);

      expect(result.relationships).toHaveLength(1);
      const rel = result.relationships[0]!;
      expect(rel.type).toBe("shared_actor");
      expect(rel.confidence).toBe("derived");
      expect(rel.statement).toContain("overlapping set of actors");
      expect(result.unresolvedRelationships).toEqual([]);
    });

    it("does not fire for a pair that already has a capability-level (shared_capability) relationship, even with the same actor overlap", () => {
      const productC = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-c" }) });
      const productD = makePortfolioProduct({ displayName: "Product D", source: makeSourceMetadata({ configId: "product-d" }) });
      const capC = makeNonOverlappingCapability("Charlie Metrics Collector", "Coordinates charlie telemetry readings across nodes.", "ccc111", "charlie-flow");
      const capD = makeNonOverlappingCapability("Delta Ledger Auditor", "Executes delta ledger batch tasks nightly.", "ddd222", "delta-flow");
      productC.currentCapabilityIds = [capC.id];
      productD.currentCapabilityIds = [capD.id];
      const capabilityModelsByProductId = new Map<string, CapabilityModel>([
        [productC.id, makeCapabilityModel({ includedCapabilities: [capC] })],
        [productD.id, makeCapabilityModel({ includedCapabilities: [capD] })],
      ]);
      const sharedCapability = makePortfolioCapability({
        id: "portfolio:capability:shared-thing",
        coverage: "shared",
        participation: [
          makePortfolioCapabilityParticipation({ productId: productC.id, qualified: false }),
          makePortfolioCapabilityParticipation({ productId: productD.id, qualified: false }),
        ],
      });

      const result = buildProductRelationships([productC, productD], capabilityModelsByProductId, [sharedCapability], new Map(), undefined);

      const types = result.relationships.map((r) => r.type);
      expect(types).toEqual(["shared_capability"]);
      expect(types).not.toContain("shared_actor");
      expect(types).not.toContain("shared_workflow");
    });
  });

  it("routes an unresolved capability-pair classification into unresolvedRelationships, not relationships", () => {
    const productP = makePortfolioProduct({ source: makeSourceMetadata({ configId: "product-p" }) });
    const productQ = makePortfolioProduct({ displayName: "Product Q", source: makeSourceMetadata({ configId: "product-q" }) });
    // Zero name overlap (so isSameCapability's nameOverlap>0 requirement fails) but
    // identical domain/actors/workflows/externalSystems, so the weighted score
    // (0.55) still clears SAME_CAPABILITY_THRESHOLD (0.5) — evidence disagrees with
    // itself, so capability-relationships.ts must leave it "unresolved" rather than
    // force it into a specific weaker band.
    const capP = makeCapability({
      sourceLabel: "Zephyr Something",
      purpose: "Coordinates zephyr flux control across nodes.",
      domainId: "shared-domain-x",
      actors: ["Operator"],
      workflows: ["shared-flow"],
      externalSystems: ["ext-sys-1"],
      evidence: [],
    });
    const capQ = makeCapability({
      sourceLabel: "Quokka Wombat",
      purpose: "Executes quokka wombat batch tasks nightly.",
      domainId: "shared-domain-x",
      actors: ["Operator"],
      workflows: ["shared-flow"],
      externalSystems: ["ext-sys-1"],
      evidence: [],
    });
    productP.currentCapabilityIds = [capP.id];
    productQ.currentCapabilityIds = [capQ.id];
    const capabilityModelsByProductId = new Map<string, CapabilityModel>([
      [productP.id, makeCapabilityModel({ includedCapabilities: [capP] })],
      [productQ.id, makeCapabilityModel({ includedCapabilities: [capQ] })],
    ]);

    const result = buildProductRelationships([productP, productQ], capabilityModelsByProductId, [], new Map(), undefined);

    expect(result.relationships.some((r) => r.type === "unresolved")).toBe(false);
    expect(result.relationships).toHaveLength(0);
    expect(result.unresolvedRelationships).toHaveLength(1);
    const unresolved = result.unresolvedRelationships[0]!;
    expect(unresolved.type).toBe("unresolved");
    expect(unresolved.confidence).toBe("unresolved");
    expect(unresolved.statement).toContain("could not be confidently classified");
  });
});
