# Session Summarizer

File: `src/memory/session-summarizer.ts`

## Purpose
Compress long active sessions without waiting for session end.

## Trigger
- When session reaches 30 messages:
  - compress 20 oldest
  - keep recent tail in active context

## Output
- Summary persisted as `role: system`
- Metadata includes `compressed: true` and `source: session-summarizer`

## Non-Destructive Rule
- Original messages remain in DB history.
- Only active in-memory context gets compacted.

## Integration
- Called from `session-store` after message append.
- Fallback summary generated even if model summarization fails.

## Performance Notes
- Keep summary prompt bounded.
- Avoid recursive compression loops by threshold checks.
