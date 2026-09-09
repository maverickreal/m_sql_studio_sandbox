import { describe, expect, it } from "vitest";

describe("Utils Barrel", () => {
  it("should export helpers", async () => {
    const utils = await import("../index.ts");
    expect(utils.SQLSanitiser).toBeDefined();
    expect(utils.compareQueryResults).toBeDefined();
    expect(utils.getSandboxDBSchemaIdForAssignment).toBeDefined();
    expect(utils.SANDBOX_DB_SCHEMA_PREFIX).toBeDefined();
  });

  it("should export constants", async () => {
    const utils = await import("../index.ts");
    expect(utils.ENV_MODE).toBeDefined();
    expect(utils.UNWANTED_SERVICE_TERMINATION_CODE).toBeDefined();
    expect(utils.PG_POOL_MAX).toBeDefined();
    expect(utils.USER_SQL_EXEC_MAX_TIME).toBeDefined();
    expect(utils.USER_SQL_EXEC_MAX_MEM).toBeDefined();
    expect(utils.CONCURRENT_WORKERS_COUNT).toBeDefined();
    expect(utils.MAX_RESULT_ROWS).toBeDefined();
    expect(utils.BULLMQ_JOB_NAME).toBeDefined();
    expect(utils.ADMIN_ASSIGNMENT_SEED_JOB_NAME).toBeDefined();
    expect(utils.CLEANUP_JOB_NAME).toBeDefined();
    expect(utils.SANDBOX_DB_SCHEMA_PREFIX).toBeDefined();
  });
});