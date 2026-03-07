# iMessage Channel (BlueBubbles)

File: `src/channels/imessage.ts`

## Config
- `BLUEBUBBLES_URL`
- `BLUEBUBBLES_PASSWORD`

## Platform Constraint
Requires macOS host with BlueBubbles server integration.

## Delivery Path
- POST to BlueBubbles REST send endpoint.
- Bearer auth with configured password/token.
- Chunked outbound text messages.

## Confirm Flow
- Shared YES/NO poll mechanism.

## Operational Notes
- Validate chat GUID mapping.
- Ensure secure network path to BlueBubbles server.
