# MSqlStudio Sandbox Executor

BullMQ worker service that executes user-submitted SQL queries in isolated PostgreSQL sandboxes. Part of the online SQL learning platform.

### **_I M P O R T A N T_** note for developers:

To test/run the entire backend locally, all you need do is:

1. Clone all the project repos:
   - https://github.com/maverickreal/m_sql
   - https://github.com/maverickreal/m_sql_studio_sandbox
   - https://github.com/maverickreal/m_sql_studio_api_gateway
2. Run the following shell code, from within the orchestrator repo (m_sql_studio):
   ```sh
   chmod u+x ./init.dev.bash;
   ./init.dev.bash;
   ```

## Tech Stack

| Technology        | Purpose              |
| ----------------- | -------------------- |
| Node.js 22        | Runtime              |
| TypeScript        | Language             |
| BullMQ 5          | Job queue consumer   |
| PostgreSQL (pg 8) | SQL execution engine |
| Zod 4             | Data validation      |
| Pino              | Structured logging   |
| Vitest            | Testing              |

## Prerequisites

- Node.js 22+
- Running PostgreSQL and Redis instances (or use the parent [m_sql_studio](../m_sql_studio) Docker Compose setup)

## Getting Started

### 1. Install Dependencies

```bash
npm ci
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Fill in all values. See [Environment Variables](#environment-variables).

### 3. Run in Development

```bash
npm run dev
```

Starts the worker with `nodemon` for automatic restarts on file changes.

### 4. Build and Run for Production

```bash
npm run build
npm run start
```

### Docker

```bash
docker build -t m-sql-studio-sandbox .
docker run --env-file .env m-sql-studio-sandbox
```

The production image uses a multi-stage build. When run via Docker Compose, the container is constrained to 512MB memory and 1 CPU core.

## Environment Variables

| Variable                | Description                                           | Example                            |
| ----------------------- | ----------------------------------------------------- | ---------------------------------- |
| `REDIS_URL`             | Redis connection URL (BullMQ)                         | `redis://:password@localhost:6379` |
| `PG_HOST`               | PostgreSQL host                                       | `localhost`                        |
| `PG_PORT`               | PostgreSQL port                                       | `5432`                             |
| `PG_DATABASE`           | PostgreSQL database name                              | `m_sql_studio`                |
| `PG_USER`               | Restricted PostgreSQL user (for user query execution) | `sandbox_user`                     |
| `PG_PASSWORD`           | Password for the restricted user                      | --                                 |
| `ADMIN_PG_USER`         | PostgreSQL admin user (for schema creation)           | `postgres`                         |
| `ADMIN_PG_PASSWORD`     | Password for the admin user                           | --                                 |
| `ENV_MODE`              | Environment mode                                      | `DEV`, `STAGING`, `PROD`           |
| `LOG_LEVEL`             | Pino log level                                        | `info`                             |
| `LOG_DIR`               | Directory for log file output                         | `/var/log/m_sql_studio`       |
| `BULLMQ_SQL_QUEUE_NAME` | BullMQ queue name (must match API Gateway)            | `sql_exec_queue`                   |
| `INTERNAL_API_KEY`      | Shared key for service-to-service auth                | --                                 |
| `API_GATEWAY_URL`       | API Gateway base URL for callbacks                    | `http://api-gateway:8000`          |

## Scripts

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm run dev`        | Start worker with nodemon              |
| `npm run build`      | Compile TypeScript to `dist/`          |
| `npm run start`      | Run compiled output (`dist/worker.js`) |
| `npm run test`       | Run tests with Vitest                  |
| `npm run test:watch` | Run tests in watch mode                |

## Project Structure

```
src/
├── worker.ts              # BullMQ worker setup, job routing, event handlers
├── config/
│   ├── env/               # Environment variable parsing (Zod)
│   └── log/               # Pino logger configuration
├── db/                    # PostgreSQL connection pools (user + admin)
├── executor/
│   ├── user/              # UserSqlCodeExecutor (read and write modes)
│   └── admin/             # AdminSqlCodeExecutor (schema seeding)
├── types/                 # Job data and result interfaces
└── utils/
    ├── constants/         # App-wide constants
    └── helpers/           # Utility functions (result comparison, error sanitization)
```

## How It Works

### Job Routing

The worker listens on a single BullMQ queue and routes jobs by name:

- **`client_sql_studio_admin_assignment_seed`** -- routed to `AdminSqlCodeExecutor`
- **All other jobs** -- routed to `UserSqlCodeExecutor`

### Execution Modes

#### Read Mode

1. Opens a `READ ONLY` transaction
2. Sets `statement_timeout` (5s) and `work_mem` (16MB)
3. Sets `search_path` to the assignment's isolated schema
4. Executes the user's SQL
5. Optionally runs the solution SQL and compares results
6. Returns results (capped at 100 rows)
7. Always rolls back -- no data modification possible

#### Write Mode

1. Opens a transaction
2. Sets resource limits (`statement_timeout`, `work_mem`)
3. Copies all tables from the assignment schema into temporary tables
4. Executes the user's SQL against the temporary tables
5. Optionally validates by running a validation query against both user and solution results
6. Returns results (capped at 100 rows)
7. Always rolls back -- original schema data is never modified

#### Admin Schema Seeding

1. Connects using the admin PostgreSQL user
2. Creates a new schema (`assignment_schema_<id>`)
3. Runs the assignment's `initSql` to create tables and seed data
4. Grants `SELECT` privileges to the restricted sandbox user
5. On success, calls `PATCH /internal/confirm/:id` on the API Gateway
6. On final failure (after retries), calls `POST /internal/cleanup/:id` to remove the orphaned assignment

### Security and Resource Limits

| Constraint                        | Value    |
| --------------------------------- | -------- |
| Statement timeout                 | 5,000 ms |
| Work memory                       | 16 MB    |
| Max result rows                   | 100      |
| Connection pool size              | 5        |
| Worker concurrency                | 3        |
| Container memory (Docker Compose) | 512 MB   |
| Container CPU (Docker Compose)    | 1.0 core |

- **Schema isolation**: Each assignment gets its own PostgreSQL schema. The restricted sandbox user has `SELECT`-only access.
- **Write-mode safety**: User write queries run against temporary tables that are dropped on transaction rollback. Original schema data is never touched.
- **Error sanitization**: PostgreSQL error messages are sanitized before being returned to users to prevent leaking internal details.
- **Graceful shutdown**: The worker intercepts `SIGTERM`/`SIGINT` signals, closes the BullMQ worker, and disconnects database pools before exiting.
