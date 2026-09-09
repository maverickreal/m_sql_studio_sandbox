import { z } from "zod/v4";
import { ENV_MODE, UNWANTED_SERVICE_TERMINATION_CODE } from "../../utils";

const envVarsSchema = z.object({
  REDIS_URL: z.url().nonempty().nonoptional(),
  PG_HOST: z.string().nonempty().nonoptional(),
  PG_PORT: z.coerce.number().int().nonoptional(),
  PG_DATABASE: z.string().nonempty().nonoptional(),
  PG_USER: z.string().nonempty().nonoptional(),
  PG_PASSWORD: z.string().nonempty().nonoptional(),
  ADMIN_PG_USER: z.string().nonempty().nonoptional(),
  ADMIN_PG_PASSWORD: z.string().nonempty().nonoptional(),
  BULLMQ_SQL_QUEUE_NAME: z.string().nonempty().nonoptional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .nonoptional(),
  ENV_MODE: z.enum(ENV_MODE).nonoptional(),
  LOG_DIR: z.string().nonempty().nonoptional(),
  API_GATEWAY_URL: z.url().nonempty().nonoptional(),
  INTERNAL_API_KEY: z.string().nonempty().nonoptional(),
  SANDBOX_SCHEMA_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SANDBOX_CLEANUP_CONCURRENCY: z.coerce.number().int().default(3),
});

const parsedEnvVarsBody = envVarsSchema.safeParse(process.env);

if (!parsedEnvVarsBody.success) {
  console.error(
    "Invalid environment variables:",
    z.prettifyError(parsedEnvVarsBody.error),
  );
  process.exit(UNWANTED_SERVICE_TERMINATION_CODE);
}

export default parsedEnvVarsBody.data;
