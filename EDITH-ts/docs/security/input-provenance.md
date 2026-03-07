# Input Provenance

File: `src/sessions/input-provenance.ts`

## Data Model
- `InputSource`
  - `user_direct`
  - `tool_result`
  - `webhook`
  - `proactive_trigger`
- `ProvenanceTag`
  - source
  - timestamp
  - metadata

## Why It Exists
- Audit trail for where each prompt fragment came from.
- Safer policy decisions for untrusted sources.
- Better incident reconstruction after suspicious behavior.

## Storage Guidance
Provenance should be attached into message metadata for:
- gateway ingress
- tool result persistence
- daemon generated proactive messages
- ACP state transition audits

## Usage Patterns
- Tag at ingress (`tagProvenance`).
- Convert tag for message metadata (`provenanceToMetadata`).
- Extract during analysis (`extractProvenanceFromMetadata`).

## Security Use Cases
- Distinguish direct user text from scraped web/tool output.
- Raise stricter filtering for indirect sources.
- Trace state transitions in multi-agent protocols.
