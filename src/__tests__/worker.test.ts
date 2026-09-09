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
});