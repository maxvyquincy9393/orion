# EDITH API Reference

EDITH exposes a REST + WebSocket API via the Fastify gateway on port `18789`.

---

## Authentication

Some endpoints require the `ADMIN_TOKEN`:

```
GET /metrics?admin_token=YOUR_TOKEN
Authorization: Bearer YOUR_TOKEN      # alternative header
```

---

## Endpoints

### Health

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345
}
```

---

### Send Message

```
POST /api/message
Content-Type: application/json

{
  "userId": "user-1",
  "channel": "webchat",
  "text": "Hello, EDITH",
  "attachments": []
}
```

**Response:**
```json
{
  "reply": "Good morning, Sir. How may I assist you today?",
  "metadata": {
    "taskType": "fast",
    "provider": "anthropic",
    "durationMs": 1200
  }
}
```

---

### WebSocket Chat

```
WS /ws?userId=user-1&channel=webchat
```

**Client → Server:**
```json
{ "type": "message", "text": "Hello" }
```

**Server → Client:**
```json
{ "type": "reply", "text": "Hello, Sir.", "metadata": {} }
```

**Server → Client (streaming):**
```json
{ "type": "chunk", "text": "Hello" }
{ "type": "chunk", "text": ", Sir." }
{ "type": "done", "metadata": {} }
```

---

### Metrics (Prometheus)

```
GET /metrics?admin_token=YOUR_TOKEN
```

Returns Prometheus text format (`text/plain; version=0.0.4`).

**Key metrics:**
| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `edith_messages_total` | counter | `channel`, `userId` | Messages processed |
| `edith_pipeline_duration_ms` | histogram | `channel` | Pipeline latency |
| `edith_llm_requests_total` | counter | `provider`, `taskType` | LLM API calls |
| `edith_errors_total` | counter | `source` | Errors by source |
| `edith_active_sessions` | gauge | — | In-memory session count |

---

### Webhooks (Inbound)

EDITH registers webhook endpoints for external channels:

| Channel | Endpoint | Notes |
|---------|----------|-------|
| Telegram | `POST /webhook/telegram` | Set via `setWebhook` API |
| Discord | Uses Gateway (WSS) | No webhook needed |
| WhatsApp | `POST /webhook/whatsapp` | Meta Webhooks |
| Email (SMTP) | N/A | IMAP polling |

---

## Error Responses

All errors follow this shape:

```json
{
  "error": "Descriptive error message",
  "code": "VALIDATION_ERROR",
  "statusCode": 400
}
```

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid request body |
| 401 | `UNAUTHORIZED` | Missing or invalid admin token |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

---

## Rate Limits

Default rate limits (configurable via `src/gateway/rate-limit.ts`):

| Endpoint | Limit |
|----------|-------|
| `POST /api/message` | 30 req/min per userId |
| `GET /metrics` | 10 req/min |
| WebSocket messages | 60 msg/min per connection |
