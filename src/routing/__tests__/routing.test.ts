import { describe, it, expect } from 'vitest'
import { multiAccountKeyManager } from '../multi-account.js'
import { quotaTracker } from '../quota-tracker.js'
import { capabilityRouter } from '../capability-router.js'

describe('MultiAccountKeyManager', () => {
  it('returns null for provider with no keys', () => {
    const key = multiAccountKeyManager.getKey('nonexistent-provider')
    expect(key).toBeNull()
  })

  it('getStats returns object', () => {
    const stats = multiAccountKeyManager.getStats()
    expect(typeof stats).toBe('object')
  })
})

describe('QuotaTracker', () => {
  it('records usage and returns it', () => {
    quotaTracker.record('test-provider', 100)
    const usage = quotaTracker.getUsage('test-provider')
    expect(usage.requests).toBeGreaterThan(0)
    expect(usage.tokens).toBeGreaterThanOrEqual(100)
  })

  it('getAllUsage returns object', () => {
    const all = quotaTracker.getAllUsage()
    expect(typeof all).toBe('object')
  })
})

describe('CapabilityRouter', () => {
  it('routes vision requests to vision-capable providers', () => {
    const decisions = capabilityRouter.route({ taskType: 'multimodal', requiresVision: true })
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions[0]?.provider).toBeDefined()
  })

  it('routes fast requests correctly', () => {
    const decisions = capabilityRouter.route({ taskType: 'fast' })
    expect(decisions.length).toBeGreaterThan(0)
  })

  it('routes code requests to code providers', () => {
    const decisions = capabilityRouter.route({ taskType: 'code', requiresCode: true })
    expect(decisions.length).toBeGreaterThan(0)
    expect(decisions[0]?.provider).toBeDefined()
  })

  it('routes reasoning requests to reasoning providers', () => {
    const decisions = capabilityRouter.route({ taskType: 'reasoning' })
    expect(decisions.length).toBeGreaterThan(0)
  })
})
