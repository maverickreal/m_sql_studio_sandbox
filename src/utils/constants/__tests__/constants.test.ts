import { describe, expect, it } from "vitest";

describe("Constants Barrel", () => {
  it("should export all constants", async () => {
    const constants = await import("../index.ts");
    expect(constants.ENV_MODE).toBeDefined();
    expect(constants.UNWANTED_SERVICE_TERMINATION_CODE).toBeDefined();
    expect(constants.PG_POOL_MAX).toBeDefined();
    expect(constants.USER_SQL_EXEC_MAX_TIME).toBeDefined();
    expect(constants.USER_SQL_EXEC_MAX_MEM).toBeDefined();
    expect(constants.CONCURRENT_WORKERS_COUNT).toBeDefined();
    expect(constants.MAX_RESULT_ROWS).toBeDefined();
    expect(constants.BULLMQ_JOB_NAME).toBeDefined();
    expect(constants.ADMIN_ASSIGNMENT_SEED_JOB_NAME).toBeDefined();
    expect(constants.CLEANUP_JOB_NAME).toBeDefined();
    expect(constants.SANDBOX_DB_SCHEMA_PREFIX).toBeDefined();
  });

  it("should have correct constant values", async () => {
    const constants = await import("../index.ts");
    expect(constants.PG_POOL_MAX).toBe(5);
    expect(constants.USER_SQL_EXEC_MAX_TIME).toBe(5000);
    expect(constants.USER_SQL_EXEC_MAX_MEM).toBe(16);
    expect(constants.CONCURRENT_WORKERS_COUNT).toBe(3);
    expect(constants.MAX_RESULT_ROWS).toBe(100);
    expect(constants.BULLMQ_JOB_NAME).toBe("client_sql_studio_sql_exec");
    expect(constants.ADMIN_ASSIGNMENT_SEED_JOB_NAME).toBe("client_sql_studio_admin_assignment_seed");
    expect(constants.CLEANUP_JOB_NAME).toBe("client_sql_studio_cleanup");
    expect(constants.SANDBOX_DB_SCHEMA_PREFIX).toBe("assignment_schema_");
  });

  it("should have ENV_MODE enum with correct values", async () => {
    const { ENV_MODE } = await import("../index.ts");
    expect(ENV_MODE.DEV).toBe("DEV");
    expect(ENV_MODE.STAGING).toBe("STAGING");
    expect(ENV_MODE.PROD).toBe("PROD");
  });
});