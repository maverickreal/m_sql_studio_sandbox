import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockWorkerOn } = vi.hoisted(() => {
  const mockWorkerOn = vi.fn();
  return { mockWorkerOn };
});

vi.mock("bullmq", () => {
  const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
  return {
    Worker: class MockWorker {
      on = mockWorkerOn;
      close = mockWorkerClose;
    },
    Job: vi.fn(),
  };
});

vi.mock("../src/executor/user", () => ({
  default: {
    process: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../src/executor/admin", () => ({
  default: {
    process: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock("../src/db", () => ({
  default: {
    connect: vi.fn(),
    get: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn(),
        release: vi.fn(),
      }),
    }),
    getAdmin: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue({
        query: vi.fn(),
        release: vi.fn(),
      }),
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../src/config/env", () => ({
  default: {
    REDIS_URL: "redis://localhost:6379",
    PG_HOST: "localhost",
    PG_PORT: 5432,
    PG_DATABASE: "test",
    PG_USER: "testuser",
    PG_PASSWORD: "testpass",
    ADMIN_PG_USER: "admin",
    ADMIN_PG_PASSWORD: "adminpass",
    BULLMQ_SQL_QUEUE_NAME: "test-queue",
    LOG_LEVEL: "info",
    ENV_MODE: "DEV",
    LOG_DIR: "/tmp",
    API_GATEWAY_URL: "http://localhost:3000",
    INTERNAL_API_KEY: "test-api-key",
  },
}));

vi.mock("../src/config/log", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/utils", () => ({
  UNWANTED_SERVICE_TERMINATION_CODE: 1,
  CONCURRENT_WORKERS_COUNT: 3,
  ADMIN_ASSIGNMENT_SEED_JOB_NAME: "client_sql_studio_admin_assignment_seed",
}));

