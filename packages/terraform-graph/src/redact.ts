import { redactSecrets } from "@rvs/core";

// Primary redaction layer: key-name pattern matching, applied to every
// attribute captured from a resource/provider/backend/module block before
// it ever reaches metadata (spec section 16). Deliberately narrow and
// compound (e.g. "access_key", not bare "key") so identifiers like
// "key_name" are never redacted just for containing the substring "key".
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "secret",
  "token",
  "private_key",
  "access_key",
  "client_secret",
  "connection_string",
];

export const REDACTED_PLACEHOLDER = "[redacted]";

export function isSensitiveKeyName(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

// Shallow: only top-level attribute keys of a block body are checked. Blocks
// are captured at whole-attribute granularity (spec 4.3's "selected
// non-sensitive attributes"), never as deeply nested arbitrary blobs, so a
// shallow pass is sufficient here.
export function redactAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    out[key] = isSensitiveKeyName(key) ? REDACTED_PLACEHOLDER : value;
  }
  return out;
}

// Secondary safety net over raw expression/attribute text (content-pattern
// based, reusing @rvs/core's scanner) — catches secrets that leaked through
// a key name the pattern list above didn't anticipate.
export function redactValueText(value: string): string {
  return redactSecrets(value).text;
}
