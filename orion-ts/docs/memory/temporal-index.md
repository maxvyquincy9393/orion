# Temporal Index

File: `src/memory/temporal-index.ts`

## Purpose
Provide temporal hierarchy and validity-aware retrieval.

## Types
- `MemoryLevel`
  - 0 raw observation
  - 1 distilled summary
  - 2 abstraction/persona

- `TemporalMemoryNode`
  - id, userId, content, level, validFrom, validUntil, category

## APIs
- `store(userId, content, level, category)`
- `expire(nodeId)`
- `retrieve(userId, query, complexity)`
- `consolidate(userId)`
- `runMaintenance(userId)`

## Complexity Detection
- Simple when query <= 8 words and no `why/how/explain/history`.
- Complex otherwise.

## Consolidation Rule
- Every 50 active level-0 nodes per user:
  - build summary into level-1 node
  - mark consolidated raw nodes expired (`validUntil` set)

## Maintenance Rule
- Expire old raw nodes and stale summaries by age thresholds.
- Run periodically from daemon.

## Retrieval Behavior
- Simple: levels 1-2 only.
- Complex: all levels.
- Tokenized fallback search for sparse matches.

## Notes
- Expiry is non-destructive.
- Content remains auditable in DB.
