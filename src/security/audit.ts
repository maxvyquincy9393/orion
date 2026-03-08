/**
 * @file audit.ts
 * @description Immutable audit trail — write-only record of all significant actions.
 *
 * ARCHITECTURE:
 *   All message pipeline stages write to audit log (Stage 9 in message-pipeline.ts).
 *   Audit records are write-only — no update/delete for immutability.
 *   Risk levels trigger different log verbosity + escalation.
 *
 * PAPER BASIS:
 *   CaMeL (arXiv:2503.18813) — data flow tracking for LLM agents
 *   Operationalizing CaMeL (arXiv:2505.22852) — tiered-risk access model
 */
import { createLogger } from '../logger.js'
import { prisma } from '../database/index.js'

const log = createLogger('security.audit')

export type AuditRisk = 'low' | 'medium' | 'high' | 'critical'

export interface AuditEntry {
  userId: string
  action: 'message' | 'tool_call' | 'memory_write' | 'channel_send' | 'auth' | 'config_change'
  channel?: string
  input?: string
  output?: string
  metadata?: Record<string, unknown>
}

const CRITICAL_PATTERNS = [
  /rm\s+-rf/i, /format\s+c:/i, /dd\s+if=/i,
  /drop\s+table/i, /truncate\s+table/i,
]

const HIGH_RISK_TOOLS = new Set(['shell_exec', 'file_delete', 'db_query', 'eval_code'])

/** Classify risk level of an audit entry based on action and metadata. */
function classifyRisk(entry: AuditEntry): AuditRisk {
  if (entry.action === 'tool_call') {
    const tool = String(entry.metadata?.tool ?? '')
    const cmd = String(entry.metadata?.command ?? '')
    if (CRITICAL_PATTERNS.some(p => p.test(cmd))) return 'critical'
    if (HIGH_RISK_TOOLS.has(tool)) return 'high'
    return 'medium'
  }
  if (entry.action === 'config_change') return 'high'
  if (entry.action === 'auth') return 'medium'
  return 'low'
}

/** Truncate a string to `max` characters, appending ellipsis if needed. */
function trunc(s: string | undefined, max = 500): string | undefined {
  return s && s.length > max ? s.slice(0, max) + '…' : s
}

class AuditEngine {
  /**
   * Record an audit event. Fire-and-forget safe — catches internally.
   * @returns The created audit record ID, or 'audit-failed' on error.
   */
  async record(entry: AuditEntry): Promise<string> {
    const risk = classifyRisk(entry)
    try {
      const record = await prisma.auditRecord.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          channel: entry.channel,
          input: trunc(entry.input),
          output: trunc(entry.output),
          risk,
          metadata: (entry.metadata ?? {}) as object,
        },
      })
      if (risk === 'critical' || risk === 'high') {
        log.warn('high-risk action', { userId: entry.userId, action: entry.action, risk })
      }
      return record.id
    } catch (err) {
      log.error('audit write failed', { userId: entry.userId, err })
      return 'audit-failed'
    }
  }

  /**
   * Query recent audit records for a user.
   * @param userId - User identifier
   * @param limit - Max records to return
   */
  async query(userId: string, limit = 50): Promise<{ id: string; action: string; risk: string; createdAt: Date }[]> {
    return prisma.auditRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, action: true, risk: true, createdAt: true },
    })
  }
}

export const auditEngine = new AuditEngine()
