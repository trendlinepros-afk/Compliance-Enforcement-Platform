# Multi-stage build: build the React client, build the TS server, then run a
# slim image where Express serves client/dist plus the /api routes as a single
# Railway service.
#
# Build context is the REPOSITORY ROOT (railway.json sets dockerfilePath to
# portal/Dockerfile, and Railway builds from the repo root). All COPY paths are
# therefore relative to the repo root and prefixed with portal/.

# ---- Stage 1: build client ----
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY portal/client/package.json portal/client/package-lock.json* ./
RUN npm ci
COPY portal/client/ ./
RUN npm run build

# ---- Stage 2: build server ----
FROM node:20-slim AS server-build
WORKDIR /app/server
COPY portal/server/package.json portal/server/package-lock.json* ./
RUN npm ci
COPY portal/server/ ./
RUN npx prisma generate && npm run build

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

# OpenSSL is required by Prisma's query engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Production dependencies only.
COPY portal/server/package.json portal/server/package-lock.json* ./
RUN npm ci --omit=dev

# Prisma schema + generated client + migrations (migrate deploy runs on boot).
COPY portal/server/prisma ./prisma
RUN npx prisma generate

# Compiled server + built client.
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ../client/dist

EXPOSE 8080
# migrate deploy on boot, then start; the app also runs the idempotent seed.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
