# syntax=docker/dockerfile:1.4
FROM oven/bun:1.4-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1.4-alpine
WORKDIR /app

COPY package.json bun.lock* ./
ARG ENV_MODE=PROD
RUN if [ "$ENV_MODE" = "DEV" ]; then bun install --frozen-lockfile; else bun install --frozen-lockfile --production; fi

COPY --from=build /app/dist ./dist
CMD ["bun", "run", "start"]
