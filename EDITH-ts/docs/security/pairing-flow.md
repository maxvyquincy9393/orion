# Pairing Flow

Files:
- `src/pairing/store.ts`
- `src/pairing/manager.ts`

## Purpose
Gate unknown senders before they can trigger privileged actions.

## Entities
- `PairingCode`: temporary code, expiration timestamp, approval state.
- `ApprovedUser`: durable approval record by user+channel.

## Lifecycle
1. Unknown sender sends message.
2. System issues N-digit code with expiry.
3. Owner receives code via trusted channel.
4. Owner approves code.
5. Sender is marked approved for that channel.

## Expiration and Cleanup
- Expired pairing codes removed by background cleanup.
- Revocation can invalidate previous approvals.

## Security Guarantees
- Approval is explicit, channel-scoped.
- Code expiry limits replay window.

## Failure Modes
- Owner unreachable.
- Channel identity spoofing upstream.
- Expired code race.

## Validation Checklist
- Code uniqueness.
- Expiry enforced at approve and lookup.
- Revoke path covered by tests.
