import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock("pg", () => ({
  Pool: class MockPool {
    end = mockEnd;
    on = mockOn;
  },
}));

vi.mock("../../config", () => ({
  envVars: {
    PG_HOST: "localhost",
    PG_PORT: 5432,
    PG_USER: "test",
    PG_PASSWORD: "test",
    PG_DATABASE: "testdb",
    ADMIN_PG_USER: "admin",
    ADMIN_PG_PASSWORD: "admin",
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import DbPoolClient from "../index";

describe("DbPoolClient", () => {
  beforeEach(async () => {
    await DbPoolClient.disconnect();
    vi.clearAllMocks();
  });

  it("should create Pool on connect", () => {
    DbPoolClient.connect();

    const pool = DbPoolClient.get();
    expect(pool).toBeDefined();
    expect(pool.end).toBeDefined();
  });

  it("should no-op on second connect", () => {
    DbPoolClient.connect();
    const pool1 = DbPoolClient.get();
    DbPoolClient.connect();
    const pool2 = DbPoolClient.get();

    expect(pool1).toBe(pool2);
  });

  it("should return pool from get after connect", () => {
    DbPoolClient.connect();

    const pool = DbPoolClient.get();
    expect(pool).toBeDefined();
    expect(pool.on).toBeDefined();
  });

  it("should throw from get when not connected", () => {
    expect(() => DbPoolClient.get()).toThrow(
      "PostgreSQL client instance from null pool sought!",
    );
  });

  it("should end pool on disconnect", async () => {
    DbPoolClient.connect();

    await DbPoolClient.disconnect();

    expect(mockEnd).toHaveBeenCalledTimes(2);
    expect(() => DbPoolClient.get()).toThrow();
    expect(() => DbPoolClient.getAdmin()).toThrow();
  });

  it("should return admin pool after connect", () => {
    DbPoolClient.connect();

    const adminPool = DbPoolClient.getAdmin();
    expect(adminPool).toBeDefined();
    expect(adminPool.end).toBeDefined();
  });

  it("should throw from getAdmin when not connected", () => {
    expect(() => DbPoolClient.getAdmin()).toThrow(
      "Admin PostgreSQL client instance from null pool sought!",
    );
  });
});
