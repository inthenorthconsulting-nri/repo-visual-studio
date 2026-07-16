import type { TerraformRepositoryIndex, TerraformTopology } from "./types.js";

// generatedAt is a caller-supplied ISO timestamp (never derived internally
// via `new Date()`), so index generation stays a pure function of its
// inputs and reproducible in tests.
export function buildTerraformRepositoryIndex(topologies: TerraformTopology[], generatedAt: string): TerraformRepositoryIndex {
  return {
    generated_at: generatedAt,
    topologies: topologies
      .map((topology) => ({
        id: topology.id,
        name: topology.name,
        rootModulePath: topology.rootModulePath,
        moduleCount: topology.metadata.moduleCount,
        resourceCount: topology.metadata.resourceCount,
        warningCount: topology.warnings.length,
      }))
      .sort((a, b) => a.rootModulePath.localeCompare(b.rootModulePath)),
  };
}
