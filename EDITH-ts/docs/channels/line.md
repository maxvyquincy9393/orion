# LINE Channel

File: `src/channels/line.ts`

## Config
- `LINE_CHANNEL_TOKEN`
- `LINE_CHANNEL_SECRET`

## Delivery Path
- Calls `https://api.line.me/v2/bot/message/push`.
- Authorization via bearer token.
- Text split into chunks before multiple push calls.

## Confirm Flow
- Same YES/NO poll pattern.

## Operational Notes
- Validate recipient ID mapping.
- Track LINE API response status for throttling/limits.
