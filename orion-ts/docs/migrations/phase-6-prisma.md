# Phase 6 Prisma Migration Notes

## Schema Changes
- `UserProfile` switched from single attributes blob to:
  - `facts`
  - `opinions`
  - `topics`
- Added `MemoryNode` table for temporal hierarchy.
- Added `HyperEdge` and `HyperEdgeMembership` for complex graph relations.

## Migration File
`prisma/migrations/20260222020000_add_temporal_memory_and_hyperedge/migration.sql`

## Data Backfill
- Existing `attributes` moved into `facts` where applicable.
- `opinions` initialized as empty array for migrated records.

## Operational Steps
1. `pnpm prisma migrate dev`
2. `pnpm prisma generate`
3. `pnpm typecheck`

## Rollback Guidance
- Keep pre-migration DB backup.
- Rollback requires restoring prior schema snapshot for `UserProfile` shape.

## Validation Queries
- Count memory nodes by level.
- Verify profile rows contain both facts and opinions arrays.
- Verify hyper-edge membership references valid causal nodes.
