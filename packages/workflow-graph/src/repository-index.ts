import type { ParsedWorkflow, WorkflowRepositoryIndex } from "./types.js";

export function buildRepositoryIndex(parsed: ParsedWorkflow[], generatedAt: string): WorkflowRepositoryIndex {
  return {
    generated_at: generatedAt,
    workflows: parsed
      .map(({ graph, warnings }) => ({
        id: graph.id,
        name: graph.name,
        sourcePath: graph.sourcePath,
        jobCount: graph.metadata.jobCount,
        triggerCount: graph.triggers.length,
        warningCount: warnings.length,
      }))
      .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
  };
}
