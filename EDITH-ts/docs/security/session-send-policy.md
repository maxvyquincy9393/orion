# Session Send Policy

Files:
- `src/sessions/send-policy.ts`
- `src/sessions/session-store.ts`

## Goals
- Rate-limit abusive traffic.
- Bound content size.
- Keep per-channel session context isolated.

## Expected Rules
- Per user+channel message cap in rolling window.
- Max content length cap for single payload.
- Temporary block period after repeated violations.

## Recommended Metadata
Each policy decision should include:
- userId
- channel
- accepted/denied
- reason
- remaining quota (if available)

## Integration Points
- Check before passing message to gateway handling.
- Persist decision logs for abuse analytics.

## Operational Tuning
- Higher burst for trusted owner in CLI mode.
- Lower burst for public webhook channels.
- Separate inbound and outbound quotas if needed.
