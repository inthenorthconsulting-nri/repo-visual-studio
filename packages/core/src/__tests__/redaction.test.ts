import { describe, expect, it } from "vitest";
import { redactSecrets } from "../redaction.js";

describe("redactSecrets", () => {
  it("redacts an AWS access key", () => {
    const { text, redactedCount } = redactSecrets("key = AKIAABCDEFGHIJKLMNOP");
    expect(text).toContain("[REDACTED:aws-access-key]");
    expect(redactedCount).toBe(1);
  });

  it("redacts a private key block", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----";
    const { text } = redactSecrets(input);
    expect(text).toBe("[REDACTED:private-key-block]");
  });

  it("leaves ordinary text untouched", () => {
    const { text, redactedCount } = redactSecrets("Production deployments require approval.");
    expect(text).toBe("Production deployments require approval.");
    expect(redactedCount).toBe(0);
  });
});
