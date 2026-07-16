import { describe, expect, it } from "vitest";
import { defaultConfig, RvsConfigSchema, serializeConfig } from "../config.js";

describe("RvsConfig", () => {
  it("builds a valid default config for a project", () => {
    const config = defaultConfig("order-service");
    expect(() => RvsConfigSchema.parse(config)).not.toThrow();
    expect(config.defaults.audience).toBe("executive");
    expect(config.defaults.design_system).toBe("executive-dark");
  });

  it("round-trips through YAML serialization", () => {
    const config = defaultConfig("order-service");
    const yaml = serializeConfig(config);
    expect(yaml).toContain("name: order-service");
  });
});
