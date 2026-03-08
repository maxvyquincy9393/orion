/**
 * @file backup.test.ts
 * @description Unit tests for the DatabaseBackup service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("node:fs/promises", () => ({
  default: {
    copyFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  copyFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  unlink: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../index.js", () => ({
  prisma: { $executeRawUnsafe: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../config.js", () => ({
  default: {
    DATABASE_URL: "file:./prisma/edith.db",
    EDITH_BACKUP_DIR: ".edith/backups",
    EDITH_BACKUP_RETAIN_COUNT: 3,
    EDITH_BACKUP_INTERVAL_HOURS: 1,
  },
}))

import fs from "node:fs/promises"
import { prisma } from "../index.js"
import { DatabaseBackup } from "../backup.js"

const mockFs = fs as unknown as {
  copyFile: ReturnType<typeof vi.fn>
  mkdir: ReturnType<typeof vi.fn>
  readdir: ReturnType<typeof vi.fn>
  unlink: ReturnType<typeof vi.fn>
}
const mockPrisma = prisma as unknown as {
  $executeRawUnsafe: ReturnType<typeof vi.fn>
}

describe("DatabaseBackup", () => {
  let backup: DatabaseBackup

  beforeEach(() => {
    backup = new DatabaseBackup()
    vi.clearAllMocks()
    mockFs.readdir.mockResolvedValue([])
    mockFs.copyFile.mockResolvedValue(undefined)
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.unlink.mockResolvedValue(undefined)
    mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined)
  })

  it("creates backup directory if missing", async () => {
    await backup.run()
    expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining("backups"), { recursive: true })
  })

  it("runs WAL checkpoint before copy", async () => {
    const order: string[] = []
    mockPrisma.$executeRawUnsafe.mockImplementation(() => { order.push("checkpoint"); return Promise.resolve() })
    mockFs.copyFile.mockImplementation(() => { order.push("copy"); return Promise.resolve() })
    await backup.run()
    expect(order.indexOf("checkpoint")).toBeLessThan(order.indexOf("copy"))
  })

  it("copies DB file with timestamped name", async () => {
    await backup.run()
    expect(mockFs.copyFile).toHaveBeenCalledOnce()
    const dest = mockFs.copyFile.mock.calls[0]?.[1] as string
    expect(dest).toMatch(/edith-\d{4}-\d{2}-\d{2}-\d{2}\.db$/)
  })

  it("prunes old backups when over retain count", async () => {
    mockFs.readdir.mockResolvedValue([
      "edith-2026-01-01-00.db",
      "edith-2026-01-01-01.db",
      "edith-2026-01-01-02.db",
      "edith-2026-01-01-03.db",
    ])
    await backup.run()
    // 4 existing + 1 new = 5 total, retain 3, prune 2
    expect(mockFs.unlink).toHaveBeenCalledTimes(2)
  })

  it("does not prune when under retain count", async () => {
    mockFs.readdir.mockResolvedValue(["edith-2026-01-01-00.db"])
    await backup.run()
    expect(mockFs.unlink).not.toHaveBeenCalled()
  })
})
