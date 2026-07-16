const MAX_LABEL_LENGTH = 80;

// Mermaid node labels are wrapped in double quotes; quotes and angle
// brackets inside the label must be entity-escaped or they break parsing.
// Newlines are flattened to spaces since GH Actions `run:` blocks are
// frequently multi-line.
export function escapeMermaidLabel(raw: string): string {
  const flattened = raw.replace(/\r?\n/g, " ").trim();
  const truncated = flattened.length > MAX_LABEL_LENGTH ? `${flattened.slice(0, MAX_LABEL_LENGTH - 1)}…` : flattened;
  return truncated.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Mermaid node/edge ids must avoid characters like `:`, `.`, spaces that our
// deterministic WorkflowGraph ids otherwise use freely.
export function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}
