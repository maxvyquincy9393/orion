# ACP Router

File: `src/acp/router.ts`

## Core APIs
- `registerAgent(id, capabilities, handler)`
- `send(message, senderSecret)`
- `request(from, to, action, payload, senderSecret, timeoutMs)`
- `getCapabilities(agentId)`
- `findAgentByCapability(capability)`

## Send Validation Pipeline
1. Verify sender/receiver registration.
2. Verify sender secret matches registered credential.
3. Verify HMAC signature.
4. Filter payload for injection patterns.
5. Validate sender capability for requested action.
6. Validate state transition for message flow.
7. Route to receiver handler.
8. Audit transitions with provenance metadata.

## Timeout Semantics
`request()` uses bounded wait and throws on timeout.

## Audit Trail
ACP transitions are persisted as system messages with provenance tags.

## Integration
- Runner registers capability set for execution routes.
- Daemon registers health/start/stop routes.
