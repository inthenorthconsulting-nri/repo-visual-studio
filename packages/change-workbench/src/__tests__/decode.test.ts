// Runtime decode boundary (decode.ts): proves the structural/resource-bound/
// prototype-pollution gate ahead of validateProposedChangeSet() works on raw
// `unknown` input the way a hostile or malformed JSON.parse() result would
// actually look -- never a pre-typed fixture, since that would defeat the
// point of a runtime-only check.

import { describe, expect, it } from "vitest";
import { decodeProposedChangeSet, MAX_ARRAY_LENGTH, MAX_JSON_DEPTH, MAX_OBJECT_KEYS, MAX_OPERATION_COUNT, MAX_SERIALIZED_BYTES } from "../decode.js";
import { buildProposedChangeSetId } from "../ids.js";

const VALID_OPERATIONS = [{ kind: "remove_entity", ref: "comp-c" }];

function validRawEnvelope(): unknown {
  return { schema_version: 1, repository_id: "fixture-repo", operations: VALID_OPERATIONS };
}

describe("decodeProposedChangeSet: well-shaped input", () => {
  it("decodes a well-shaped envelope, computing id deterministically and preserving schema_version verbatim", () => {
    const result = decodeProposedChangeSet(validRawEnvelope());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.changeSet.repository_id).toBe("fixture-repo");
    expect(result.changeSet.schema_version).toBe(1);
    expect(result.changeSet.id).toBe(buildProposedChangeSetId("fixture-repo", VALID_OPERATIONS));
  });

  it("discards a caller-supplied id claim rather than trusting it -- id is always recomputed", () => {
    const raw = { ...validRawEnvelope() as Record<string, unknown>, id: "change-workbench:proposal:spoofed:0000000000000000" };
    const result = decodeProposedChangeSet(raw);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.changeSet.id).toBe(buildProposedChangeSetId("fixture-repo", VALID_OPERATIONS));
  });

  it("preserves an unsupported schema_version verbatim rather than rejecting it itself -- that is validateProposedChangeSet's job, not decode's", () => {
    const result = decodeProposedChangeSet({ ...validRawEnvelope() as Record<string, unknown>, schema_version: 2 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.changeSet.schema_version).toBe(2);
  });

  it("preserves an operation with an unrecognized kind (a string) rather than rejecting it itself -- that is validateProposedChangeSet's job", () => {
    const result = decodeProposedChangeSet({ ...validRawEnvelope() as Record<string, unknown>, operations: [{ kind: "rename_entity", ref: "comp-c" }] });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.changeSet.operations[0].kind).toBe("rename_entity");
  });
});

describe("decodeProposedChangeSet: malformed envelope shapes", () => {
  it.each([
    ["null", null],
    ["a bare string", "not an object"],
    ["a number", 42],
    ["an array", [1, 2, 3]],
  ])("rejects %s as the top-level value", (_label, raw) => {
    const result = decodeProposedChangeSet(raw);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("malformed_envelope");
    expect(result.issues[0].blocking).toBe(true);
  });

  it("rejects a missing repository_id", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, operations: VALID_OPERATIONS });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("malformed_envelope");
  });

  it("rejects an empty-string repository_id", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "", operations: VALID_OPERATIONS });
    expect(result.status).toBe("rejected");
  });

  it("rejects a missing operations array", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo" });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("malformed_envelope");
  });

  it("rejects operations that is not an array", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: "not-an-array" });
    expect(result.status).toBe("rejected");
  });

  it("rejects a non-object operation entry", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: ["not-an-object"] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("malformed_operation");
    expect(result.issues[0].operation_index).toBe(0);
  });

  it("rejects an operation missing a string kind field", () => {
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: [{ ref: "comp-c" }] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("malformed_operation");
  });

  it("rejects a non-string title", () => {
    const result = decodeProposedChangeSet({ ...validRawEnvelope() as Record<string, unknown>, title: 12345 });
    expect(result.status).toBe("rejected");
  });

  it("rejects a non-array evidence_refs", () => {
    const result = decodeProposedChangeSet({ ...validRawEnvelope() as Record<string, unknown>, evidence_refs: "not-an-array" });
    expect(result.status).toBe("rejected");
  });
});

