# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm via corepack (built into Node 22)
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

# Install dependencies (cached layer)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json tsup.config.* ./
COPY src ./src
COPY bin ./bin
RUN pnpm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:22-alpine AS production

# Security: non-root user
RUN addgroup -g 1001 -S edith && \
    adduser -S edith -u 1001 -G edith

WORKDIR /app

# Install pnpm and production deps only
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma schema + generated client from builder
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin

# Create data directory with correct permissions
RUN mkdir -p /data && chown edith:edith /data

EXPOSE 18789 8080

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/edith.db

VOLUME ["/data"]

# Run as non-root
USER edith

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:18789/health || exit 1

CMD ["sh", "-c", "set -e; npx prisma migrate deploy; node dist/main.js --mode gateway"]
