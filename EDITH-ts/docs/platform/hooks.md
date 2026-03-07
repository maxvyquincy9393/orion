# Hooks

Files:
- `src/hooks/registry.ts`
- `src/hooks/pipeline.ts`

## Hook Types
- pre_message
- post_message
- pre_tool
- post_tool
- pre_send
- post_send

## Hook Contract
`handler(context) -> Promise<context>`

Context fields:
- userId
- channel
- content
- metadata
- abort
- abortReason

## Ordering
- Hooks sorted by descending `priority`.
- Pipeline stops when `abort=true`.

## Error Handling
- Hook failures are logged.
- Pipeline continues unless hook explicitly aborts.

## Gateway Integration
- pre_message before filtering/model prompt.
- post_message after generation.
- pre_send before persistence/delivery.
