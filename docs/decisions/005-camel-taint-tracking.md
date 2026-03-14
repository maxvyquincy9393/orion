# ADR-005: CaMeL Taint Tracking for Tool Security

## Status
Accepted

## Context
EDITH executes tools (file operations, browser navigation, code execution) on behalf of the user. When LLM-generated responses contain data from untrusted sources (web content, file content, code output), this tainted data could flow into write-capable tools, enabling indirect prompt injection attacks.

Example attack: a malicious web page embeds hidden instructions that the LLM follows, causing it to write to sensitive files using the file agent.

## Decision
Implement **CaMeL** (Capability-based Machine Learning) guard with HMAC-SHA256 signed capability tokens for taint tracking and tool authorization.

**Token lifecycle:**
1. `issueCapabilityToken()` — creates an HMAC-SHA256 signed token scoped to a specific actor, tool, action, and taint sources. TTL: 5 minutes.
2. `check()` — before any tainted write operation, validates the token against the request. Blocks if: no token, expired, actor mismatch, scope mismatch, or taint mismatch.
3. `inferToolResultTaintSources()` — automatically tags tool results with appropriate taint sources (browser → `web_content`, file reads → `file_content`, code runner → `code_output`).

**Read-only operations are exempt** — they cannot cause harm even with tainted data.

## Consequences
**Positive:**
- Prevents indirect prompt injection from flowing tainted data into destructive actions
- Cryptographically verifiable: tokens cannot be forged without the HMAC secret
- Timing-safe comparison prevents side-channel attacks on token validation
- Granular: tokens are scoped to specific actor + tool + action + taint sources

**Negative:**
- Requires EDITH_CAPABILITY_SECRET (min 32 chars) — operational overhead
- Adds friction to legitimate tool chains: multi-step workflows need token re-issuance
- Token expiry (5 min) means long-running operations may need to re-acquire tokens

## Alternatives Considered
- **Blanket allow/deny lists:** Too coarse; blocks legitimate use cases
- **LLM self-review:** Unreliable; the same LLM that was injected does the review
- **Sandboxing only:** Prevents damage but doesn't prevent data exfiltration
