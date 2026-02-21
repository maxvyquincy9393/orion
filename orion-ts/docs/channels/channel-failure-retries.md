# Channel Failure and Retry Policy

## Current Behavior
- Channel manager attempts channels in priority order.
- First successful channel send returns success.
- Failed send logs error/warn and next channel can be attempted.

## Recommended Retry Model
1. Immediate retry for transient 5xx or connection resets.
2. Exponential backoff for provider rate limits.
3. Dead-letter queue for persistent failures.
4. Per-channel circuit breaker on repeated failures.

## Suggested Telemetry
- send_success_total
- send_failure_total by channel/error class
- confirm_timeout_total
- average_send_latency_ms

## Fallback Order (default)
`webchat -> whatsapp -> signal -> line -> matrix -> teams -> imessage`

## Operator Actions
- If one channel degrades, keep it registered but mark unhealthy.
- Rotate tokens/credentials for auth failures.
- Run `pnpm doctor` after config changes.
