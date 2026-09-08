export enum ENV_MODE {
  DEV = "DEV",
  STAGING = "STAGING",
  PROD = "PROD",
}

export const UNWANTED_SERVICE_TERMINATION_CODE = 1;
export const PG_POOL_MAX = 5;
export const USER_SQL_EXEC_MAX_TIME = 5000;
export const USER_SQL_EXEC_MAX_MEM = 16;
export const CONCURRENT_WORKERS_COUNT = 3;
export const MAX_RESULT_ROWS = 100;
export const BULLMQ_JOB_NAME = "client_sql_studio_sql_exec";
export const ADMIN_ASSIGNMENT_SEED_JOB_NAME =
  "client_sql_studio_admin_assignment_seed";
export const CLEANUP_JOB_NAME = "client_sql_studio_cleanup";
export const SANDBOX_DB_SCHEMA_PREFIX = "assignment_schema_";
