import {
  AdminAssignmentSeedJobData,
  AdminAssignmentSeedJobResult,
} from "../../types";
import DbPoolClient from "../../db";
import { Job } from "bullmq";
import { getSandboxDBSchemaIdForAssignment } from "../../utils";
import { envVars, logger } from "../../config";

class AdminSqlCodeExecutor {
  static async process(
    job: Job<AdminAssignmentSeedJobData, AdminAssignmentSeedJobResult>,
  ) {
    const dbPoolClientInst = await DbPoolClient.getAdmin().connect();

    try {
      const { assignmentId, initSql } = job.data;
      const escapedSchemaName = dbPoolClientInst.escapeIdentifier(
        getSandboxDBSchemaIdForAssignment(assignmentId),
      );

      await dbPoolClientInst.query(
        `BEGIN;
        CREATE SCHEMA IF NOT EXISTS ${escapedSchemaName};
        SET LOCAL search_path TO ${escapedSchemaName};`,
      );

      if (initSql.trim()) {
        await dbPoolClientInst.query(initSql);
      }

      const escapedRoleName = dbPoolClientInst.escapeIdentifier(
        envVars.PG_USER,
      );

      await dbPoolClientInst.query(
        `GRANT USAGE ON SCHEMA ${escapedSchemaName} TO ${escapedRoleName};
        GRANT SELECT ON ALL TABLES IN SCHEMA ${escapedSchemaName} TO ${escapedRoleName};
        ALTER DEFAULT PRIVILEGES IN SCHEMA ${escapedSchemaName} GRANT SELECT ON TABLES TO ${escapedRoleName};
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA ${escapedSchemaName} FROM ${escapedRoleName};
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${escapedSchemaName} FROM ${escapedRoleName};
        COMMIT;`,
      );

      return {
        success: true,
      };
    } catch (err) {
      try {
        await dbPoolClientInst.query("ROLLBACK;");
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr },
          "Failed to rollback admin seeding transaction!",
        );
      }

      throw err;
    } finally {
      dbPoolClientInst.release();
    }
  }
}

export default AdminSqlCodeExecutor;
