// Milestone 11.2: proves the two validation holes identified in the
// architecture closure investigation are now closed IN THIS PACKAGE's own
// canonical validator (validateProposedChangeSet), not merely in the CLI --
// impossible to bypass by calling @rvs/change-workbench directly instead of
// through `rvs change validate`/`evaluate`.

import { describe, expect, it } from "vitest";
import type { ProposalOperation, ProposedChangeSet } from "../contracts.js";
import { CHANGE_WORKBENCH_SCHEMA_VERSION } from "../constants.js";
import { validateProposedChangeSet } from "../validation.js";
import { mutateExistingEntityRef } from "../refs.js";
import { buildProposedChangeSetId } from "../ids.js";
import { baseFixtureGraph, confirmedRef, REPOSITORY_ID } from "./change-workbench-fixtures.js";

const { nodes } = baseFixtureGraph();

function changeSetOf(operations: ProposalOperation[], schemaVersion: unknown = CHANGE_WORKBENCH_SCHEMA_VERSION): ProposedChangeSet {
  return { schema_version: schemaVersion as number, id: buildProposedChangeSetId(REPOSITORY_ID, operations), repository_id: REPOSITORY_ID, operations };
}

/** Builds a ProposedChangeSet with NO schema_version key at all (distinct from passing `undefined` as an argument, which a JS default parameter would substitute away). Mirrors what decodeProposedChangeSet() would hand validateProposedChangeSet() for a document that never declared schema_version. */
function changeSetMissingSchemaVersion(operations: ProposalOperation[]): ProposedChangeSet {
  const { schema_version: _omitted, ...rest } = changeSetOf(operations);
  return rest as ProposedChangeSet;
}

const oneOperation: ProposalOperation[] = [{ kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) }];

describe("validateProposedChangeSet: unsupported schema_version is rejected outright, never silently evaluated as current", () => {
  it("accepts schema_version === CHANGE_WORKBENCH_SCHEMA_VERSION (1)", () => {
    const result = validateProposedChangeSet(changeSetOf(oneOperation, 1), { confirmedNodes: nodes });
    expect(result.issues.some((issue) => issue.code === "unsupported_schema_version")).toBe(false);
  });

  it("rejects schema_version 2 (a future/unsupported version)", () => {
    const result = validateProposedChangeSet(changeSetOf(oneOperation, 2), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "unsupported_schema_version" && issue.blocking)).toBe(true);
  });

  it("rejects a missing schema_version", () => {
    const result = validateProposedChangeSet(changeSetMissingSchemaVersion(oneOperation), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "unsupported_schema_version")).toBe(true);
  });

  it('rejects schema_version as a string ("1")', () => {
    const result = validateProposedChangeSet(changeSetOf(oneOperation, "1"), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "unsupported_schema_version")).toBe(true);
  });

  it("rejects schema_version === null", () => {
    const result = validateProposedChangeSet(changeSetOf(oneOperation, null), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "unsupported_schema_version")).toBe(true);
  });

  it("surfaces the unsupported_schema_version issue at the proposal-level sentinel operation_index (-1), sorted first", () => {
    const result = validateProposedChangeSet(changeSetOf(oneOperation, 99), { confirmedNodes: nodes });
    const issue = result.issues.find((i) => i.code === "unsupported_schema_version");
    expect(issue?.operation_index).toBe(-1);
    expect(result.issues[0].code).toBe("unsupported_schema_version");
  });
});

describe("validateProposedChangeSet: unrecognized operation kind is a deterministic blocking failure", () => {
  it("rejects an operation with an unrecognized kind (e.g. a hypothetical rename_entity)", () => {
    const operations = [{ kind: "rename_entity", ref: "comp-c" } as unknown as ProposalOperation];
    const result = validateProposedChangeSet(changeSetOf(operations), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    const issue = result.issues.find((i) => i.code === "unsupported_operation_kind");
    expect(issue).toBeDefined();
    expect(issue?.blocking).toBe(true);
    expect(issue?.detail).toContain("rename_entity");
  });

  it("rejects an operation with a missing kind field", () => {
    const operations = [{ ref: "comp-c" } as unknown as ProposalOperation];
    const result = validateProposedChangeSet(changeSetOf(operations), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((i) => i.code === "unsupported_operation_kind")).toBe(true);
  });

  it("does not crash detectConflicts (operationKey's exhaustive switch) when an unrecognized-kind operation is mixed with recognized ones", () => {
    const operations: ProposalOperation[] = [
      { kind: "remove_entity", ref: mutateExistingEntityRef(confirmedRef("comp-c", nodes)) },
      { kind: "rename_entity", ref: "comp-b" } as unknown as ProposalOperation,
    ];
    expect(() => validateProposedChangeSet(changeSetOf(operations), { confirmedNodes: nodes })).not.toThrow();
    const result = validateProposedChangeSet(changeSetOf(operations), { confirmedNodes: nodes });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((i) => i.code === "unsupported_operation_kind")).toBe(true);
  });

  it("proves this rejection lives in the canonical validator itself -- calling validateProposedChangeSet directly (no CLI, no file I/O) produces the identical rejection a future MCP/agent/CI caller would get", () => {
    const operations = [{ kind: "totally_made_up_kind" } as unknown as ProposalOperation];
    const result = validateProposedChangeSet(changeSetOf(operations), {});
    expect(result.status).toBe("invalid");
    expect(result.issues.some((i) => i.code === "unsupported_operation_kind")).toBe(true);
  });
});
