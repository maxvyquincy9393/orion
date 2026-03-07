# Causal Graph Dedupe Migration Plan

Date: 2026-02-25

## Why this migration is needed

Runtime dedupe has been added in `src/memory/causal-graph.ts`, but the database schema still allows:

- duplicate `CausalNode` rows for the same `(userId, event)`
- duplicate `HyperEdge` rows representing the same member set + relation

Without schema-level guarantees, retries/concurrency/import jobs can still create duplicates.

## Goals

1. Enforce unique causal nodes per user/event.
2. Add stable dedupe key for hyperedges (user + relation + member set hash).
3. Preserve existing data by backfilling/merging before constraints.
4. Keep rollout safe with staged deploy.

## Proposed schema changes (staged)

Status:
- Stage 1 schema/migration scaffold added in `prisma/migrations/20260225133000_add_causal_graph_dedupe_keys_stage1/`
- Writer now populates `eventKey` / `memberSetHash` at runtime (`src/memory/causal-graph.ts`)
- Dedupe CLI backfills both dedupe key columns during maintenance runs (`src/cli/causal-graph-dedupe.ts`)
- Dedupe CLI now prints explicit Stage-3 readiness counts (missing keys + duplicate groups)
- Stage 3 schema/migration scaffold added in `prisma/migrations/20260225163000_enforce_causal_graph_dedupe_keys_stage3/`
- Stage 3 migration verified locally on empty SQLite dataset (safe syntax/runtime check)
- Runtime writer is hardened for Stage-3 unique constraint races (`P2002`) in `src/memory/causal-graph.ts`
- `getDownstreamEffects()` read path now also uses normalized `eventKey` fallback (prevents case/trim misses after dedupe)
- Stage 3 deploy remains blocked until real environment backfill/dedupe verification is complete

### Stage 1: Add columns/indexes (non-breaking)

- `CausalNode`
  - add normalized column: `eventKey String?`
  - backfill `lower(trim(event))`
  - add non-unique index `@@index([userId, eventKey])`

- `HyperEdge`
  - add nullable `memberSetHash String?`
  - add index `@@index([userId, relation, memberSetHash])`

Notes:
- Keep columns nullable first so deploy is compatible with old writer code.
- Application code should start populating these values before unique constraints are added.

### Stage 2: Backfill + dedupe existing rows

Run an idempotent data migration script:

1. Backfill `CausalNode.eventKey = lower(trim(event))`.
2. Group duplicate `CausalNode` by `(userId, eventKey)`.
3. Pick canonical node per group (oldest `createdAt` or lowest id).
4. Repoint:
   - `CausalEdge.fromId`
   - `CausalEdge.toId`
   - `HyperEdgeMembership.nodeId`
5. Merge duplicate `CausalEdge` rows:
   - keep max `strength`
   - sum `evidence`
6. Delete duplicate `CausalNode` rows.
7. Compute `HyperEdge.memberSetHash` for each row:
   - hash of sorted unique member node ids + normalized relation
8. Group duplicate `HyperEdge` rows by `(userId, relation, memberSetHash)` and merge:
   - keep max `weight`
   - choose latest non-empty `context`
   - merge memberships (set union)

## Hash format recommendation

Deterministic string before hashing:

`<normalizedRelation>::<sortedNodeId1>|<sortedNodeId2>|...`

Use SHA-256 and store hex string.

Reason:
- stable across retries
- independent of insertion order
- cheap to compare/index

## Stage 3: Enforce constraints (breaking if skipped backfill)

After app writes are updated and backfill completes (and preflight counts are zero):

- `CausalNode.eventKey` => non-null
- `HyperEdge.memberSetHash` => non-null
- add unique constraints:
  - `@@unique([userId, eventKey])` on `CausalNode`
  - `@@unique([userId, relation, memberSetHash])` on `HyperEdge`

## Application code changes required

Before Stage 3 deploy, update writers to populate:

- `CausalNode.eventKey`
- `HyperEdge.memberSetHash`

Suggested helper ownership:
- `src/memory/causal-graph.ts` computes normalized relation + member-set hash
- migration script shares the same canonicalization logic (or copies exact algorithm with tests)

## Rollout checklist

1. Deploy code that can read/write new nullable columns.
2. Run backfill + dedupe script in maintenance window (or batched online job).
   - CLI added: `pnpm dedupe:causal-graph:dry-run` / `pnpm dedupe:causal-graph`
3. Verify metrics:
   - duplicate node count = 0
   - duplicate hyperedge count = 0
4. Add unique constraints in migration.
   - Stage-3 migration scaffold now exists: `20260225163000_enforce_causal_graph_dedupe_keys_stage3`
5. Monitor write errors for conflict spikes.

## Verification queries (examples)

- Duplicate nodes:
  - group by `userId, lower(trim(event))` having count > 1
- Duplicate hyperedges:
  - group by `userId, relation, memberSetHash` having count > 1

## Risks / Notes

- Repointing nodes can temporarily increase lock contention on large datasets.
- If relation normalization changes later, hash versioning may be needed.
- Add integration tests around retry/concurrent writes after schema constraints land.
