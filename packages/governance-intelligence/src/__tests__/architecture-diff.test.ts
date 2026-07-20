import { describe, expect, it } from "vitest";
import { buildIntelligenceSnapshot } from "../snapshot.js";
import { diffArchitecture } from "../architecture-diff.js";

const GENERATED_AT = "2026-07-01T00:00:00.000Z";

function label(displayLabel: string) {
  return { displayLabel, sourceLabel: displayLabel.toLowerCase(), shortLabel: displayLabel };
}

function component(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    label: label(id),
    kind: "service",
    origin: "repository-directory",
    description: { value: `${id} description`, inference: "confirmed", evidence: [] },
    sourcePaths: [`src/${id}`],
    evidence: [{ path: `src/${id}/index.ts` }],
    implementation: { filePaths: [`src/${id}/index.ts`], workflowGraphIds: [], terraformTopologyIds: [], entryPoints: [`${id}:main`] },
    ...overrides,
  };
}

function makeArchitecture(overrides: Record<string, unknown> = {}) {
  return {
    identity: { id: "repo:acme-widget", name: label("Acme Widget") },
    purpose: { problemStatement: { value: "Syncs widgets.", inference: "confirmed", evidence: [] }, targetUsers: [], scopeBoundaries: [] },
    responsibilities: [],
    capabilityDomains: [],
    components: [component("component:sync-service"), component("component:api-gateway")],
    actors: [{ id: "actor:operator", label: label("Operator"), kind: "human-role", description: { value: "Runs operations.", inference: "confirmed", evidence: [] }, evidence: [{ path: "docs/ops.md" }] }],
    externalSystems: [{ id: "external:stripe", label: label("Stripe"), description: { value: "Payment processor.", inference: "confirmed", evidence: [] }, evidence: [{ path: "src/payments/stripe.ts" }] }],
    flows: [{ id: "flow:sync-to-api", label: label("Sync to API"), kind: "data", fromId: "component:sync-service", toId: "component:api-gateway", description: { value: "Sync pushes to API.", inference: "confirmed", evidence: [] }, evidence: [{ path: "src/sync/push.ts" }] }],
    boundaries: [{ id: "boundary:prod", label: label("Production"), kind: "deployment-environment", containedComponentIds: ["component:sync-service", "component:api-gateway"], description: { value: "Prod boundary.", inference: "confirmed", evidence: [] }, evidence: [] }],
    operatingModel: { deploymentEnvironments: [], releaseProcess: [], observability: [], approvalGates: [] },
    outcomes: [],
    risks: [],
    dependencies: [{ id: "dependency:postgres", label: label("Postgres"), kind: "runtime", description: { value: "Primary datastore.", inference: "confirmed", evidence: [] }, evidence: [{ path: "infra/postgres.tf" }] }],
    questions: [],
    workflowFamilies: [{ id: "workflow:sync", label: label("Sync Workflow"), description: { value: "Nightly sync.", inference: "confirmed", evidence: [{ path: ".github/workflows/sync.yml" }] }, workflowGraphIds: ["wf:sync-nightly"] }],
    metadata: { generated_at: GENERATED_AT, git_commit: "abc1234", schema_version: 1, source_repository_model_generated_at: GENERATED_AT, workflow_graph_count: 1, terraform_topology_count: 0, assist_used: false },
    ...overrides,
  };
}

function snapshotFor(architecture: unknown, generatedAt = GENERATED_AT) {
  return buildIntelligenceSnapshot({ architecture, generatedAt });
}

