import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("Env Module", () => {
  const originalEnv = { ...process.env };

  const validEnv = {
    REDIS_URL: "redis://localhost:6379",
    PG_HOST: "localhost",
    PG_PORT: "5432",
    PG_DATABASE: "test_db",
    PG_USER: "user",
    PG_PASSWORD: "password",
    ADMIN_PG_USER: "admin_user",
    ADMIN_PG_PASSWORD: "admin_password",
    BULLMQ_SQL_QUEUE_NAME: "test_queue",
    LOG_LEVEL: "info",
    ENV_MODE: "DEV",
    LOG_DIR: "/tmp/logs",
    API_GATEWAY_URL: "http://localhost:3000",
    INTERNAL_API_KEY: "secret_key",
  };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...validEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("should successfully load envVars when all required environment variables are present and valid", async () => {
    const envVars = (await import("../index")).default;
    expect(envVars.REDIS_URL).toBe("redis://localhost:6379");
    expect(envVars.PG_HOST).toBe("localhost");
    expect(envVars.PG_PORT).toBe(5432);
    expect(envVars.PG_DATABASE).toBe("test_db");
    expect(envVars.SANDBOX_SCHEMA_TTL_DAYS).toBe(7);
    expect(envVars.SANDBOX_CLEANUP_CONCURRENCY).toBe(3);
  });

  it("should call process.exit when required environment variables are missing", async () => {
    delete process.env.REDIS_URL;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../index");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Invalid environment variables:",
      expect.any(String),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should call process.exit when an environment variable is invalid", async () => {
    process.env.LOG_LEVEL = "invalid_level";
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../index");

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});