/**
 * @file dm-policy.ts
 * @description Direct message permission policy — controls who can interact with EDITH.
 *
 * ARCHITECTURE:
 *   Enforced at channel layer before messages reach the pipeline.
 *   Modes: open (anyone), allowlist, blocklist, admin-only.
 */
import { createLogger } from '../logger.js'
import { config } from '../config.js'

const log = createLogger('security.dm-policy')

export type DmPolicyMode = 'open' | 'allowlist' | 'blocklist' | 'admin-only'

export interface DmPolicyResult {
  allowed: boolean
  reason: string
}

class DmPolicy {
  private allowlist = new Set<string>()
  private blocklist = new Set<string>()

  /** Get configured policy mode. Defaults to 'open'. */
  private get mode(): DmPolicyMode {
    return (config.DM_POLICY_MODE as DmPolicyMode) ?? 'open'
  }

  /**
   * Check whether a userId is allowed to interact with EDITH.
   * @param userId - User identifier to check
   */
  check(userId: string): DmPolicyResult {
    if (this.blocklist.has(userId)) {
      log.warn('blocked user attempted interaction', { userId })
      return { allowed: false, reason: 'User is blocked' }
    }

    switch (this.mode) {
      case 'open':
        return { allowed: true, reason: 'Open policy' }
      case 'admin-only':
        if (userId === config.ADMIN_USER_ID) return { allowed: true, reason: 'Admin user' }
        return { allowed: false, reason: 'Admin-only policy' }
      case 'allowlist':
        if (this.allowlist.has(userId)) return { allowed: true, reason: 'On allowlist' }
        return { allowed: false, reason: 'Not on allowlist' }
      case 'blocklist':
        return { allowed: true, reason: 'Not on blocklist' }
    }
  }

  /** Add user to allowlist. */
  allow(userId: string): void { this.allowlist.add(userId) }

  /** Add user to blocklist. */
  block(userId: string): void { this.blocklist.add(userId) }
}

export const dmPolicy = new DmPolicy()
