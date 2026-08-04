# Multi-stage build: build the React client, build the TS server, then run a
# slim image where Express serves client/dist plus the /api routes as a single
# Railway service.

# ---- Stage 1: build client ----
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: build server ----
FROM node:20-slim AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/ ./
RUN npx prisma generate && npm run build

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

# OpenSSL is required by Prisma's query engine at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Production dependencies only.
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# Prisma schema + generated client + migrations (migrate deploy runs on boot).
COPY server/prisma ./prisma
RUN npx prisma generate

# Compiled server + built client.
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ../client/dist

EXPOSE 8080
# migrate deploy on boot, then start; the app also runs the idempotent seed.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
