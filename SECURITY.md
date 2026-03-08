# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

Please **DO NOT** open a public issue for security vulnerabilities.

Send a private email to the maintainer with:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment
4. Suggested fix (optional)

We will respond within 48 hours and coordinate a fix and disclosure.

## Security Architecture

EDITH implements multiple security layers:

- **CaMeL taint tracking** — capability tokens prevent privilege escalation
- **Prompt injection protection** — multi-layer input sanitization
- **Immutable audit trail** — all actions logged with risk classification
- **Skill scanner** — detects malicious patterns in loaded skills
- **DM policy** — configurable access control (open/allowlist/blocklist/admin-only)
- **Safe regex** — ReDoS protection via pattern analysis
- **External content analysis** — URL and content risk scoring
- **Rate limiting** — per-channel and global pipeline rate limits
- **Output scanning** — validates LLM responses before delivery
