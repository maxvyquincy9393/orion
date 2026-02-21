# Teams Channel

File: `src/channels/teams.ts`

## Config
- `TEAMS_APP_ID`
- `TEAMS_APP_PASSWORD`
- `TEAMS_SERVICE_URL`

## Delivery Path
1. Exchange client credentials for bot access token.
2. POST message activities to conversation endpoint.
3. Chunk long messages before send loop.

## Confirm Flow
- Standard YES/NO poll pattern.

## Operational Notes
- Token acquisition failures should be monitored separately.
- Service URL varies by tenant/bot registration context.
