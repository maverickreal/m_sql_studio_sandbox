import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("pino-roll", () => ({
  default: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn().mockImplementation(() => ({
    write: vi.fn(),
    end: vi.fn(),
  })),
}));

describe("Logger Config", () => {
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

  it("should export a logger instance with pino", async () => {
    const { default: logger } = await import("../index.ts");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("should have correct log level from env", async () => {
    process.env.LOG_LEVEL = "debug";
    vi.resetModules();
    const { default: logger } = await import("../index.ts");
    expect(logger.level).toBe("debug"); // debug level as string
  });

  it("should work in DEV mode with pretty transport", async () => {
    process.env.ENV_MODE = "DEV";
    vi.resetModules();
    const { default: logger } = await import("../index.ts");
    expect(logger).toBeDefined();
  });

  it("should work in PROD mode without pretty transport", async () => {
    process.env.ENV_MODE = "PROD";
    vi.resetModules();
    const { default: logger } = await import("../index.ts");
    expect(logger).toBeDefined();
  });
});