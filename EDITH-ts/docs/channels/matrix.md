# Matrix Channel

File: `src/channels/matrix.ts`

## Config
- `MATRIX_HOMESERVER`
- `MATRIX_ACCESS_TOKEN`
- `MATRIX_ROOM_ID`

## Delivery Path
- Sends `m.room.message` via Matrix client API.
- Per-chunk transaction ID generated.
- Uses provided user room id or default room.

## Confirm Flow
- YES/NO polling contract shared with other channels.

## Operational Notes
- Token scope must permit message sends for target room.
- Handle room alias to roomId mapping upstream if required.
