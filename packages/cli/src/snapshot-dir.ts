import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphSnapshot, GraphSnapshotState, KnowledgeEdge, KnowledgeNode } from "@rvs/knowledge-graph";

// Reading an archived .rvs/cache/knowledge-graph/ directory.
//
// Shared by `rvs graph compare` and `rvs graph review` so both commands read a
// snapshot the same way. Two readers would eventually disagree about what
// counts as a valid snapshot directory, and the disagreement would show up as
// a review that renders where a comparison refuses, or the reverse.

export interface ReadSnapshotResult extends GraphSnapshotState {
  snapshot: GraphSnapshot;
}

export function readGraphSnapshotDir(repoRoot: string, dir: string): ReadSnapshotResult {
  const absoluteDir = resolve(repoRoot, dir);
  const snapshotPath = resolve(absoluteDir, "graph-snapshot.json");
  const nodesPath = resolve(absoluteDir, "nodes.json");
  const edgesPath = resolve(absoluteDir, "edges.json");
  for (const path of [snapshotPath, nodesPath, edgesPath]) {
    if (!existsSync(path)) {
      throw new Error(
        `Missing "${path}". Expected a directory containing graph-snapshot.json, nodes.json, and edges.json.`,
      );
    }
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as GraphSnapshot;
  const nodes = JSON.parse(readFileSync(nodesPath, "utf8")) as KnowledgeNode[];
  const edges = JSON.parse(readFileSync(edgesPath, "utf8")) as KnowledgeEdge[];
  return { snapshotId: snapshot.id, snapshot, nodes, edges };
}
