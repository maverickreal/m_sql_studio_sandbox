import DbPoolClient from "../../db";
import { envVars, logger } from "../../config";
import { PG_POOL_MAX } from "../../utils";

interface CleanupResult {
  success: boolean;
  droppedCount: number;
  dropped?: string[];
  error?: string;
}

// Only drop schemas that look like sandbox assignment schemas.
// The suffix after the prefix is a Mongo ObjectId hex string in practice;
// accept alphanumerics + underscore to stay tolerant of test fixtures.
const SCHEMA_NAME_RE = /^assignment_schema_[A-Za-z0-9_]+$/;

class CleanupExecutor {
  static async process(_job: { name: string }): Promise<CleanupResult> {
    const ttlDays = envVars.SANDBOX_SCHEMA_TTL_DAYS ?? 7;

    let schemaNames: string[];
    try {
      const resp = await fetch(
        `${envVars.API_GATEWAY_URL}/internal/cleanup/old-schemas?ttlDays=${ttlDays}`,
        {
          headers: {
            "x-internal-api-key": envVars.INTERNAL_API_KEY,
          },
        },
      );

      if (!resp.ok) {
        logger.error(
          { status: resp.status },
          "Gateway refused old-schemas list; skipping cleanup!",
        );
        return { success: false, droppedCount: 0, error: "list failed" };
      }

      const body = (await resp.json()) as {
        schemaNames?: string[];
        count?: number;
      };
      schemaNames = Array.isArray(body.schemaNames) ? body.schemaNames : [];
    } catch (err) {
      logger.error({ err }, "Failed to fetch old-schemas list for cleanup!");
      return { success: false, droppedCount: 0, error: "list failed" };
    }

    const dropped: string[] = [];
    const pool = DbPoolClient.getAdmin();

    // Batched drops: at most `concurrency` in flight so the shared admin
    // pool (PG_POOL_MAX) keeps slots for concurrent SQL/admin work.
    const rawConcurrency =
      (envVars as { SANDBOX_CLEANUP_CONCURRENCY?: number })
        .SANDBOX_CLEANUP_CONCURRENCY ?? 3;
    const concurrency = Math.min(
      Math.max(Math.floor(rawConcurrency) || 3, 1),
      PG_POOL_MAX - 1,
    );

    const validNames: string[] = [];
    for (const schemaName of schemaNames) {
      if (!SCHEMA_NAME_RE.test(schemaName)) {
        logger.error({ schemaName }, "Refusing to drop unexpected schema!");
        continue;
      }
      validNames.push(schemaName);
    }

    let next = 0;
    const dropOne = async (schemaName: string): Promise<void> => {
      try {
        // validated against SCHEMA_NAME_RE above — safe to interpolate.
        await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        dropped.push(schemaName);
        logger.info({ schemaName }, "Dropped stale assignment schema.");
      } catch (err) {
        logger.error({ err, schemaName }, "Failed to drop stale schema!");
      }
    };
    const worker = async (): Promise<void> => {
      while (true) {
        const i = next;
        next += 1;
        if (i >= validNames.length) return;
        const name = validNames[i] as string;
        await dropOne(name);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, validNames.length) },
        () => worker(),
      ),
    );

    try {
      const counts = await pool.query(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name LIKE 'assignment_schema_%'`,
      );
      logger.info(
        { remaining: counts.rowCount ?? 0, droppedCount: dropped.length },
        "Sandbox cleanup finished.",
      );
    } catch (err) {
      logger.error({ err }, "Failed to count remaining schemas!");
    }

    return { success: true, droppedCount: dropped.length, dropped };
  }
}

export default CleanupExecutor;
