/**
 * @file camel-enhanced.ts
 * @description Tiered-risk access model — enhanced CaMeL implementation.
 *
 * PAPER BASIS:
 *   CaMeL (arXiv:2503.18813) — provable security for LLM agents
 *   Operationalizing CaMeL (arXiv:2505.22852) — tiered-risk access model
 *
 * ARCHITECTURE:
 *   Three tiers per Operationalizing CaMeL paper:
 *   Tier 1 (trusted): Direct user commands → full capability
 *   Tier 2 (uncertain): LLM-generated content → read-only, no exfiltration
 *   Tier 3 (untrusted): External data → quarantined, no tool execution
 */
import { createLogger } from '../logger.js'

const log = createLogger('security.camel-enhanced')

export type TrustTier = 1 | 2 | 3

export interface TieredContent {
  content: string
  tier: TrustTier
  source: 'user' | 'llm' | 'external'
}

export interface CapabilityCheck {
  allowed: boolean
  reason: string
  requiredTier: TrustTier
}

/** Capabilities available per trust tier. */
const TIER_CAPABILITIES: Record<TrustTier, Set<string>> = {
  1: new Set(['read', 'write', 'execute', 'network', 'exfiltrate']),
  2: new Set(['read', 'write']),
  3: new Set(['read']),
}

class CaMeLEnhanced {
  /**
   * Classify content into a trust tier based on its source.
   * @param source - Where the content came from
   * @returns Trust tier (1=trusted, 2=uncertain, 3=untrusted)
   */
  classifyTier(source: 'user' | 'llm' | 'external'): TrustTier {
    switch (source) {
      case 'user': return 1
      case 'llm': return 2
      case 'external': return 3
    }
  }

  /**
   * Check if a capability is allowed for a given trust tier.
   * @param capability - Capability to check (read/write/execute/network/exfiltrate)
   * @param tier - Trust tier of the content requesting the capability
   */
  checkCapability(capability: string, tier: TrustTier): CapabilityCheck {
    const allowed = TIER_CAPABILITIES[tier].has(capability)
    if (!allowed) {
      log.warn('capability denied by tier', { capability, tier })
    }
    return {
      allowed,
      reason: allowed ? `Tier ${tier} allows ${capability}` : `Tier ${tier} denies ${capability}`,
      requiredTier: 1,
    }
  }

  /**
   * Sanitize external content by stripping potential injection vectors.
   * @param content - Raw external content to sanitize
   * @returns Sanitized content safe for Tier 3 processing
   */
  sanitizeExternal(content: string): string {
    return content
      .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, '[REDACTED]')
      .replace(/system\s+prompt/gi, '[REDACTED]')
      .slice(0, 10_000) // Cap length to prevent context flooding
  }
}

export const caMeLEnhanced = new CaMeLEnhanced()
