import { describe, it, expect, vi, beforeEach } from "vitest";
import CleanupExecutor from "../index";

const { mockQuery, mockFetch } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("../../../db", () => ({
  default: {
    getAdmin: vi.fn(() => ({ query: mockQuery })),
  },
}));

vi.mock("../../../config", () => ({
  envVars: {
    API_GATEWAY_URL: "http://gateway:8000",
    INTERNAL_API_KEY: "test-key",
    SANDBOX_SCHEMA_TTL_DAYS: 7,
  },
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe("CleanupExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("drops a stale schema and preserves an active one", async () => {
    // gateway says only the old schema is stale
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaNames: ["assignment_schema_507f1f77bcf86cd799439011"],
        count: 1,
      }),
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/internal/cleanup/old-schemas"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-internal-api-key": "test-key",
        }),
      }),
    );
    // stale schema dropped
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DROP SCHEMA"),
    );
    const dropCall = mockQuery.mock.calls.find((c) =>
      `${c[0]}`.includes("DROP SCHEMA"),
    );
    expect(`${dropCall?.[0]}`).toContain(
      "assignment_schema_507f1f77bcf86cd799439011",
    );
    // active schema never dropped
    expect(`${dropCall?.[0]}`).not.toContain("active");
    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 1 }),
    );
  });

  it("drops nothing when no stale schemas exist", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: [], count: 0 }),
    });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    const dropCalls = mockQuery.mock.calls.filter((c) =>
      `${c[0]}`.includes("DROP SCHEMA"),
    );
    expect(dropCalls).toHaveLength(0);
    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 0 }),
    );
  });

  it("rejects schema names outside the assignment_schema_ pattern", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        schemaNames: ["public; DROP TABLE users;--", "assignment_schema_ok123"],
        count: 2,
      }),
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    const allSql = mockQuery.mock.calls.map((c) => `${c[0]}`).join("\n");
    expect(allSql).not.toContain("DROP TABLE users");
    expect(allSql).toContain("assignment_schema_ok123");
    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 1 }),
    );
  });

  it("returns failure when the gateway list call fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    expect(result).toEqual(
      expect.objectContaining({ success: false }),
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("caps concurrent drops at 3 on 8 names", async () => {
    const names = Array.from(
      { length: 8 },
      (_, i) => `assignment_schema_conc${i}abc`,
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: names, count: 8 }),
    });
    let inFlight = 0;
    let maxInFlight = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (`${sql}`.includes("DROP SCHEMA")) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 8 }),
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
    // proves batching: sequential code stays at 1
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("partial failure still drops others", async () => {
    const names = [
      "assignment_schema_partA1",
      "assignment_schema_partB2",
      "assignment_schema_partC3",
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: names, count: 3 }),
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (`${sql}`.includes("DROP SCHEMA")) {
        if (`${sql}`.includes("assignment_schema_partB2")) {
          throw new Error("drop boom");
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 2 }),
    );
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        "assignment_schema_partA1",
        "assignment_schema_partC3",
      ]),
    );
    expect(result.dropped).not.toContain("assignment_schema_partB2");
  });

  it("mixed invalid name not interpolated and cap holds", async () => {
    const names = [
      "public; DROP TABLE users;--",
      "assignment_schema_mix1",
      "assignment_schema_mix2",
      "assignment_schema_mix3",
      "assignment_schema_mix4",
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ schemaNames: names, count: 5 }),
    });
    let inFlight = 0;
    let maxInFlight = 0;
    mockQuery.mockImplementation(async (sql: string) => {
      if (`${sql}`.includes("DROP SCHEMA")) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await CleanupExecutor.process({
      name: "client_sql_studio_cleanup",
    } as never);

    const allSql = mockQuery.mock.calls.map((c) => `${c[0]}`).join("\n");
    expect(allSql).not.toContain("DROP TABLE users");
    expect(result).toEqual(
      expect.objectContaining({ success: true, droppedCount: 4 }),
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
