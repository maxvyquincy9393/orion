# REST API Reference

EDITH exposes a Fastify HTTP server (default: `http://localhost:18789`) with the following endpoints.

---

## Health Check

### `GET /health`

Returns the current status of the EDITH gateway.

**Authentication:** None

**Response:**

```json
{
  "status": "ok",
  "uptime": 12345,
  "version": "2.0.0"
}
```

**Status codes:**
- `200` — gateway is running
- `503` — gateway is starting up or in error state

---

## Metrics

### `GET /metrics`

Returns Prometheus-format metrics for the EDITH process.

**Authentication:** Bearer token — requires `ADMIN_TOKEN` in `.env`

```
Authorization: Bearer <ADMIN_TOKEN>
```

**Response:** Plain text, `Content-Type: text/plain; version=0.0.4`

```
# HELP edith_messages_total Total messages processed
# TYPE edith_messages_total counter
edith_messages_total{channel="telegram",status="success"} 142

# HELP edith_llm_calls_total Total LLM API calls
# TYPE edith_llm_calls_total counter
edith_llm_calls_total{provider="groq",model="llama-3.3-70b"} 89

# HELP edith_message_latency_ms Message processing latency
# TYPE edith_message_latency_ms histogram
edith_message_latency_ms_bucket{le="100"} 45
...
```

**Available metrics:**

| Metric | Type | Description |
|--------|------|-------------|
| `edith_messages_total` | Counter | Messages processed, labeled by channel and status |
| `edith_llm_calls_total` | Counter | LLM API calls, labeled by provider and model |
| `edith_llm_errors_total` | Counter | LLM API errors |
| `edith_message_latency_ms` | Histogram | End-to-end message processing time |
| `edith_llm_latency_ms` | Histogram | LLM call latency |
| `edith_active_sessions` | Gauge | Currently active user sessions |
| `edith_memory_bytes` | Gauge | Process memory usage |

---

## Chat Completions (OpenAI-Compatible)

### `POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint. Accepts standard OpenAI request format so EDITH can be used as a drop-in replacement in tools that support custom OpenAI endpoints.

**Authentication:** Bearer token (same as `ADMIN_TOKEN` or a dedicated `CHAT_API_TOKEN`)

**Request:**

```json
{
  "model": "edith",
  "messages": [
    { "role": "user", "content": "What is the capital of France?" }
  ],
  "stream": false
}
```

**Response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "edith",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 10,
    "total_tokens": 25
  }
}
```

**Streaming:**

Set `"stream": true` to receive Server-Sent Events:

```
data: {"choices":[{"delta":{"content":"The"}}]}
data: {"choices":[{"delta":{"content":" capital"}}]}
...
data: [DONE]
```

---

## WebChat WebSocket

### `WS /webchat`

WebSocket endpoint for the webchat channel.

**Authentication:** Token passed as query parameter:

```
ws://localhost:18789/webchat?token=<WEBCHAT_SECRET>
```

**Inbound (client → server):**

```json
{
  "type": "message",
  "userId": "user-123",
  "content": "Hello EDITH"
}
```

**Outbound (server → client):**

```json
{
  "type": "message",
  "content": "Hello! How can I help you?",
  "timestamp": "2026-03-09T12:00:00Z"
}
```

---

## Webhook Endpoints

### `GET /webhooks/whatsapp`

WhatsApp Cloud API webhook verification endpoint. Returns the `hub.challenge` value when the verify token matches.

### `POST /webhooks/whatsapp`

Inbound WhatsApp Cloud API messages.

---

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid Authorization header"
  }
}
```

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| `400` | `BAD_REQUEST` | Invalid request body or parameters |
| `401` | `UNAUTHORIZED` | Missing or invalid auth token |
| `429` | `RATE_LIMITED` | Too many requests |
| `500` | `INTERNAL_ERROR` | Unexpected server error |
| `503` | `UNAVAILABLE` | Service temporarily unavailable |
