export interface RedactionResult {
  text: string;
  redactedCount: number;
}

interface SecretPattern {
  name: string;
  pattern: RegExp;
}

// Deterministic, regex-based secret detection. Not exhaustive — a fast first
// line of defense so scanned repository text never carries obvious
// credentials into evidence manifests or narrative briefs.
const SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "generic-assignment", pattern: /((?:api|secret|access)[-_]?(?:key|token)|password)\s*[:=]\s*["']?[A-Za-z0-9/+_-]{12,}["']?/gi },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

export function redactSecrets(text: string): RedactionResult {
  let redactedCount = 0;
  let result = text;
  for (const { name, pattern } of SECRET_PATTERNS) {
    result = result.replace(pattern, () => {
      redactedCount += 1;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: result, redactedCount };
}
