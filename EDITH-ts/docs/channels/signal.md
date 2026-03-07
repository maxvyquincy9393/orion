# Signal Channel

File: `src/channels/signal.ts`

## Config
- `SIGNAL_PHONE_NUMBER`
- `SIGNAL_CLI_PATH`

## Delivery Path
- Uses `signal-cli` subprocess.
- Sends chunked text messages.
- Channel enabled only when both config fields are set.

## Confirm Flow
- Sends prompt with YES/NO instruction.
- Polls in-memory reply queue with timeout.

## Notes
- Requires external signal-cli setup and linked account.
- Current implementation provides outbound path; inbound ingestion can be extended.