describe("decodeProposedChangeSet: resource bounds (§24)", () => {
  it("rejects input whose declared rawByteLength exceeds MAX_SERIALIZED_BYTES", () => {
    const result = decodeProposedChangeSet(validRawEnvelope(), MAX_SERIALIZED_BYTES + 1);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("input_too_large");
  });

  it("accepts input at exactly MAX_SERIALIZED_BYTES", () => {
    const result = decodeProposedChangeSet(validRawEnvelope(), MAX_SERIALIZED_BYTES);
    expect(result.status).toBe("ok");
  });

  it("rejects more than MAX_OPERATION_COUNT operations", () => {
    const operations = Array.from({ length: MAX_OPERATION_COUNT + 1 }, (_, i) => ({ kind: "remove_entity", ref: `comp-${i}` }));
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("too_many_operations");
  });

  it("accepts exactly MAX_OPERATION_COUNT operations", () => {
    const operations = Array.from({ length: MAX_OPERATION_COUNT }, (_, i) => ({ kind: "remove_entity", ref: `comp-${i}` }));
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations });
    expect(result.status).toBe("ok");
  });

  it("rejects a document nested deeper than MAX_JSON_DEPTH", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < MAX_JSON_DEPTH + 5; i++) deep = { nested: deep };
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: [{ kind: "modify_attributes", ref: "comp-c", attributes: { deep } }] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("resource_bound_exceeded");
  });

  it("rejects an object with more than MAX_OBJECT_KEYS own keys", () => {
    const bigAttributes: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_KEYS + 1; i++) bigAttributes[`key-${i}`] = i;
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: [{ kind: "modify_attributes", ref: "comp-c", attributes: bigAttributes }] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("resource_bound_exceeded");
  });

  it("rejects an array longer than MAX_ARRAY_LENGTH anywhere in the document", () => {
    const bigArray = Array.from({ length: MAX_ARRAY_LENGTH + 1 }, (_, i) => i);
    const result = decodeProposedChangeSet({ schema_version: 1, repository_id: "fixture-repo", operations: [{ kind: "modify_attributes", ref: "comp-c", attributes: { bigArray } }] });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("resource_bound_exceeded");
  });
});

describe("decodeProposedChangeSet: prototype-pollution-shaped keys (§25) -- hostile JSON, not TS typing", () => {
  it("rejects __proto__ as an own key at the top level of the envelope (JSON.parse-shaped, not object-literal-shaped)", () => {
    const raw = JSON.parse('{"schema_version":1,"repository_id":"fixture-repo","operations":[],"__proto__":{"polluted":true}}');
    const result = decodeProposedChangeSet(raw);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("prototype_pollution_shaped_key");
  });

  it("rejects constructor as an own key nested inside an operation's attributes bag", () => {
    const raw = JSON.parse('{"schema_version":1,"repository_id":"fixture-repo","operations":[{"kind":"modify_attributes","ref":"comp-c","attributes":{"constructor":{"polluted":true}}}]}');
    const result = decodeProposedChangeSet(raw);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("prototype_pollution_shaped_key");
  });

  it("rejects prototype as an own key nested inside an array element", () => {
    const raw = JSON.parse('{"schema_version":1,"repository_id":"fixture-repo","operations":[{"kind":"add_relation","from_ref":"a","to_ref":"b","edge_type":"depends_on","evidence_refs":[{"prototype":{"polluted":true}}]}]}');
    const result = decodeProposedChangeSet(raw);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("unreachable");
    expect(result.issues[0].code).toBe("prototype_pollution_shaped_key");
  });

  it("confirms a genuine JSON.parse of a hostile payload actually produces an own __proto__ property (proves the attack shape this guards against is real, not hypothetical)", () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
