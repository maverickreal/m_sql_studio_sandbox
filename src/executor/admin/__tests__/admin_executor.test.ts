import { describe, expect, it, vi, beforeEach } from "vitest";
import AdminSqlCodeExecutor from "../index";
import DbPoolClient from "../../../db";

vi.mock("../../../db", () => {
  return {
    default: {
      getAdmin: vi.fn(),
    },
  };
});

describe("AdminSqlCodeExecutor", () => {
  let mockClient: any;
  let mockAdminPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      escapeIdentifier: vi.fn((id: string) => `"${id}"`),
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      release: vi.fn(),
    };
    mockAdminPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
    (DbPoolClient.getAdmin as any).mockReturnValue(mockAdminPool);
  });

  it("should process admin seeding job successfully", async () => {
    const job: any = {
      data: {
        assignmentId: "seed123",
        initSql: "CREATE TABLE items (id INT);",
      },
    };

    const result = await AdminSqlCodeExecutor.process(job);

    expect(DbPoolClient.getAdmin).toHaveBeenCalled();
    expect(mockAdminPool.connect).toHaveBeenCalled();
    expect(mockClient.escapeIdentifier).toHaveBeenCalledWith(
      "assignment_schema_seed123",
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE SCHEMA IF NOT EXISTS"),
    );
    expect(mockClient.query).toHaveBeenCalledWith("CREATE TABLE items (id INT);");
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("GRANT USAGE ON SCHEMA"),
    );
    expect(mockClient.release).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("should skip running initSql when initSql is whitespace", async () => {
    const job: any = {
      data: {
        assignmentId: "seed123",
        initSql: "   ",
      },
    };

    const result = await AdminSqlCodeExecutor.process(job);

    expect(result).toEqual({ success: true });
    expect(mockClient.query).toHaveBeenCalledTimes(2); // BEGIN/CREATE SCHEMA + GRANT/REVOKE/COMMIT
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("should execute ROLLBACK and rethrow error when database query fails", async () => {
    const job: any = {
      data: {
        assignmentId: "seed123",
        initSql: "INVALID SQL STATEMENT;",
      },
    };

    mockClient.query
      .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN; CREATE SCHEMA...
      .mockRejectedValueOnce(new Error("syntax error at or near INVALID")); // initSql fail

    await expect(AdminSqlCodeExecutor.process(job)).rejects.toThrow(
      "syntax error at or near INVALID",
    );

    expect(mockClient.query).toHaveBeenCalledWith("ROLLBACK;");
    expect(mockClient.release).toHaveBeenCalled();
  });
});
