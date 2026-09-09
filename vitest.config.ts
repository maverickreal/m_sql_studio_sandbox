import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      REDIS_URL: "redis://localhost:6379",
      PG_HOST: "localhost",
      PG_PORT: "5432",
      PG_DATABASE: "test_db",
      PG_USER: "test_user",
      PG_PASSWORD: "test_password",
      ADMIN_PG_USER: "admin_user",
      ADMIN_PG_PASSWORD: "admin_password",
      BULLMQ_SQL_QUEUE_NAME: "test_queue",
      LOG_LEVEL: "info",
      ENV_MODE: "DEV",
      LOG_DIR: "/tmp/logs",
      API_GATEWAY_URL: "http://localhost:3000",
      INTERNAL_API_KEY: "test_secret_key",
    },
  },
});
