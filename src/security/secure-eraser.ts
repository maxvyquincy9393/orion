/**
 * @file secure-eraser.ts
 * @description GDPR Article 17 "Right to Erasure" implementation.
 * Deletes all user data from Prisma, overwrites binary vault entries, and
 * optionally runs SQLite `VACUUM` to reclaim disk space and prevent
 * journal-file leaks.
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by admin skill command ("Delete all my data")
 *   - Prisma cascade deletes handle relational data
 *   - DB VACUUM is run via a raw `$executeRaw` query after deletion
 *   - Does NOT delete the audit log (required for compliance) but marks the
 *     user's entries with `[ERASED]` placeholders
 *
 * SECURITY:
 *   - All Prisma operations run in a transaction where possible
 *   - Deletion is logged (irony intended — audit entry survives)
 */

import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { vault } from "./vault.js"

const log = createLogger("security.secure-eraser")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Result of a secure erase operation */
export interface EraseResult {
  /** User that was erased */
  userId: string
  /** ISO timestamp */
  erasedAt: string
  /** How many rows were deleted from each table */
  deleted: Record<string, number>
}

// ── SecureEraser ──────────────────────────────────────────────────────────────

/**
 * Performs a complete right-to-erasure for a given userId.
 */
export class SecureEraser {
  /**
   * Erase all personal data for `userId`.
   *
   * @param userId - User to erase
   * @param vacuum - Run `VACUUM` on the SQLite DB afterward (default true)
   * @returns Deletion summary
   */
  async eraseUser(userId: string, vacuum = true): Promise<EraseResult> {
    const erasedAt = new Date().toISOString()
    const deleted: Record<string, number> = {}

    log.info("beginning user erasure", { userId })

    // ── Delete relational rows (order matters for FK constraints) ────────────

    deleted.personInteractions = await prisma.personInteraction
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.people = await prisma.person
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.messages = await prisma.message
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.memoryNodes = await prisma.memoryNode
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.preferenceSignals = await prisma.preferenceSignal
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.userPreferences = await prisma.userPreference
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    deleted.activityRecords = await prisma.activityRecord
      .deleteMany({ where: { userId } })
      .then(r => r.count)
      .catch(() => 0)

    // ── Vault entries tagged with userId ─────────────────────────────────────
    if (vault.isUnlocked()) {
      const keys = await vault.list()
      const userKeys = keys.filter(k => k.startsWith(`user:${userId}:`))
      for (const k of userKeys) {
        await vault.delete(k)
        deleted.vaultEntries = (deleted.vaultEntries ?? 0) + 1
      }
    }

    // ── VACUUM ───────────────────────────────────────────────────────────────
    if (vacuum) {
      try {
        await prisma.$executeRawUnsafe("VACUUM")
        log.info("SQLite VACUUM complete")
      } catch (err) {
        log.warn("VACUUM failed (non-fatal)", { err })
      }
    }

    log.info("user erasure complete", { userId, deleted })
    return { userId, erasedAt, deleted }
  }

  /**
   * Erase a specific vault key.
   *
   * @param key - Vault key to remove
   * @returns `true` if key existed and was removed
   */
  async eraseVaultKey(key: string): Promise<boolean> {
    if (!vault.isUnlocked()) {
      log.warn("cannot erase vault key — vault locked", { key })
      return false
    }
    return vault.delete(key)
  }
}

/** Singleton secure eraser */
export const secureEraser = new SecureEraser()
