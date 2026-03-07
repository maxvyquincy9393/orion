# Phase 9 Additional Channels Overview

## Scope
Expand beyond baseline channels and normalize send/confirm behavior through `BaseChannel`.

## Added Channels
- Signal (`signal-cli` subprocess)
- LINE (Messaging API)
- Matrix (client-server API)
- Microsoft Teams (Bot Framework style API)
- iMessage via BlueBubbles

## Common Behavior
- All implement `BaseChannel`.
- `send()` returns boolean success.
- `sendWithConfirm()` follows YES/NO poll model.
- Markdown rendered per channel mapping.
- Long messages split into chunks before delivery.

## Manager Integration
`channels/manager.ts` registers and starts all channels, then picks first connected channel in priority order for sends.
