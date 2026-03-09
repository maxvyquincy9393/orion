# EDITH Deployment Guide

## Prerequisites
- Docker + Docker Compose v2
- PostgreSQL 16+ (or use docker-compose)
- Redis 7+ (optional, for multi-instance sessions)
- pnpm 10+

---

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/knsiuss/orion.git && cd orion
pnpm install

# 2. Start infra (PostgreSQL + Redis)
docker-compose up -d postgres redis

# 3. Copy env and configure
cp .env.example .env
# Edit .env: set at least one LLM API key

# 4. Run migrations
pnpm prisma migrate deploy

# 5. Start EDITH
pnpm dev              # text mode (CLI)
pnpm all              # text + gateway
pnpm gateway          # gateway only (for channels)
```

### SQLite (Quick Dev Mode)
To use SQLite instead of PostgreSQL:
1. Change `provider = "postgresql"` to `provider = "sqlite"` in `prisma/schema.prisma`
2. Set `DATABASE_URL=file:./edith.db` in `.env`
3. Run `pnpm prisma db push`

---

## Production (Docker Compose)

```bash
# 1. Clone and configure
git clone https://github.com/knsiuss/orion.git && cd orion
cp .env.example .env
# Edit .env with production values

# 2. Start everything
docker-compose up -d

# 3. Verify
curl http://localhost:18789/health
```

The `docker-compose.yml` includes:
- **PostgreSQL 16** with health checks and persistent volume
- **Redis 7** for session storage
- **EDITH** with auto-migration on startup

---

## Production (Fly.io)

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login and create app
flyctl auth login
flyctl launch

# 3. Create managed PostgreSQL
flyctl postgres create --name edith-db
flyctl postgres attach edith-db

# 4. Create managed Redis
flyctl redis create --name edith-redis

# 5. Set secrets
flyctl secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  ADMIN_TOKEN=$(openssl rand -hex 32) \
  REDIS_URL=redis://...

# 6. Deploy
flyctl deploy

# 7. Verify
curl https://your-app.fly.dev/health
```

---

## Environment Variables

### Required
| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://edith:edith@localhost:5432/edith` |
| At least one LLM key | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY` | `sk-ant-...` |

### Optional — Infrastructure
| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | _(empty)_ | Redis URL for session persistence |
| `GATEWAY_PORT` | `18789` | HTTP/WS gateway port |
| `WEBCHAT_PORT` | `8080` | WebChat UI port |
| `ADMIN_TOKEN` | _(empty)_ | Token for /metrics and admin endpoints |
| `SENTRY_DSN` | _(empty)_ | Sentry error tracking DSN |
| `LLM_DAILY_BUDGET_USD` | `10` | Daily LLM cost alert threshold |

### Optional — Channels
See `.env.example` for the full list of channel configuration variables (Telegram, Discord, WhatsApp, Email, etc).

---

## Health Check

```
GET /health → { "status": "ok", "version": "0.1.0", "uptime": 12345 }
```

## Metrics (Prometheus)

```
GET /metrics?admin_token=YOUR_TOKEN → Prometheus text format (v0.0.4)
```

Tracked metrics:
- `edith_messages_total` — total messages processed
- `edith_pipeline_duration_ms` — message pipeline latency histogram
- `edith_llm_requests_total` — LLM API call count by provider
- `edith_errors_total` — error count by source
- `edith_active_sessions` — current in-memory session gauge