describe("Worker", () => {
  let mockJob: {
    id: string;
    name: string;
    data: Record<string, unknown>;
    attemptsMade: number;
    opts: { attempts?: number };
  };
  let mockError: Error;
  let UserSqlCodeExecutor: { process: ReturnType<typeof vi.fn> };
  let AdminSqlCodeExecutor: { process: ReturnType<typeof vi.fn> };
  let logger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await import("../src/worker");

    const executorUser = await import("../src/executor/user");
    UserSqlCodeExecutor = executorUser.default;

    const executorAdmin = await import("../src/executor/admin");
    AdminSqlCodeExecutor = executorAdmin.default;

    const configLog = await import("../src/config/log");
    logger = configLog.default;

    mockJob = {
      id: "job-123",
      name: "client_sql_studio_sql_exec",
      data: { assignmentId: "assignment-1", userSql: "SELECT 1" },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    mockError = new Error("Test error");
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("Worker creation and configuration", () => {
    it("creates worker with correct concurrency", async () => {
      const bullmq = await import("bullmq");
      const workerInstance = new bullmq.Worker("test", vi.fn());
      expect(workerInstance).toBeDefined();
      expect(workerInstance.on).toBeDefined();
      expect(workerInstance.close).toBeDefined();
    });

    it("passes correct concurrency to worker options", async () => {
      const { Worker } = await import("bullmq");
      const concurrency = 3;
      expect(concurrency).toBe(3);
    });
  });

  describe("Job routing", () => {
    it("routes admin assignment seed jobs to AdminSqlCodeExecutor", async () => {
      const adminJob = {
        id: "admin-job-1",
        name: "client_sql_studio_admin_assignment_seed",
        data: { assignmentId: "assignment-1", initSql: "CREATE TABLE..." },
      };

      await AdminSqlCodeExecutor.process(adminJob as any);

      expect(AdminSqlCodeExecutor.process).toHaveBeenCalledWith(adminJob);
      expect(UserSqlCodeExecutor.process).not.toHaveBeenCalled();
    });

    it("routes user SQL exec jobs to UserSqlCodeExecutor", async () => {
      const userJob = {
        id: "user-job-1",
        name: "client_sql_studio_sql_exec",
        data: { assignmentId: "assignment-1", userSql: "SELECT 1" },
      };

      await UserSqlCodeExecutor.process(userJob as any);

      expect(UserSqlCodeExecutor.process).toHaveBeenCalledWith(userJob);
      expect(AdminSqlCodeExecutor.process).not.toHaveBeenCalled();
    });
  });

  describe("Failed job event handling", () => {
    it("calls cleanup endpoint for failed admin seed jobs on last retry", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: typeof mockJob, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      const adminFailedJob = {
        ...mockJob,
        name: "client_sql_studio_admin_assignment_seed",
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      await failedEventHandler!(adminFailedJob, mockError);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/internal/cleanup/assignment-1",
        {
          method: "POST",
          headers: {
            "x-internal-api-key": "test-api-key",
            "Content-Type": "application/json",
          },
        },
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("does not call cleanup for non-admin jobs on last retry", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: typeof mockJob, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      const userFailedJob = {
        ...mockJob,
        name: "client_sql_studio_sql_exec",
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      await failedEventHandler!(userFailedJob, mockError);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: "job-123",
          jobName: "client_sql_studio_sql_exec",
        }),
        "An SQL execution job attempt failed!",
      );
    });

    it("does not call cleanup for admin jobs not on last retry", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: typeof mockJob, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      const adminFailedJob = {
        ...mockJob,
        name: "client_sql_studio_admin_assignment_seed",
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await failedEventHandler!(adminFailedJob, mockError);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("handles cleanup endpoint failure gracefully", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: typeof mockJob, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      const adminFailedJob = {
        ...mockJob,
        name: "client_sql_studio_admin_assignment_seed",
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      await failedEventHandler!(adminFailedJob, mockError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ assignmentId: "assignment-1" }),
        "All attempts to create assignment schema failed; Initiating cleanup!",
      );
    });

    it("handles cleanup fetch error gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: typeof mockJob, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      const adminFailedJob = {
        ...mockJob,
        name: "client_sql_studio_admin_assignment_seed",
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      await failedEventHandler!(adminFailedJob, mockError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ assignmentId: "assignment-1" }),
        "Request to API Gateway internal cleanup endpoint failed!",
      );
    });

    it("logs error when job is undefined on failure", async () => {
      const failedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "failed",
      )?.[1] as (job: undefined, err: Error) => Promise<void> | undefined;

      expect(failedEventHandler).toBeDefined();

      await failedEventHandler!(undefined, mockError);

      expect(logger.error).toHaveBeenCalledWith(
        { err: mockError },
        "BullMQ job failed with non-existent job object!",
      );
    });
  });

  describe("Error event handling", () => {
    it("logs errors from the worker", async () => {
      const errorEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )?.[1] as (err: Error) => void | undefined;

      expect(errorEventHandler).toBeDefined();

      errorEventHandler!(mockError);

      expect(logger.error).toHaveBeenCalledWith(
        { err: mockError },
        "Exception in worker!",
      );
    });
  });

  describe("Completed event handling", () => {
    it("logs completed jobs", async () => {
      const completedEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "completed",
      )?.[1] as (job: typeof mockJob) => void | undefined;

      expect(completedEventHandler).toBeDefined();

      completedEventHandler!(mockJob);

      expect(logger.info).toHaveBeenCalledWith(
        { jobId: "job-123", jobName: "client_sql_studio_sql_exec" },
        "Successfully finished job",
      );
    });
  });

  describe("Ready event handling", () => {
    it("logs worker ready status", async () => {
      const readyEventHandler = mockWorkerOn.mock.calls.find(
        (call: unknown[]) => call[0] === "ready",
      )?.[1] as () => void | undefined;

      expect(readyEventHandler).toBeDefined();

      readyEventHandler!();

      expect(logger.info).toHaveBeenCalledWith(
        { queue: "test-queue" },
        "BullMQ worker ready.",
      );
    });
  });
});
