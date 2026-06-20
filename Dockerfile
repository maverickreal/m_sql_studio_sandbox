FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
ARG ENV_MODE=PROD
RUN if [ "$ENV_MODE" = "DEV" ]; then npm ci; else npm ci --omit=dev; fi

COPY --from=build /app/dist ./dist
CMD ["npm", "run", "start"]
