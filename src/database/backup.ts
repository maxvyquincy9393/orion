/**
 * @file backup.ts
 * @description Periodic SQLite backup with WAL checkpoint and retention management.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Scheduled from daemon.ts. Before each backup, runs PRAGMA wal_checkpoint(TRUNCATE)
 *   to flush the WAL into the main DB file, ensuring a consistent snapshot.
 *   Backups are written to EDITH_BACKUP_DIR with filename edith-YYYY-MM-DD-HH.db.
 *   Files beyond EDITH_BACKUP_RETAIN_COUNT are pruned (oldest first).
 *
 * PAPER BASIS:
 *   SQLite WAL checkpoint: https://www.sqlite.org/wal.html — TRUNCATE mode resets
 *   the WAL file to zero length after checkpointing for a clean file copy.
 *
 * @module database/backup
 */

import fs from "node:fs/promises"
import path from "node:path"

import { prisma } from "./index.js"
import { createLogger } from "../logger.js"
import config from "../config.js"

const log = createLogger("database.backup")

/** Parse SQLite file path from DATABASE_URL (e.g. "file:./prisma/edith.db"). */
function resolveDbPath(): string {
  const url = config.DATABASE_URL ?? ""
  const filePath = url.startsWith("file:") ? url.slice(5) : url
  return path.resolve(process.cwd(), filePath)
}

/** Generate backup filename: edith-YYYY-MM-DD-HH.db */
function backupFilename(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, "0")
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}`
  return `edith-${dateStr}.db`
}

/**
 * Manages periodic SQLite backups with WAL checkpoint and retention.
 *
 * Usage:
 *   databaseBackup.start()  // call from daemon once at startup
 */
export class DatabaseBackup {
  /** Active interval timer, null when stopped. */
  private timer: ReturnType<typeof setInterval> | null = null

  /**
   * Execute one backup cycle: checkpoint WAL, copy DB file, prune old backups.
   * Safe to call manually at any time.
   */
  async run(): Promise<void> {
    const backupDir = path.resolve(process.cwd(), config.EDITH_BACKUP_DIR)
    const dbPath = resolveDbPath()
    const dest = path.join(backupDir, backupFilename())

    try {
      await fs.mkdir(backupDir, { recursive: true })
      await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)")
      await fs.copyFile(dbPath, dest)
      log.info("backup created", { dest })
      await this.prune(backupDir)
    } catch (err) {
      log.warn("backup failed", { err: String(err) })
    }
  }

  /**
   * Start the periodic backup timer and run an immediate baseline backup.
   * No-op if already running.
   *
   * @param intervalHours - Backup frequency in hours (default: config value)
   */
  start(intervalHours: number = config.EDITH_BACKUP_INTERVAL_HOURS): void {
    if (this.timer) return
    const intervalMs = intervalHours * 60 * 60 * 1_000
    this.timer = setInterval(() => { void this.run() }, intervalMs)
    this.timer.unref()
    log.info("backup scheduler started", {
      intervalHours,
      retainCount: config.EDITH_BACKUP_RETAIN_COUNT,
    })
    void this.run() // immediate baseline
  }

  /** Stop the backup timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Remove the oldest backup files that exceed the retention count.
   * Counts newly created file by adding 1 to existing list length before pruning.
   *
   * @param backupDir - Directory containing backup files
   */
  private async prune(backupDir: string): Promise<void> {
    const retain = config.EDITH_BACKUP_RETAIN_COUNT
    const files = (await fs.readdir(backupDir))
      .filter((f) => f.startsWith("edith-") && f.endsWith(".db"))
      .sort() // lexicographic = chronological for this filename format

    // +1 accounts for the file we just created (not yet in readdir result)
    const totalAfterNew = files.length + 1
    const deleteCount = Math.max(0, totalAfterNew - retain)
    const toDelete = files.slice(0, deleteCount)

    for (const f of toDelete) {
      await fs.unlink(path.join(backupDir, f))
      log.debug("pruned old backup", { file: f })
    }
  }
}

/** Singleton backup instance. */
export const databaseBackup = new DatabaseBackup()
