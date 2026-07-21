import { describe, it, expect } from "vitest";
import { deduplicateNodes, identityKey, resolveNodeIdForEntity } from "../identity.js";
import { buildNodeId } from "../ids.js";
import { makeNode } from "./graph-fixtures.js";

describe("identityKey", () => {
  it("joins source_artifact and source_entity_id with a double-colon", () => {
    expect(identityKey("architecture", "foo")).toBe("architecture::foo");
  });
});

describe("resolveNodeIdForEntity", () => {
  it("delegates to buildNodeId", () => {
    expect(resolveNodeIdForEntity("pkg/foo")).toBe(buildNodeId("pkg/foo"));
  });
});

describe("deduplicateNodes", () => {
  it("returns all nodes unchanged, sorted by id, when identities are distinct", () => {
    const a = makeNode({ sourceEntityId: "b-entity" });
    const b = makeNode({ sourceEntityId: "a-entity" });
    const { nodes, collisions } = deduplicateNodes([a, b]);
    expect(nodes.map((n) => n.id)).toEqual([a.id, b.id].sort());
    expect(collisions).toEqual([]);
  });

  it("keeps the first-encountered candidate when two share (source_artifact, source_entity_id) but have the same id", () => {
    const first = makeNode({ sourceEntityId: "dup-entity", label: "first label" });
    const second = makeNode({ sourceEntityId: "dup-entity", label: "second label" });
    const { nodes, collisions } = deduplicateNodes([first, second]);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.label).toBe("first label");
    // Same source_artifact/source_entity_id -> same node id -> not a collision (single node id per identity).
    expect(collisions).toEqual([]);
  });

  it("records a collision when two different identities (different source_artifact) resolve to the same node id, keeping only the first-encountered node", () => {
    // buildNodeId is a pure function of source_entity_id alone (never source_artifact), so a
    // governance policy and a decision that independently use the identical literal entity id
    // string "collide-entity" collide on node id despite having different identity keys. This is
    // the real "identity collision" this module must guard: without deduping by node id, both
    // candidates would survive into the output nodes array under one duplicate id.
    const first = makeNode({ sourceEntityId: "collide-entity", sourceArtifact: "governance" });
    const second = makeNode({ sourceEntityId: "collide-entity", sourceArtifact: "decision" });
    expect(first.id).toBe(second.id); // same node id despite different identities -- the crux of the collision
    const { nodes, collisions } = deduplicateNodes([first, second]);
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.id).toBe(first.id);
    expect(collisions).toEqual([
      {
        identity_key: [identityKey("governance", "collide-entity"), identityKey("decision", "collide-entity")].sort().join(" | "),
        node_ids: [first.id],
      },
    ]);
  });

  it("treats identical source_entity_id under different source_artifact values as distinct identities that still collide on node id", () => {
    const a = makeNode({ sourceEntityId: "shared-entity-id", sourceArtifact: "architecture" });
    const b = makeNode({ sourceEntityId: "shared-entity-id", sourceArtifact: "capability" });
    const { nodes, collisions } = deduplicateNodes([a, b]);
    // Only one physical node can exist per node id -- the second candidate's distinct identity is
    // recorded as a collision rather than silently producing a second node with a duplicate id.
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.id).toBe(a.id);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.node_ids).toEqual([a.id]);
  });

  it("returns empty arrays for empty input", () => {
    const { nodes, collisions } = deduplicateNodes([]);
    expect(nodes).toEqual([]);
    expect(collisions).toEqual([]);
  });

  it("sorts collisions by identity_key", () => {
    const bFirst = makeNode({ sourceEntityId: "b-collide", sourceArtifact: "governance" });
    const bSecond = makeNode({ sourceEntityId: "b-collide", sourceArtifact: "decision" });
    const aFirst = makeNode({ sourceEntityId: "a-collide", sourceArtifact: "governance" });
    const aSecond = makeNode({ sourceEntityId: "a-collide", sourceArtifact: "decision" });
    const { collisions } = deduplicateNodes([bFirst, bSecond, aFirst, aSecond]);
    expect(collisions.map((c) => c.identity_key)).toEqual(
      [
        [identityKey("governance", "a-collide"), identityKey("decision", "a-collide")].sort().join(" | "),
        [identityKey("governance", "b-collide"), identityKey("decision", "b-collide")].sort().join(" | "),
      ].sort(),
    );
  });
});
