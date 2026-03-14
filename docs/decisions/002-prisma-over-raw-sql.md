# ADR-002: Prisma over Raw SQL

## Status
Accepted

## Context
EDITH needs an ORM/query layer that supports both SQLite (development, single-user) and PostgreSQL (production, multi-user). The query layer must provide type-safe queries, automatic migrations, and schema introspection.

Options evaluated: raw `better-sqlite3`, Drizzle ORM, Knex.js, TypeORM, Prisma.

## Decision
Use **Prisma** with a dual-schema strategy: `prisma/schema.prisma` (SQLite default) and `prisma/schema.postgresql.prisma` (production).

## Consequences
**Positive:**
- Full TypeScript type safety — generated client matches schema exactly
- Automatic migration generation and deployment (`prisma migrate dev/deploy`)
- Schema as code — single source of truth for data model
- Built-in connection pooling via Prisma Client engine
- Excellent developer experience with auto-complete and validation

**Negative:**
- Prisma Client binary adds ~30MB to the deployment
- Generated client requires `prisma generate` after schema changes (can fail on Windows due to DLL locks)
- Some advanced SQL features (window functions, CTEs) require `$queryRaw`
- Dual-schema approach means maintaining two files in sync

## Alternatives Considered
- **Drizzle ORM:** Lighter weight, SQL-first; rejected because Prisma was already adopted and migration would be high-effort
- **Knex.js:** Query builder only, no type generation; rejected for lacking type safety
- **TypeORM:** Decorator-heavy, weaker TypeScript support; rejected for DX concerns
- **Raw SQL:** Maximum control but zero type safety and no migration tooling
