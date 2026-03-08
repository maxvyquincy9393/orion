/**
 * @file data-exporter.ts
 * @description GDPR-compliant personal data exporter. Collects all data for a
 * given user from Prisma, memory stores, and audit logs and writes them as a
 * structured JSON report (optionally ZIP-archived).
 *
 * ARCHITECTURE / INTEGRATION:
 *   - Called by an admin skill command ("Export my data")
 *   - Reads from Prisma DB, audit log, and the memory store
 *   - Output file written to `exports/` directory (created if absent)
 *   - Does NOT depend on the vault (no secrets exported)
 *
 * GDPR BASIS:
 *   - Article 20 — Right to data portability
 *   - Article 17 — Right to erasure (see secure-eraser.ts for deletion)
 */

import { writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../logger.js"
import { prisma } from "../database/index.js"
import { auditLog } from "./audit-log.js"

const log = createLogger("security.data-exporter")

// ── Types ──────────────────────────────────────────────────────────────────────

/** Export request parameters */
export interface ExportRequest {
  /** User whose data to export */
  userId: string
  /** Include audit log entries */
  includeAudit?: boolean
  /** Include raw conversation messages */
  includeMessages?: boolean
  /** Include memory vectors (summaries only, not embeddings) */
  includeMemory?: boolean
}

/** Export result */
export interface ExportResult {
  /** Absolute path of the exported JSON file */
  path: string
  /** Total number of data records included */
  recordCount: number
  /** ISO timestamp of the export */
  exportedAt: string
}

// ── DataExporter ──────────────────────────────────────────────────────────────

/**
 * Collects and exports all personal data for a user.
 */
export class DataExporter {
  private readonly exportDir = "exports"

  /**
   * Export all user data to a JSON file.
   *
   * @param req - Export request
   * @returns Export result with path and record count
   */
  async export(req: ExportRequest): Promise<ExportResult> {
    const exportedAt = new Date().toISOString()
    let recordCount = 0

    const report: Record<string, unknown> = {
      exportedAt,
      userId: req.userId,
      generatedBy: "EDITH Data Exporter (GDPR Art. 20)",
    }

    // ── Messages ────────────────────────────────────────────────────────────
    if (req.includeMessages !== false) {
      const messages = await prisma.message.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          channel: true,
          createdAt: true,
        },
      }).catch(() => [])
      report.messages = messages
      recordCount += messages.length
    }

    // ── User Preferences ─────────────────────────────────────────────────────
    const prefs = await prisma.userPreference
      .findUnique({ where: { userId: req.userId } })
      .catch(() => null)
    if (prefs) {
      const { preferenceHistory: _h, ...safePrefs } = prefs as Record<string, unknown>
      report.preferences = safePrefs
      recordCount++
    }

    // ── People Graph ─────────────────────────────────────────────────────────
    const people = await prisma.person
      .findMany({
        where: { userId: req.userId },
        include: { interactions: { take: 100, orderBy: { date: "desc" } } },
      })
      .catch(() => [])
    report.people = people
    recordCount += people.length

    // ── Memory Nodes ─────────────────────────────────────────────────────────
    if (req.includeMemory !== false) {
      const memories = await prisma.memoryNode
        .findMany({
          where: { userId: req.userId },
          orderBy: { validFrom: "asc" },
          select: { id: true, content: true, category: true, validFrom: true },
        })
        .catch(() => [])
      report.memories = memories
      recordCount += memories.length
    }

    // ── Audit Log ─────────────────────────────────────────────────────────────
    if (req.includeAudit) {
      const entries = await auditLog.readAll()
      const userEntries = entries.filter(e => e.userId === req.userId)
      report.auditLog = userEntries
      recordCount += userEntries.length
    }

    // ── Write file ────────────────────────────────────────────────────────────
    await this.ensureExportDir()
    const filename = `edith-export-${req.userId}-${Date.now()}.json`
    const path = join(this.exportDir, filename)
    await writeFile(path, JSON.stringify(report, null, 2) + "\n", "utf8")

    log.info("data export complete", { userId: req.userId, recordCount, path })
    return { path, recordCount, exportedAt }
  }

  private async ensureExportDir(): Promise<void> {
    if (!existsSync(this.exportDir)) {
      await mkdir(this.exportDir, { recursive: true })
    }
  }
}

/** Singleton data exporter */
export const dataExporter = new DataExporter()
