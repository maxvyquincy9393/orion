# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x (Phases 28–45) | Yes — active |
| 1.x (Phases 23–27) | Critical fixes only |
| 0.x (Phases 1–22)  | No |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in EDITH, please disclose it responsibly:

1. **Email:** Send details to the maintainer via GitHub's private vulnerability reporting feature (`Security` tab > `Report a vulnerability`).
2. **Include in your report:**
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. **Response timeline:**
   - Acknowledgement within 48 hours
   - Assessment and triage within 7 days
   - Fix and coordinated disclosure within 30 days for critical issues

We will credit reporters in the release notes unless you request anonymity.

---

## Security Architecture

EDITH implements multiple security layers:

### CaMeL Taint Tracking (`src/security/camel-guard.ts`)
- Tracks data provenance from untrusted sources (user input, external APIs)
- Capability tokens gate access to sensitive operations
- Taint propagates through the data flow — a tainted value cannot reach a privileged operation without explicit declassification

### Prompt Filter (`src/security/prompt-filter.ts`)
- Scans all incoming messages for prompt injection patterns
- Blocks attempts to override system instructions or extract memory

### Output Scanner (`src/security/output-scanner.ts`)
- Scans LLM outputs before delivery to channels
- Redacts potential PII or secrets that may have leaked into responses

### Audit Trail
- All security events are logged via `createLogger("security.*")`
- Logs include userId, action, and outcome for forensic review

### Rate Limiting
- Per-user rate limiting at the pipeline level (`src/security/pipeline-rate-limiter.ts`)
- Per-channel rate limiting (`src/channels/channel-rate-limiter.ts`)
- Outbox backpressure with dead-letter logging (`src/channels/outbox.ts`)

---

## Known Security Considerations

### Local Deployment
- EDITH is designed for local/self-hosted deployment
- The gateway HTTP server binds to `localhost` by default
- Exposing the gateway to the public internet requires additional authentication hardening

### API Keys
- All API keys must be stored in `.env` — never committed to git
- The `.env` file is in `.gitignore`
- Config validation at startup (`src/config.ts`) catches missing keys early

### Database
- SQLite database (`prisma/edith.db`) is local and not encrypted by default
- For sensitive deployments, consider encrypting the filesystem or using a remote PostgreSQL instance

### Python Sidecars
- Python sidecar processes (`python/delivery/streaming_voice.py`, `python/vision/processor.py`) run as child processes
- They communicate over local stdio/socket — not exposed to the network
- Audio and image data processed by sidecars is not persisted beyond the session

### LLM Prompt Security
- System prompts (including `workspace/SOUL.md`) are loaded at startup and injected into every conversation
- The CaMeL guard and prompt filter run before LLM calls to prevent prompt injection

---

## Dependency Security

We use `pnpm` with a lockfile. To audit dependencies:

```bash
pnpm audit
```

Known limitations:
- Some optional peer dependencies (e.g., `serialport`, `mqtt`) may have advisories — these are only loaded when the corresponding hardware features are enabled via config
