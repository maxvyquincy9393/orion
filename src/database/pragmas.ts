/**
 * @file pragmas.ts
 * @description SQLite production-grade PRAGMA configuration.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Called once after prisma.$connect() in startup.ts.
 *   These pragmas are session-scoped (re-applied on every connection open).
 *
 * PERFORMANCE + RELIABILITY GAINS:
 *   - WAL mode:            concurrent reads don't block writes
 *   - synchronous NORMAL:  safe durability without per-commit fsync
 *   - busy_timeout 10s:    survive transient write-lock contention
 *   - journal_size_limit:  prevent WAL from growing unbounded
 *   - foreign_keys ON:     enforce referential integrity at DB level
 *   - temp_store MEMORY:   faster sorts/aggregations on temp tables
 *   - mmap_size 256MB:     memory-mapped I/O for read-heavy workloads
 *   - cache_size -32MB:    32 MB page cache (negative = kilobytes)
 */

import type { PrismaClient } from "@prisma/client"

import { createLogger } from "../logger.js"

const log = createLogger("database.pragmas")

/** SQLite pragmas applied on every connection open. Order matters (WAL first). */
const PRAGMAS: readonly string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA busy_timeout = 10000",
  "PRAGMA journal_size_limit = 67108864",
  "PRAGMA foreign_keys = ON",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA mmap_size = 268435456",
  "PRAGMA cache_size = -32768",
] as const

/**
 * Apply production-grade SQLite pragmas to an open Prisma connection.
 * Safe to call multiple times (idempotent for all listed pragmas).
 *
 * @param prisma - Connected PrismaClient instance
 */
export async function applyPragmas(prisma: PrismaClient): Promise<void> {
  const url = process.env.DATABASE_URL ?? ""
  if (!url.startsWith("file:") && !url.includes("sqlite")) {
    log.info("non-SQLite provider detected — skipping SQLite pragmas")
    return
  }

  let applied = 0
  for (const pragma of PRAGMAS) {
    try {
      // $queryRawUnsafe handles both result-returning pragmas (e.g. journal_mode)
      // and non-returning ones — $executeRawUnsafe rejects result-bearing rows.
      await prisma.$queryRawUnsafe(pragma)
      applied++
    } catch (err) {
      log.warn("pragma failed (non-fatal)", { pragma, err: String(err) })
    }
  }
  log.info("SQLite pragmas applied", { applied, total: PRAGMAS.length })
}

/**
 * Run PRAGMA integrity_check and return whether the database is healthy.
 * Intended for use in the /health endpoint.
 *
 * @param prisma - Connected PrismaClient instance
 * @returns true if integrity_check passed, false otherwise
 */
export async function checkIntegrity(prisma: PrismaClient): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>(
      "PRAGMA integrity_check",
    )
    return rows.length === 1 && rows[0]?.integrity_check === "ok"
  } catch {
    return false
  }
}

/**
 * Return current WAL journal mode (should be "wal" after applyPragmas).
 * Useful for health checks and doctor tool.
 *
 * @param prisma - Connected PrismaClient instance
 */
export async function getJournalMode(prisma: PrismaClient): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
      "PRAGMA journal_mode",
    )
    return rows[0]?.journal_mode ?? "unknown"
  } catch {
    return "unknown"
  }
}
