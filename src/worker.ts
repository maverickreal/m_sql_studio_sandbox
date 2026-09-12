import DbPoolClient from "./db";
import {
  UserSqlCodeExecutor,
  AdminSqlCodeExecutor,
  CleanupExecutor,
} from "./executor/";
import {
  UserSqlExecJobData,
  UserSqlExecJobResult,
  AdminAssignmentSeedJobData,
  AdminAssignmentSeedJobResult,
} from "./types";
import { Job, Worker } from "bullmq";
import { createClient, RedisClientType } from "redis";
import {
  UNWANTED_SERVICE_TERMINATION_CODE,
  CONCURRENT_WORKERS_COUNT,
  ADMIN_ASSIGNMENT_SEED_JOB_NAME,
  BULLMQ_JOB_NAME,
  CLEANUP_JOB_NAME,
  encodeRedisPassword,
} from "./utils";
import { envVars } from "./config";
import { logger } from "./config";

type SqlExecJob = Job<
  UserSqlExecJobData | AdminAssignmentSeedJobData,
  UserSqlExecJobResult | AdminAssignmentSeedJobResult,
  string
>;
DbPoolClient.connect();

const encodedRedisUrl = encodeRedisPassword(envVars.REDIS_URL);

const workerOpts = {
  connection: {
    url: encodedRedisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  },
  concurrency: CONCURRENT_WORKERS_COUNT,
};

const BullMQWorker = new Worker<
  UserSqlExecJobData | AdminAssignmentSeedJobData,
  UserSqlExecJobResult | AdminAssignmentSeedJobResult
>(
  envVars.BULLMQ_SQL_QUEUE_NAME!,
  (job: Job) =>
    (job.name === ADMIN_ASSIGNMENT_SEED_JOB_NAME
      ? AdminSqlCodeExecutor
      : job.name === CLEANUP_JOB_NAME
        ? CleanupExecutor
        : UserSqlCodeExecutor
    ).process(job),
  workerOpts,
);

let redisPubClient: RedisClientType | null = null;

const getRedisPubClient = async (): Promise<RedisClientType> => {
  if (!redisPubClient) {
    redisPubClient = createClient({ url: encodedRedisUrl });
    redisPubClient.on("error", (err: Error) => {
      logger.error({ err }, "Error in worker Redis pub connection!");
    });
    await redisPubClient.connect();
  }

  return redisPubClient;
};

const publishJobTerminalState = async (
  job: SqlExecJob,
  status: "completed" | "failed",
  result: unknown,
): Promise<void> => {
  if (job.name !== BULLMQ_JOB_NAME) {
    return;
  }

  try {
    const client = await getRedisPubClient();
    await client.publish(
      `job:${job.id}`,
      JSON.stringify({ status, result }),
    );
  } catch (err) {
    logger.error(
      { err, jobId: job.id },
      "Failed to publish job terminal state!",
    );
  }
};

BullMQWorker.on("completed", async (job: SqlExecJob) => {
  logger.info(
    { jobId: job.id, jobName: job.name },
    "Successfully finished job",
  );

  await publishJobTerminalState(job, "completed", job.returnvalue);

  if (job.name !== ADMIN_ASSIGNMENT_SEED_JOB_NAME) {
    return;
  }
  const assignmentId = job.data.assignmentId;
  const encodedAssignmentId = encodeURIComponent(assignmentId);

  try {
    const schemaSetFlagResp = await fetch(
      `${envVars.API_GATEWAY_URL}/internal/confirm/${encodedAssignmentId}`,
      {
        method: "PATCH",
        headers: {
          "x-internal-api-key": envVars.INTERNAL_API_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    logger.info(
      {
        assignmentId,
        status: schemaSetFlagResp.ok ? undefined : schemaSetFlagResp.status,
      },
      `${schemaSetFlagResp.ok ? "Success" : "Failure"} at confirming assignment schema ready!`,
    );
  } catch (err) {
    logger.error(
      { assignmentId, err },
      "Failure while requesting the API Gateway 'internal confirm' API endpoint!",
    );
  }
});

BullMQWorker.on("failed", async (job: SqlExecJob | undefined, err: Error) => {
  if (!job) {
    logger.error({ err }, "BullMQ job failed with non-existent job object!");

    return;
  }

  const { attemptsMade } = job;
  const isLastAdminSeedJobFailure =
    attemptsMade >= (job.opts.attempts ?? 1) &&
    job.name === ADMIN_ASSIGNMENT_SEED_JOB_NAME;

  if (!isLastAdminSeedJobFailure) {
    logger.error(
      {
        jobId: job.id,
        jobName: job.name,
        err: err.message,
        attemptsMade,
      },
      "An SQL execution job attempt failed!",
    );

    await publishJobTerminalState(job, "failed", {
      success: false,
      error: err.message,
    });

    return;
  }
  const assignmentId = job.data.assignmentId;
  const encodedAssignmentId = encodeURIComponent(assignmentId);

  logger.error(
    {
      jobId: job.id,
      jobName: job.name,
      assignmentId,
      attemptsMade,
      err: err.message,
      stack: err.stack,
    },
    "All attempts to create assignment schema failed; Initiating cleanup!",
  );

  try {
    const response = await fetch(
      `${envVars.API_GATEWAY_URL}/internal/cleanup/${encodedAssignmentId}`,
      {
        method: "POST",
        headers: {
          "x-internal-api-key": envVars.INTERNAL_API_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    logger.info(
      { assignmentId, status: response.ok ? undefined : response.status },
      `${response.ok ? "Success" : "Failure"} at cleaning up orphaned assignment!`,
    );
  } catch (err) {
    logger.error(
      { assignmentId, err },
      "Request to API Gateway internal cleanup endpoint failed!",
    );
  }
});

BullMQWorker.on("error", (err: Error) => {
  logger.error({ err }, "Exception in worker!");
});

BullMQWorker.on("ready", () => {
  logger.info({ queue: envVars.BULLMQ_SQL_QUEUE_NAME }, "BullMQ worker ready.");
});

const cleanup = async () => {
  await BullMQWorker.close();
  if (redisPubClient) {
    await redisPubClient.quit();
    redisPubClient = null;
  }
  await DbPoolClient.disconnect();
};

if (process.env.NODE_ENV !== "test") {
  ["SIGTERM", "SIGINT"].forEach((signal: string) =>
    process.on(signal, async () => {
      logger.info(
        { signal, queue: envVars.BULLMQ_SQL_QUEUE_NAME },
        "Worker terminated due to kill signal",
      );

      await cleanup();
      process.exit(0);
    }),
  );

  process.on("unhandledRejection", async (reason) => {
    logger.error(
      { reason },
      "Unhandled promise rejection in worker — shutting down!",
    );
    await cleanup();
    process.exit(UNWANTED_SERVICE_TERMINATION_CODE);
  });

  process.on("uncaughtException", async (err: Error) => {
    logger.error({ err }, "Uncaught exception in worker — shutting down!");
    await cleanup();
    process.exit(UNWANTED_SERVICE_TERMINATION_CODE);
  });
}
