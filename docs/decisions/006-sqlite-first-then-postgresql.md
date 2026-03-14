# ADR-006: SQLite First, Then PostgreSQL

## Status
Accepted

## Context
EDITH should work as a single-binary personal assistant with zero external dependencies for the common case (one user, one device), but must also scale to multi-user deployments with concurrent access and proper transaction isolation.

These two requirements conflict: SQLite excels at embedded, single-writer workloads; PostgreSQL excels at concurrent multi-user access.

## Decision
**SQLite as the default database**, with PostgreSQL as an opt-in production backend.

Implementation strategy:
- `prisma/schema.prisma` uses `provider = "sqlite"` with `DATABASE_URL = "file:./edith.db"`
- `prisma/schema.postgresql.prisma` uses `provider = "postgresql"` for production
- `DATABASE_PROVIDER` config var selects the active schema
- All queries go through Prisma — no raw SQL (ensuring compatibility with both engines)
- WAL mode, busy_timeout, and mmap_size pragmas are applied on startup for SQLite performance

## Consequences
**Positive:**
- Zero-config for personal use: `npx edith` just works with SQLite
- No Docker, no PostgreSQL install, no connection string configuration needed
- SQLite WAL mode provides excellent read concurrency for a single-user workload
- PostgreSQL path available for teams, multi-user, or high-availability deployments
- Prisma abstracts most dialect differences

**Negative:**
- Dual schema files must be kept in sync (risk of drift)
- Some SQLite-specific features (PRAGMA, incremental_vacuum) need conditional execution
- PostgreSQL-specific features (LISTEN/NOTIFY, advisory locks) cannot be used universally
- Migration paths diverge: SQLite dev migrations vs PostgreSQL deploy migrations
- Schema validation must pass for both providers independently

## Alternatives Considered
- **PostgreSQL only:** Simpler single-schema, but violates the "zero external deps" goal
- **SQLite only:** Perfect for personal use, but cannot scale to multi-user with concurrent writers
- **libSQL/Turso:** SQLite-compatible with replication, but adds a cloud dependency
- **DuckDB:** Excellent for analytics but not designed for OLTP workloads
