import { describe, expect, it } from "vitest";

describe("Types Barrel", () => {
  it("should export all types", async () => {
    const types = await import("../index.ts");
    // The types are exported at the bottom of the file
    expect(types.UserSqlExecMode).toBeDefined();
  });

  it("should have UserSqlExecMode enum with READ and WRITE", async () => {
    const { UserSqlExecMode } = await import("../index.ts");
    expect(UserSqlExecMode.READ).toBe("read");
    expect(UserSqlExecMode.WRITE).toBe("write");
  });
});