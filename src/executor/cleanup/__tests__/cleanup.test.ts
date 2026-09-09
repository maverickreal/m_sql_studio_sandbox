import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import CleanupExecutor from "../index";
import DbPoolClient from "../../../db";

vi.mock("../../../db", () => {
  return {
    default: {
      getAdmin: vi.fn(),
    },
  };
});

describe("CleanupExecutor", () => {
  let mockAdminPool: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminPool = {
      query: vi.fn().mockResolvedValue({ rowCount: 0 }),
    };
    (DbPoolClient.getAdmin as any).mockReturnValue(mockAdminPool);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch old schema list and drop valid schemas successfully", async () => {
    const mockSchemaNames = [
      "assignment_schema_507f1f77bcf86cd799439011",
      "assignment_schema_507f1f77bcf86cd799439012",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: mockSchemaNames }),
    } as any);

    const result = await CleanupExecutor.process({ name: "cleanup" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/internal/cleanup/old-schemas?ttlDays="),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-internal-api-key": expect.any(String),
        }),
      }),
    );

    expect(mockAdminPool.query).toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "assignment_schema_507f1f77bcf86cd799439011" CASCADE',
    );
    expect(mockAdminPool.query).toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "assignment_schema_507f1f77bcf86cd799439012" CASCADE',
    );

    expect(result).toEqual({
      success: true,
      droppedCount: 2,
      dropped: mockSchemaNames,
    });
  });

  it("should filter out unexpected schema names that do not match SCHEMA_NAME_RE", async () => {
    const mockSchemaNames = [
      "assignment_schema_507f1f77bcf86cd799439011",
      "public",
      "pg_catalog",
      "invalid-schema-name",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: mockSchemaNames }),
    } as any);

    const result = await CleanupExecutor.process({ name: "cleanup" });

    expect(mockAdminPool.query).toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "assignment_schema_507f1f77bcf86cd799439011" CASCADE',
    );
    expect(mockAdminPool.query).not.toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "public" CASCADE',
    );
    expect(mockAdminPool.query).not.toHaveBeenCalledWith(
      'DROP SCHEMA IF EXISTS "pg_catalog" CASCADE',
    );

    expect(result.droppedCount).toBe(1);
    expect(result.dropped).toEqual(["assignment_schema_507f1f77bcf86cd799439011"]);
  });

  it("should handle gateway HTTP error gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as any);

    const result = await CleanupExecutor.process({ name: "cleanup" });

    expect(result).toEqual({
      success: false,
      droppedCount: 0,
      error: "list failed",
    });
  });

  it("should handle network exception on fetch gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));

    const result = await CleanupExecutor.process({ name: "cleanup" });

    expect(result).toEqual({
      success: false,
      droppedCount: 0,
      error: "list failed",
    });
  });

  it("should continue dropping remaining schemas if query fails for one schema", async () => {
    const mockSchemaNames = [
      "assignment_schema_fail1",
      "assignment_schema_success2",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: mockSchemaNames }),
    } as any);

    mockAdminPool.query
      .mockRejectedValueOnce(new Error("Drop schema failed")) // fail assignment_schema_fail1
      .mockResolvedValueOnce({ rowCount: 0 }) // success assignment_schema_success2
      .mockResolvedValueOnce({ rowCount: 1 }); // remaining count query

    const result = await CleanupExecutor.process({ name: "cleanup" });

    expect(result.success).toBe(true);
    expect(result.droppedCount).toBe(1);
    expect(result.dropped).toEqual(["assignment_schema_success2"]);
  });
});
