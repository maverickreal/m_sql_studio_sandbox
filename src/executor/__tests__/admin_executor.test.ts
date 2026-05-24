import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config", () => ({
  envVars: { PG_USER: "sandbox_user" },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { AdminSqlCodeExecutor } from "../index";

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockEscapeIdentifier = vi.fn((id: string) => `"${id}"`);
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
  escapeIdentifier: mockEscapeIdentifier,
});

vi.mock("../../db", () => ({
  default: {
    getAdmin: vi.fn().mockReturnValue({
      connect: () => mockConnect(),
    }),
  },
}));

describe("AdminSqlCodeExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
      escapeIdentifier: mockEscapeIdentifier,
    });
  });

  it("should create schema and execute initSql", async () => {
    mockQuery.mockResolvedValue({});

    const mockJob: any = {
      data: {
        assignmentId: "abc123",
        initSql: "CREATE TABLE users (id INT);",
      },
    };

    const result = await AdminSqlCodeExecutor.process(mockJob);

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("BEGIN"),
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      "CREATE TABLE users (id INT);",
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("GRANT"),
    );
    expect(mockRelease).toHaveBeenCalled();
  });

  it("should skip initSql query when empty", async () => {
    mockQuery.mockResolvedValue({});

    const mockJob: any = {
      data: {
        assignmentId: "abc123",
        initSql: "   ",
      },
    };

    const result = await AdminSqlCodeExecutor.process(mockJob);

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockRelease).toHaveBeenCalled();
  });

  it("should rollback and throw on failure", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("permission denied for schema"));

    const mockJob: any = {
      data: {
        assignmentId: "abc123",
        initSql: "DROP TABLE users;",
      },
    };

    await expect(AdminSqlCodeExecutor.process(mockJob)).rejects.toThrow(
      "permission denied for schema",
    );
    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK;");
    expect(mockRelease).toHaveBeenCalled();
  });

  it("should release client even when rollback fails", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("init failed"))
      .mockRejectedValueOnce(new Error("rollback failed"));

    const mockJob: any = {
      data: {
        assignmentId: "abc123",
        initSql: "BAD SQL;",
      },
    };

    await expect(AdminSqlCodeExecutor.process(mockJob)).rejects.toThrow(
      "init failed",
    );
    expect(mockRelease).toHaveBeenCalled();
  });
});
