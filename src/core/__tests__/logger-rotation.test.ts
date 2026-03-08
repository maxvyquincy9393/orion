/**
 * @file logger-rotation.test.ts
 * @description Tests for log file daily rotation and retention pruning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockMkdirSync,
  mockCreateWriteStream,
  mockReaddirSync,
  mockUnlinkSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockCreateWriteStream: vi.fn(() => ({ write: vi.fn(), end: vi.fn() })),
  mockReaddirSync: vi.fn().mockReturnValue([]),
  mockUnlinkSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
}))

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: mockMkdirSync,
    createWriteStream: mockCreateWriteStream,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
    existsSync: mockExistsSync,
  },
  mkdirSync: mockMkdirSync,
  createWriteStream: mockCreateWriteStream,
  readdirSync: mockReaddirSync,
  unlinkSync: mockUnlinkSync,
  existsSync: mockExistsSync,
}))

vi.mock("../../config.js", () => ({
  default: { LOG_LEVEL: "info", LOG_RETAIN_DAYS: 3 },
}))

import { buildLogFilename, pruneOldLogs } from "../../logger.js"

describe("buildLogFilename", () => {
  it("generates YYYY-MM-DD format", () => {
    const name = buildLogFilename(new Date("2026-03-09T12:00:00Z"))
    expect(name).toMatch(/^edith-\d{4}-\d{2}-\d{2}\.log$/)
  })

  it("uses the provided date, not current time", () => {
    const name = buildLogFilename(new Date("2026-01-15T00:00:00Z"))
    expect(name).toContain("2026-01-15")
  })
})

describe("pruneOldLogs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("deletes files older than retain window", () => {
    mockReaddirSync.mockReturnValue([
      "edith-2026-01-01.log",
      "edith-2026-03-07.log",
      "edith-2026-03-08.log",
      "edith-2026-03-09.log",
    ])
    pruneOldLogs("/logs", new Date("2026-03-09T12:00:00Z"), 3)
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("2026-01-01"))
  })

  it("does not delete files within retain window", () => {
    mockReaddirSync.mockReturnValue([
      "edith-2026-03-07.log",
      "edith-2026-03-08.log",
      "edith-2026-03-09.log",
    ])
    pruneOldLogs("/logs", new Date("2026-03-09T12:00:00Z"), 3)
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })

  it("ignores non-log files", () => {
    mockReaddirSync.mockReturnValue(["edith.log", "other.txt", "edith-2026-01-01.log"])
    pruneOldLogs("/logs", new Date("2026-03-09T12:00:00Z"), 3)
    // Only the dated log file should be considered for deletion
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1)
  })
})
