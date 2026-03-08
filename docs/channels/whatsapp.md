# WhatsApp Channel Setup

EDITH supports two WhatsApp integration modes:

| Mode | Description | Best for |
|------|-------------|----------|
| `baileys` (QR scan) | Scan a QR code with the WhatsApp app — no extra credentials needed | Quick local testing |
| `cloud` (Meta Cloud API) | Official Meta API with webhooks | Production deployments |

---

## Mode A — QR Scan (Baileys)

The fastest way to get EDITH on WhatsApp — same flow as many WhatsApp bots.

### Requirements

- `baileys` npm package (install with `pnpm add @whiskeysockets/baileys`)
- WhatsApp account on your phone

### Configuration

```env
WHATSAPP_ENABLED=true
WHATSAPP_MODE=baileys
```

### Start

```bash
pnpm wa:scan
# or
pnpm dev -- --mode all
```

### Connect

1. EDITH will print a QR code in the terminal
2. On your phone: **WhatsApp > Linked Devices > Link a Device**
3. Scan the QR code
4. Send `/help`, `/id`, `/ping` to test — then any normal message

### Limitations

- Your phone must stay online for the session to persist
- WhatsApp may disconnect after inactivity — EDITH will attempt reconnection
- Not intended for high-volume production use

---

## Mode B — Meta WhatsApp Cloud API

Official API mode using Meta's Cloud API. Requires a public webhook URL.

### Requirements

- A [Meta Developer account](https://developers.facebook.com/) and app
- A WhatsApp Business phone number in the Meta app
- A public HTTPS URL for the webhook (use [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) or [ngrok](https://ngrok.com/) for local dev)

### Configuration

```env
WHATSAPP_ENABLED=true
WHATSAPP_MODE=cloud
WHATSAPP_CLOUD_ACCESS_TOKEN=EAAG...
WHATSAPP_CLOUD_PHONE_NUMBER_ID=123456789012345
WHATSAPP_CLOUD_VERIFY_TOKEN=my-secret-verify-token
# Optional: comma-separated wa_id allowlist
WHATSAPP_CLOUD_ALLOWED_WA_IDS=628123456789
# Optional: default is v20.0
WHATSAPP_CLOUD_API_VERSION=v20.0
```

### Steps

1. Configure your Meta app and WhatsApp phone number at [developers.facebook.com](https://developers.facebook.com/)
2. Add the env vars above to `.env`
3. Start EDITH and expose the gateway publicly:
   ```bash
   pnpm dev -- --mode all
   cloudflared tunnel --url http://127.0.0.1:18789
   ```
4. In the Meta webhook configuration:
   - Callback URL: `https://<your-public-host>/webhooks/whatsapp`
   - Verify token: value of `WHATSAPP_CLOUD_VERIFY_TOKEN`
   - Subscribe to `messages` events
5. Message your WhatsApp business number from your phone and EDITH will respond

### Known Limitations

- Cloud API requires a verified Meta Business account for production (sandbox available for testing)
- Webhooks must be on HTTPS — not plain HTTP
- WhatsApp Cloud API has rate limits per phone number (see [Meta docs](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages))

---

## Troubleshooting

**QR does not appear:**
- Ensure `WHATSAPP_ENABLED=true` and `WHATSAPP_MODE=baileys`
- Install `qrcode-terminal`: `pnpm add qrcode-terminal`

**Webhook verification fails (Cloud API):**
- Confirm `WHATSAPP_CLOUD_VERIFY_TOKEN` matches what you set in the Meta dashboard
- Ensure the callback path is exactly `/webhooks/whatsapp`

**Messages received but no reply (Cloud API):**
- Check `WHATSAPP_CLOUD_ACCESS_TOKEN` and `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- Check `[channels.whatsapp]` logs
- If using an allowlist, verify the sender's `wa_id` is included

---

## References

- [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)
- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [EDITH Channel Architecture](../architecture.md)
