import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auditEngine } from '../audit.js'

vi.mock('../../database/index.js', () => ({
  prisma: {
    auditRecord: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    }
  }
}))

describe('AuditEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records a message action', async () => {
    const id = await auditEngine.record({ userId: 'u1', action: 'message', input: 'hi', output: 'hello' })
    expect(id).toBeDefined()
    expect(id).not.toBe('audit-failed')
  })

  it('truncates long inputs to 500 chars', async () => {
    const long = 'a'.repeat(2000)
    await auditEngine.record({ userId: 'u1', action: 'message', input: long })
    const { prisma } = await import('../../database/index.js')
    const call = vi.mocked(prisma.auditRecord.create).mock.calls[0]![0]
    expect(call.data.input?.length).toBeLessThanOrEqual(501) // 500 + ellipsis
  })

  it('classifies critical-risk tool calls', async () => {
    await auditEngine.record({
      userId: 'u1', action: 'tool_call',
      metadata: { tool: 'shell_exec', command: 'rm -rf /' }
    })
    const { prisma } = await import('../../database/index.js')
    const call = vi.mocked(prisma.auditRecord.create).mock.calls[0]![0]
    expect(call.data.risk).toBe('critical')
  })

  it('classifies config_change as high risk', async () => {
    await auditEngine.record({ userId: 'u1', action: 'config_change' })
    const { prisma } = await import('../../database/index.js')
    const call = vi.mocked(prisma.auditRecord.create).mock.calls[0]![0]
    expect(call.data.risk).toBe('high')
  })
})
