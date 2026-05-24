import { Pool } from "pg";
import { envVars } from "../config";
import { PG_POOL_MAX } from "../utils";
import { logger } from "../config";

class DbPoolClient {
  private static clientInst: Pool | null = null;
  private static adminClientInst: Pool | null = null;

  static connect(): void {
    if (!DbPoolClient.clientInst) {
      DbPoolClient.clientInst = new Pool({
        max: PG_POOL_MAX,
        host: envVars.PG_HOST,
        port: envVars.PG_PORT,
        user: envVars.PG_USER,
        password: envVars.PG_PASSWORD,
        database: envVars.PG_DATABASE,
      });

      DbPoolClient.clientInst.on("error", (err: Error) => {
        logger.error({ err }, "An error occurred in PostgreSQL pool!");
      });
    }

    if (!DbPoolClient.adminClientInst) {
      DbPoolClient.adminClientInst = new Pool({
        max: PG_POOL_MAX,
        host: envVars.PG_HOST,
        port: envVars.PG_PORT,
        user: envVars.ADMIN_PG_USER,
        password: envVars.ADMIN_PG_PASSWORD,
        database: envVars.PG_DATABASE,
      });

      DbPoolClient.adminClientInst.on("error", (err: Error) => {
        logger.error({ err }, "An error occurred in Admin PostgreSQL pool!");
      });
    }
  }

  static get(): Pool {
    if (!DbPoolClient.clientInst) {
      throw new Error("PostgreSQL client instance from null pool sought!");
    }

    return DbPoolClient.clientInst;
  }

  static getAdmin(): Pool {
    if (!DbPoolClient.adminClientInst) {
      throw new Error(
        "Admin PostgreSQL client instance from null pool sought!",
      );
    }

    return DbPoolClient.adminClientInst;
  }

  static async disconnect() {
    if (DbPoolClient.clientInst) {
      await DbPoolClient.clientInst.end();
      DbPoolClient.clientInst = null;
    }
    if (DbPoolClient.adminClientInst) {
      await DbPoolClient.adminClientInst.end();
      DbPoolClient.adminClientInst = null;
    }
  }
}

export default DbPoolClient;
