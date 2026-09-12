import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
let workerProcessor: any;

vi.mock("bullmq", () => {
  const MockWorker = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    _queueName: string,
    processor: any,
  ) {
    workerProcessor = processor;
    this.on = mockWorkerOn;
    this.close = mockWorkerClose;
  });
  return {
    Worker: MockWorker,
  };
});

const mockRedisPublish = vi.fn().mockResolvedValue(1);
const mockRedisOn = vi.fn();
const mockRedisConnect = vi.fn().mockResolvedValue(undefined);
const mockRedisQuit = vi.fn().mockResolvedValue(undefined);

vi.mock("redis", () => {
  return {
    createClient: vi.fn().mockReturnValue({
      on: mockRedisOn,
      connect: mockRedisConnect,
      publish: mockRedisPublish,
      quit: mockRedisQuit,
    }),
  };
});

vi.mock("../db", () => {
  return {
    default: {
      connect: vi.fn(),
      get: vi.fn(),
      getAdmin: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../executor", () => {
  return {
    UserSqlCodeExecutor: {
      process: vi.fn().mockResolvedValue({ success: true }),
    },
    AdminSqlCodeExecutor: {
      process: vi.fn().mockResolvedValue({ success: true }),
    },
    CleanupExecutor: {
      process: vi.fn().mockResolvedValue({ success: true, droppedCount: 1 }),
    },
  };
});

import {
  UserSqlCodeExecutor,
  AdminSqlCodeExecutor,
  CleanupExecutor,
} from "../executor";
import {
  ADMIN_ASSIGNMENT_SEED_JOB_NAME,
  BULLMQ_JOB_NAME,
  CLEANUP_JOB_NAME,
} from "../utils";

describe("Worker module", () => {
  const originalFetch = globalThis.fetch;
  let completedListener: Function;
  let failedListener: Function;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    await import("../worker");

    completedListener = mockWorkerOn.mock.calls.find(
      (call) => call[0] === "completed",
    )?.[1];

    failedListener = mockWorkerOn.mock.calls.find(
      (call) => call[0] === "failed",
    )?.[1];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should route jobs to the correct executor in worker processor", async () => {
    const adminJob: any = { name: ADMIN_ASSIGNMENT_SEED_JOB_NAME, data: {} };
    await workerProcessor(adminJob);
    expect(AdminSqlCodeExecutor.process).toHaveBeenCalledWith(adminJob);

    const cleanupJob: any = { name: CLEANUP_JOB_NAME, data: {} };
    await workerProcessor(cleanupJob);
    expect(CleanupExecutor.process).toHaveBeenCalledWith(cleanupJob);

    const userJob: any = { name: BULLMQ_JOB_NAME, data: {} };
    await workerProcessor(userJob);
    expect(UserSqlCodeExecutor.process).toHaveBeenCalledWith(userJob);
  });

  it("should trigger completed event handler and publish terminal state for client sql jobs", async () => {
    expect(completedListener).toBeDefined();

    const job: any = {
      id: "job-123",
      name: BULLMQ_JOB_NAME,
      returnvalue: { success: true },
    };

    await completedListener(job);

    expect(mockRedisPublish).toHaveBeenCalledWith(
      "job:job-123",
      JSON.stringify({ status: "completed", result: { success: true } }),
    );
  });

  it("should call internal gateway confirm API when admin seed job completes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as any);

    const job: any = {
      id: "admin-job-1",
      name: ADMIN_ASSIGNMENT_SEED_JOB_NAME,
      data: { assignmentId: "seed-abc-123" },
      returnvalue: { success: true },
    };

    await completedListener(job);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/internal/confirm/seed-abc-123"),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "x-internal-api-key": expect.any(String),
        }),
      }),
    );
  });

  it("should trigger failed event handler for last attempt admin seed job failure and call internal cleanup API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as any);

    expect(failedListener).toBeDefined();

    const job: any = {
      id: "admin-job-failed",
      name: ADMIN_ASSIGNMENT_SEED_JOB_NAME,
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: { assignmentId: "seed-failed-123" },
    };

    const err = new Error("DB Connection Error");

    await failedListener(job, err);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/internal/cleanup/seed-failed-123"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-internal-api-key": expect.any(String),
        }),
      }),
    );
  });

  describe("429 retry with backoff+jitter and give-up terminal log", () => {
    it("retries on 429 and succeeds when gateway recovers within max retries", async () => {
      const mockSleep = vi.fn().mockResolvedValue(undefined);
      const { confirmAssignmentSchemaReady } = await import("../worker");

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429 } as any)
        .mockResolvedValueOnce({ ok: false, status: 429 } as any)
        .mockResolvedValueOnce({ ok: true, status: 200 } as any);

      const result = await confirmAssignmentSchemaReady("seed-retry-success", {
        maxRetries: 5,
        baseDelayMs: 10,
        sleepFn: mockSleep,
      });

      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      expect(mockSleep).toHaveBeenCalledTimes(2);
      // Verify backoff + jitter delay is positive
      expect(mockSleep.mock.calls[0][0]).toBeGreaterThanOrEqual(10);
      expect(mockSleep.mock.calls[1][0]).toBeGreaterThanOrEqual(20);
    });

    it("gives up after max 5 retries on 429 and logs loudly to terminal", async () => {
      const mockSleep = vi.fn().mockResolvedValue(undefined);
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { confirmAssignmentSchemaReady, CONFIRM_MAX_RETRIES } = await import(
        "../worker"
      );

      expect(CONFIRM_MAX_RETRIES).toBe(5);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      } as any);

      const result = await confirmAssignmentSchemaReady("seed-retry-fail", {
        maxRetries: 5,
        baseDelayMs: 10,
        sleepFn: mockSleep,
      });

      expect(result).toBe(false);
      // 1 initial attempt + 5 retries = 6 total fetch calls
      expect(globalThis.fetch).toHaveBeenCalledTimes(6);
      expect(mockSleep).toHaveBeenCalledTimes(5);

      // Verify loud terminal log on give-up
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("GIVE-UP"),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("seed-retry-fail"),
      );

      consoleErrorSpy.mockRestore();
    });

    it("does not retry on non-429 client/server errors", async () => {
      const mockSleep = vi.fn().mockResolvedValue(undefined);
      const { confirmAssignmentSchemaReady } = await import("../worker");

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as any);

      const result = await confirmAssignmentSchemaReady("seed-500", {
        maxRetries: 5,
        baseDelayMs: 10,
        sleepFn: mockSleep,
      });

      expect(result).toBe(false);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(mockSleep).not.toHaveBeenCalled();
    });

    it("handles network error gracefully without unhandled rejection", async () => {
      const { confirmAssignmentSchemaReady } = await import("../worker");

      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error("Network connection dropped"));

      const result = await confirmAssignmentSchemaReady("seed-net-err");
      expect(result).toBe(false);
    });
  });
});