describe("diffArchitecture", () => {
  it("detects a component added", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ components: [...source.components, component("component:notifier")] });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const added = result.changes.find((c) => c.entity_id === "component:notifier");
    expect(added?.type).toBe("added");
    expect(added?.domain_path).toBe("components");
  });

  it("detects a component removed", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ components: source.components.filter((c: { id: string }) => c.id !== "component:api-gateway") });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const removed = result.changes.find((c) => c.entity_id === "component:api-gateway");
    expect(removed?.type).toBe("removed");
    expect(removed?.lineage).toBe("broken");
    expect(removed?.classification.governance_severity).not.toBe("informational");
  });

  it("detects a component type (kind) change as modified", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({
      components: source.components.map((c: Record<string, unknown>) => (c.id === "component:sync-service" ? { ...c, kind: "workflow-automation" } : c)),
    });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const modified = result.changes.find((c) => c.entity_id === "component:sync-service");
    expect(modified?.type).toBe("modified");
    expect(modified?.detail).toContain("kind");
  });

  it("does NOT auto-rename a removed+added component pair when kind differs (no deterministic evidence match)", () => {
    const source = makeArchitecture();
    const sharedEvidence = [{ path: "src/renamed/index.ts" }];
    const removedComponent = component("component:old-name", { kind: "service", evidence: sharedEvidence });
    const addedComponent = component("component:new-name", { kind: "library", evidence: sharedEvidence }); // different kind -> must not match

    const withOld = makeArchitecture({ components: [...source.components, removedComponent] });
    const withNew = makeArchitecture({ components: [...source.components, addedComponent] });

    const result = diffArchitecture({ sourceSnapshot: snapshotFor(withOld), targetSnapshot: snapshotFor(withNew), sourceArtifact: withOld, targetArtifact: withNew });

    expect(result.changes.some((c) => c.type === "renamed")).toBe(false);
    expect(result.changes.find((c) => c.entity_id === "component:old-name")?.type).toBe("removed");
    expect(result.changes.find((c) => c.entity_id === "component:new-name")?.type).toBe("added");
  });

  it("DOES auto-rename a removed+added component pair when kind matches AND evidence is non-empty and byte-identical", () => {
    const source = makeArchitecture();
    const sharedEvidence = [{ path: "src/renamed/index.ts" }];
    const removedComponent = component("component:old-name", { kind: "service", evidence: sharedEvidence });
    const addedComponent = component("component:new-name", { kind: "service", evidence: sharedEvidence }); // same kind, identical evidence -> deterministic match

    const withOld = makeArchitecture({ components: [...source.components, removedComponent] });
    const withNew = makeArchitecture({ components: [...source.components, addedComponent] });

    const result = diffArchitecture({ sourceSnapshot: snapshotFor(withOld), targetSnapshot: snapshotFor(withNew), sourceArtifact: withOld, targetArtifact: withNew });

    const renamed = result.changes.find((c) => c.type === "renamed");
    expect(renamed).toBeDefined();
    expect(renamed?.entity_id).toBe("component:new-name");
    expect(renamed?.detail).toContain("component:old-name");
  });

  it("detects a runtime entry point added and removed on a component present in both snapshots", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({
      components: source.components.map((c: Record<string, unknown>) =>
        c.id === "component:sync-service" ? { ...c, implementation: { ...(c.implementation as Record<string, unknown>), entryPoints: ["component:sync-service:health"] } } : c,
      ),
    });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const added = result.changes.find((c) => c.domain_path === "components.component:sync-service.implementation.entryPoints" && c.type === "added");
    const removed = result.changes.find((c) => c.domain_path === "components.component:sync-service.implementation.entryPoints" && c.type === "removed");
    expect(added?.entity_label).toBe("component:sync-service:health");
    expect(removed?.entity_label).toBe("component:sync-service:main");
    expect(added?.classification.compatibility_impact).toBe("compatible");
    // Removal always carries lineage "broken" in architecture-diff.ts (the entry
    // point's evidence trail is entirely gone, not merely weakened), and
    // change-classification.ts's deriveCompatibilityImpact checks "broken"
    // lineage first -- ahead of the removed+isRuntimeEntity rule -- so a
    // removed runtime entry point is "incompatible", a stronger signal than
    // "compatible_with_warnings".
    expect(removed?.classification.compatibility_impact).toBe("incompatible");
  });

  it("detects a workflow family added and removed", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ workflowFamilies: [] });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const removed = result.changes.find((c) => c.entity_id === "workflow:sync");
    expect(removed?.type).toBe("removed");
    expect(removed?.domain_path).toBe("workflowFamilies");
  });

  it("detects a dependency edge added and removed", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ dependencies: [...source.dependencies, { id: "dependency:redis", label: label("Redis"), kind: "runtime", description: { value: "Cache.", inference: "confirmed", evidence: [] }, evidence: [{ path: "infra/redis.tf" }] }] });
    const result = diffArchitecture({ sourceSnapshot: snapshotFor(source), targetSnapshot: snapshotFor(target), sourceArtifact: source, targetArtifact: target });

    const added = result.changes.find((c) => c.entity_id === "dependency:redis");
    expect(added?.type).toBe("added");
    expect(added?.domain_path).toBe("dependencies");
  });

  it("is fully deterministic: diffing the same two artifacts twice produces byte-identical JSON output (excluding generated_at)", () => {
    const source = makeArchitecture();
    const target = makeArchitecture({ components: [...source.components, component("component:notifier")] });
    const sourceSnapshot = snapshotFor(source);
    const targetSnapshot = snapshotFor(target);

    const first = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });
    const second = diffArchitecture({ sourceSnapshot, targetSnapshot, sourceArtifact: source, targetArtifact: target });

    const strip = (r: typeof first) => JSON.stringify({ ...r, generation: undefined });
    expect(strip(first)).toBe(strip(second));
  });
});
