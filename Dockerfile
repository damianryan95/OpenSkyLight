# syntax=docker/dockerfile:1
FROM node:22.13.1-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 is the only runtime native module used by the headless server.
RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
  && npm rebuild better-sqlite3 --build-from-source

COPY tsconfig.server.json ./
COPY kiosk.vite.config.ts companion.vite.config.ts ./
COPY src/server ./src/server
COPY src/renderer ./src/renderer
COPY src/companion ./src/companion
# Server domain services import shared DTO and utility modules. TypeScript
# follows those imports while emitting the headless server build.
COPY src/shared ./src/shared
RUN npm run build \
  && npm prune --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM node:22.13.1-bookworm-slim AS runtime

ARG OSL_VERSION=dev
LABEL org.opencontainers.image.title="OpenSkyLight" \
      org.opencontainers.image.version="${OSL_VERSION}"

WORKDIR /app
ENV NODE_ENV=production \
    OSL_RELEASE_VERSION=${OSL_VERSION} \
    OSL_SERVER_HOST=0.0.0.0 \
    OSL_SERVER_PORT=3000 \
    OSL_DATABASE_PATH=/data/openskylight.db

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/out/shared ./out/shared
COPY --from=build /app/out/kiosk ./out/kiosk
COPY --from=build /app/out/companion ./out/companion

VOLUME ["/data"]
EXPOSE 3000

# Readiness confirms that the Node process has started and can serve requests.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.OSL_SERVER_PORT + '/health/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "out/server/index.js"]
