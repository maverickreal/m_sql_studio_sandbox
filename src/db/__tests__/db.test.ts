import { describe, expect, it, vi, beforeEach } from "vitest";

const mockPoolOn = vi.fn();
const mockPoolEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  const MockPool = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.on = mockPoolOn;
    this.end = mockPoolEnd;
  });
  return {
    Pool: MockPool,
  };
});

import DbPoolClient from "../index";
import { Pool } from "pg";

describe("DbPoolClient", () => {
  beforeEach(async () => {
    await DbPoolClient.disconnect();
    vi.clearAllMocks();
  });

  it("should throw error if get() or getAdmin() is called before connect()", () => {
    expect(() => DbPoolClient.get()).toThrow(
      "PostgreSQL client instance from null pool sought!",
    );
    expect(() => DbPoolClient.getAdmin()).toThrow(
      "Admin PostgreSQL client instance from null pool sought!",
    );
  });

  it("should initialize Pools on connect() and return them", () => {
    DbPoolClient.connect();

    expect(Pool).toHaveBeenCalledTimes(2);
    expect(DbPoolClient.get()).toBeDefined();
    expect(DbPoolClient.getAdmin()).toBeDefined();
    expect(mockPoolOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("should end pool instances and set to null on disconnect()", async () => {
    DbPoolClient.connect();
    await DbPoolClient.disconnect();

    expect(mockPoolEnd).toHaveBeenCalledTimes(2);
    expect(() => DbPoolClient.get()).toThrow();
    expect(() => DbPoolClient.getAdmin()).toThrow();
  });
});