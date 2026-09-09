import { describe, expect, it } from "vitest";

describe("Config Barrel", () => {
  it("should export envVars", async () => {
    const config = await import("../index.ts");
    expect(config.envVars).toBeDefined();
    expect(typeof config.envVars).toBe("object");
  });

  it("should export logger", async () => {
    const config = await import("../index.ts");
    expect(config.logger).toBeDefined();
    expect(typeof config.logger.info).toBe("function");
  });
});