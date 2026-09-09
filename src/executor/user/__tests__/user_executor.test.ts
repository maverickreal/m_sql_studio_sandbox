import { describe, expect, it, vi, beforeEach } from "vitest";
import UserSqlCodeExecutor from "../index";
import DbPoolClient from "../../../db";
import { UserSqlExecMode } from "../../../types";

vi.mock("../../../db", () => {
  return {
    default: {
      get: vi.fn(),
    },
  };
});

describe("UserSqlCodeExecutor", () => {
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      escapeIdentifier: vi.fn((id: string) => `"${id}"`),
      query: vi.fn(),
      release: vi.fn(),
    };
  });

  describe("executeReadOnlyMode", () => {
    it("should execute BEGIN READ ONLY, user SQL, solution SQL, and ROLLBACK on success", async () => {
      const assignmentSchemaId = "assignment_schema_507f1f77bcf86cd799439011";
      const jobData = {
        assignmentId: "507f1f77bcf86cd799439011",
        userSql: "SELECT * FROM users;",
        solutionSql: "SELECT * FROM users ORDER BY id;",
        mode: UserSqlExecMode.READ,
        orderMatters: false,
      };

      const userQueryResult = {
        rowCount: 2,
        fields: [{ name: "id" }, { name: "name" }],
        rows: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      };

      const solutionQueryResult = {
        rowCount: 2,
        fields: [{ name: "id" }, { name: "name" }],
        rows: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN READ ONLY...
        .mockResolvedValueOnce(userQueryResult) // userSql
        .mockResolvedValueOnce(solutionQueryResult) // solutionSql
        .mockResolvedValueOnce({ rowCount: 0 }); // ROLLBACK

      const result = await UserSqlCodeExecutor.executeReadOnlyMode(
        mockClient,
        assignmentSchemaId,
        jobData,
      );

      expect(mockClient.escapeIdentifier).toHaveBeenCalledWith(assignmentSchemaId);
      expect(mockClient.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("BEGIN READ ONLY;"),
      );
      expect(mockClient.query).toHaveBeenNthCalledWith(2, jobData.userSql);
      expect(mockClient.query).toHaveBeenNthCalledWith(3, jobData.solutionSql);
      expect(mockClient.query).toHaveBeenLastCalledWith("ROLLBACK");

      expect(result.success).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.rowCount).toBe(2);
      expect(result.columns).toEqual(["id", "name"]);
      expect(result.rows).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
      expect(result.truncated).toBe(false);
      expect(typeof result.executionTimeMs).toBe("number");
    });

    it("should set passed to false when user results do not match solutionSql", async () => {
      const assignmentSchemaId = "assignment_schema_507f1f77bcf86cd799439011";
      const jobData = {
        assignmentId: "507f1f77bcf86cd799439011",
        userSql: "SELECT * FROM users;",
        solutionSql: "SELECT * FROM users;",
        mode: UserSqlExecMode.READ,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "id" }],
          rows: [{ id: 1 }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "id" }],
          rows: [{ id: 2 }],
        })
        .mockResolvedValueOnce({ rowCount: 0 });

      const result = await UserSqlCodeExecutor.executeReadOnlyMode(
        mockClient,
        assignmentSchemaId,
        jobData,
      );

      expect(result.success).toBe(true);
      expect(result.passed).toBe(false);
    });

    it("should handle error path and sanitise error message", async () => {
      const assignmentSchemaId = "assignment_schema_507f1f77bcf86cd799439011";
      const jobData = {
        assignmentId: "507f1f77bcf86cd799439011",
        userSql: "SELECT * FROM non_existent;",
        mode: UserSqlExecMode.READ,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN READ ONLY...
        .mockRejectedValueOnce(
          new Error("canceling statement due to statement timeout"),
        ) // userSql error
        .mockResolvedValueOnce({ rowCount: 0 }); // ROLLBACK

      const result = await UserSqlCodeExecutor.executeReadOnlyMode(
        mockClient,
        assignmentSchemaId,
        jobData,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Time Limit Exceeded!");
      expect(mockClient.query).toHaveBeenLastCalledWith("ROLLBACK");
    });
  });

  describe("executeReadWriteMode", () => {
    it("should create temp tables, execute write queries, validate, and rollback", async () => {
      const assignmentSchemaId = "assignment_schema_507f1f77bcf86cd799439011";
      const jobData = {
        assignmentId: "507f1f77bcf86cd799439011",
        userSql: "UPDATE users SET active = true;",
        solutionSql: "UPDATE users SET active = true;",
        validationSql: "SELECT count(*) FROM users WHERE active = true;",
        mode: UserSqlExecMode.WRITE,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ table_name: "users" }],
        }) // tables list
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE
        .mockResolvedValueOnce({ rowCount: 0 }) // SET search_path
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "count" }],
          rows: [{ count: 5 }],
        }) // userSql
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "count" }],
          rows: [{ count: 5 }],
        }) // userValidationResult
        .mockResolvedValueOnce({ rowCount: 0 }) // ROLLBACK
        .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TEMP TABLE
        .mockResolvedValueOnce({ rowCount: 0 }) // SET search_path
        .mockResolvedValueOnce({ rowCount: 0 }) // solutionSql
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "count" }],
          rows: [{ count: 5 }],
        }) // solutionValidationResult
        .mockResolvedValueOnce({ rowCount: 0 }); // ROLLBACK in finally

      const result = await UserSqlCodeExecutor.executeReadWriteMode(
        mockClient,
        assignmentSchemaId,
        jobData,
      );

      expect(result.success).toBe(true);
      expect(result.passed).toBe(true);
    });

    it("should catch errors in read-write mode and sanitise error message", async () => {
      const assignmentSchemaId = "assignment_schema_507f1f77bcf86cd799439011";
      const jobData = {
        assignmentId: "507f1f77bcf86cd799439011",
        userSql: "DELETE FROM users;",
        mode: UserSqlExecMode.WRITE,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error("permission denied for table users"));

      const result = await UserSqlCodeExecutor.executeReadWriteMode(
        mockClient,
        assignmentSchemaId,
        jobData,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Operation not allowed!");
      expect(mockClient.query).toHaveBeenLastCalledWith("ROLLBACK");
    });
  });

  describe("process", () => {
    it("should connect db pool client, execute job in read mode, and release client", async () => {
      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      };
      (DbPoolClient.get as any).mockReturnValue(mockPool);

      const job: any = {
        data: {
          assignmentId: "507f1f77bcf86cd799439011",
          userSql: "SELECT 1;",
          mode: UserSqlExecMode.READ,
        },
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({
          rowCount: 1,
          fields: [{ name: "?column?" }],
          rows: [{ "?column?": 1 }],
        })
        .mockResolvedValueOnce({ rowCount: 0 });

      const result = await UserSqlCodeExecutor.process(job);

      expect(DbPoolClient.get).toHaveBeenCalled();
      expect(mockPool.connect).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});