# ACP Protocol

File: `src/acp/protocol.ts`

## Message Schema
`ACPMessage` fields:
- id, from, to
- type (`request|response|event|error`)
- action
- payload
- correlationId
- timestamp
- signature
- state

## State Machine
- idle -> requested
- requested -> approved|failed
- approved -> executing|failed
- executing -> done|failed

## Signing
- HMAC-SHA256 signature.
- Signed payload string: `id:from:to:action:timestamp`.

## Credential Model
`AgentCredential`:
- agentId
- shared secret
- capabilities list

## Security Guarantees
- Tamper resistance for routed message metadata.
- Explicit state transition enforcement.
- Capability-scoped action invocation.
