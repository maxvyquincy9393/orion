/**
 * @file dm-policy.ts
 * @description DM access control policy for the EDITH message pipeline.
 *
 * ARCHITECTURE / INTEGRATION:
 *   The singleton `dmPolicy` is checked at Stage 0 of message-pipeline.ts,
 *   before rate-limiting. Blocked users receive BLOCKED_RESPONSE and the
 *   message is not processed further.
 *
 *   Modes:
 *     open       — all users allowed (default)
 *     allowlist  — only users in ALLOWED_USER_IDS (comma-separated)
 *     blocklist  — block users in BLOCKED_USER_IDS (comma-separated)
 *     admin-only — only ADMIN_USER_ID
 *
 * @module security/dm-policy
 */

import { config } from '../config.js'
import { createLogger } from '../logger.js'

const log = createLogger('security.dm-policy')

/** Supported DM access policy modes. */
export type PolicyMode = 'open' | 'allowlist' | 'blocklist' | 'admin-only'

/** @deprecated Use PolicyMode instead. */
export type DmPolicyMode = PolicyMode

/** Configuration for a DmPolicy instance. */
interface DmPolicyConfig {
  /** Access mode. */
  mode: PolicyMode
  /** Admin user ID — only checked in admin-only mode. */
  adminUserId: string
  /** User IDs to allow — only checked in allowlist mode. */
  allowedIds: string[]
  /** User IDs to block — only checked in blocklist mode. */
  blockedIds: string[]
}

/**
 * DM access policy — determines which userId values may interact with EDITH.
 *
 * Construct via the `dmPolicy` singleton which reads env config, or
 * construct directly for testing with specific options.
 */
export class DmPolicy {
  private readonly cfg: DmPolicyConfig

  /** @param cfg - Policy configuration */
  constructor(cfg: DmPolicyConfig) {
    this.cfg = cfg
  }

  /**
   * Returns true if the user is permitted to send messages.
   *
   * @param userId - Inbound user identifier
   */
  isAllowed(userId: string): boolean {
    const { mode, adminUserId, allowedIds, blockedIds } = this.cfg

    switch (mode) {
      case 'open':
        return true
      case 'allowlist':
        return allowedIds.includes(userId)
      case 'blocklist':
        return !blockedIds.includes(userId)
      case 'admin-only':
        return Boolean(adminUserId) && userId === adminUserId
    }
  }
}

/** Parse a comma-separated env var into a trimmed string array. */
function parseIds(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Singleton DM policy built from environment configuration. */
export const dmPolicy = new DmPolicy({
  mode: (config.DM_POLICY_MODE as PolicyMode) ?? 'open',
  adminUserId: config.ADMIN_USER_ID ?? '',
  allowedIds: parseIds(config.ALLOWED_USER_IDS ?? ''),
  blockedIds: parseIds(config.BLOCKED_USER_IDS ?? ''),
})

log.info('DM policy active', { mode: config.DM_POLICY_MODE })
