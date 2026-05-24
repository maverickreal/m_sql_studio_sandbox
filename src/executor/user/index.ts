import {
  UserSqlExecJobData,
  UserSqlExecJobResult,
  UserSqlExecMode,
} from "../../types";
import DbPoolClient from "../../db";
import { Job } from "bullmq";
import { PoolClient } from "pg";
import { logger } from "../../config";
import {
  USER_SQL_EXEC_MAX_MEM,
  USER_SQL_EXEC_MAX_TIME,
  MAX_RESULT_ROWS,
} from "../../utils";
import {
  compareQueryResults,
  getSandboxDBSchemaIdForAssignment,
  SQLSanitiser,
} from "../../utils";

class UserSqlCodeExecutor {
  static async executeReadOnlyMode(
    client: PoolClient,
    assignmentSchemaId: string,
    jobData: UserSqlExecJobData,
  ): Promise<UserSqlExecJobResult> {
    try {
      const escapedSchemaName = client.escapeIdentifier(assignmentSchemaId);

      await client.query(
        `BEGIN READ ONLY;
        SET LOCAL statement_timeout = '${USER_SQL_EXEC_MAX_TIME}';
        SET LOCAL work_mem = '${USER_SQL_EXEC_MAX_MEM}MB';
        SET LOCAL search_path TO ${escapedSchemaName}`,
      );
      const start = performance.now();

      const result = await client.query(jobData.userSql);

      const executionTimeMs = Math.round(performance.now() - start);

      const rowCount = result.rowCount ?? 0;

      let passed: boolean | undefined = undefined;

      if (jobData.solutionSql) {
        const solutionResult = await client.query(jobData.solutionSql);
        passed = compareQueryResults(
          result.rows,
          solutionResult.rows,
          jobData.orderMatters ?? false,
        );
      }

      return {
        executionTimeMs,
        rowCount,
        columns: result.fields.map((field) => field.name),
        rows: result.rows.slice(0, MAX_RESULT_ROWS),
        truncated: rowCount > MAX_RESULT_ROWS,
        success: true,
        passed,
      };
    } catch (err) {
      return {
        success: false,
        error: SQLSanitiser(err instanceof Error ? err.message : `${err}`),
      };
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr },
          "Failed to rollback read-only transaction!",
        );
      }
    }
  }

  static async executeReadWriteMode(
    client: PoolClient,
    assignmentSchemaId: string,
    jobData: UserSqlExecJobData,
  ): Promise<UserSqlExecJobResult> {
    try {
      await client.query(
        `BEGIN;
        SET LOCAL statement_timeout = '${USER_SQL_EXEC_MAX_TIME}';
        SET LOCAL work_mem = '${USER_SQL_EXEC_MAX_MEM}MB'`,
      );

      const escapedSchemaName = client.escapeIdentifier(assignmentSchemaId);

      const tableRows = await client.query(
        `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [assignmentSchemaId],
      );

      const tableNames: Array<string> = tableRows.rows.map(
        (row) => row.table_name,
      );

      const mergedTempTableQueries = tableNames
        .map((tableName) => {
          tableName = client.escapeIdentifier(tableName);

          return `CREATE TEMPORARY TABLE ${tableName}
            (LIKE ${escapedSchemaName}.${tableName} INCLUDING ALL)
            ON COMMIT DROP;

            INSERT INTO ${tableName}
            SELECT * FROM ${escapedSchemaName}.${tableName}`;
        })
        .join(";\n");

      if (mergedTempTableQueries.length > 0) {
        await client.query(mergedTempTableQueries);
      }
      await client.query(
        `SET LOCAL search_path TO pg_temp, ${escapedSchemaName}`,
      );
      const start = performance.now();

      const result = await client.query(jobData.userSql);

      const executionTimeMs = Math.round(performance.now() - start);

      const rowCount = result.rowCount ?? 0;

      let passed: boolean | undefined = undefined;

      if (jobData.validationSql && jobData.solutionSql) {
        const userValidationResult = await client.query(jobData.validationSql);

        await client.query("ROLLBACK");

        await client.query(
          `BEGIN;
          SET LOCAL statement_timeout = '${USER_SQL_EXEC_MAX_TIME}';
          SET LOCAL work_mem = '${USER_SQL_EXEC_MAX_MEM}MB'`,
        );

        if (mergedTempTableQueries.length > 0) {
          await client.query(mergedTempTableQueries);
        }
        await client.query(
          `SET LOCAL search_path TO pg_temp, ${escapedSchemaName}`,
        );

        await client.query(jobData.solutionSql);
        const solutionValidationResult = await client.query(
          jobData.validationSql,
        );

        passed = compareQueryResults(
          userValidationResult.rows,
          solutionValidationResult.rows,
          jobData.orderMatters ?? false,
        );
      }

      return {
        success: true,
        rows: result.rows.slice(0, MAX_RESULT_ROWS),
        columns: result.fields.map((col) => col.name),
        rowCount,
        truncated: rowCount > MAX_RESULT_ROWS,
        executionTimeMs,
        passed,
      };
    } catch (err) {
      return {
        success: false,
        error: SQLSanitiser(err instanceof Error ? err.message : `${err}`),
      };
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr },
          "Failed to rollback read-write transaction!",
        );
      }
    }
  }

  static async process(job: Job<UserSqlExecJobData, UserSqlExecJobResult>) {
    const dbPoolClientInst = await DbPoolClient.get().connect();

    try {
      const { assignmentId, mode } = job.data;
      const assignmentSchema = getSandboxDBSchemaIdForAssignment(assignmentId);

      const readOrWriteOp =
        UserSqlCodeExecutor[
          mode === UserSqlExecMode.READ
            ? "executeReadOnlyMode"
            : "executeReadWriteMode"
        ];

      return await readOrWriteOp(dbPoolClientInst, assignmentSchema, job.data);
    } finally {
      dbPoolClientInst.release();
    }
  }
}

export default UserSqlCodeExecutor;
