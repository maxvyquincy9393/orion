import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { join } from "node:path"

// Must mock os/logger before importing SUT
vi.mock("../../logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

const mockHomedir = vi.fn(() => "/home/testuser")
const mockPlatform = vi.fn(() => "linux" as NodeJS.Platform)

vi.mock("node:os", () => ({
  homedir: () => mockHomedir(),
  platform: () => mockPlatform(),
}))

import { getRuntimePaths, getLegacyEdithDir } from "../runtime-paths.js"

describe("getRuntimePaths", () => {
  const envBackup: Record<string, string | undefined> = {}

  beforeEach(() => {
    // Backup and clear XDG vars
    for (const key of [
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
      "APPDATA", "LOCALAPPDATA",
    ]) {
      envBackup[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  it("returns XDG-based paths on Linux", () => {
    mockPlatform.mockReturnValue("linux")
    mockHomedir.mockReturnValue("/home/testuser")

    const paths = getRuntimePaths()

    expect(paths.config).toBe(join("/home/testuser", ".config", "edith"))
    expect(paths.data).toBe(join("/home/testuser", ".local", "share", "edith"))
    expect(paths.logs).toContain("edith")
    expect(paths.cache).toBe(join("/home/testuser", ".cache", "edith"))
  })

  it("respects XDG_CONFIG_HOME override on Linux", () => {
    mockPlatform.mockReturnValue("linux")
    mockHomedir.mockReturnValue("/home/testuser")
    process.env["XDG_CONFIG_HOME"] = "/custom/config"

    const paths = getRuntimePaths()

    expect(paths.config).toBe(join("/custom/config", "edith"))
  })

  it("returns AppData-based paths on Windows", () => {
    mockPlatform.mockReturnValue("win32")
    mockHomedir.mockReturnValue("C:\\Users\\test")
    process.env["APPDATA"] = "C:\\Users\\test\\AppData\\Roaming"
    process.env["LOCALAPPDATA"] = "C:\\Users\\test\\AppData\\Local"

    const paths = getRuntimePaths()

    expect(paths.config).toBe(join("C:\\Users\\test\\AppData\\Roaming", "edith"))
    expect(paths.data).toBe(join("C:\\Users\\test\\AppData\\Local", "edith", "data"))
    expect(paths.logs).toBe(join("C:\\Users\\test\\AppData\\Local", "edith", "logs"))
    expect(paths.cache).toBe(join("C:\\Users\\test\\AppData\\Local", "edith", "cache"))
  })

  it("returns Library-based paths on macOS", () => {
    mockPlatform.mockReturnValue("darwin")
    mockHomedir.mockReturnValue("/Users/testuser")

    const paths = getRuntimePaths()

    expect(paths.config).toBe(join("/Users/testuser", "Library", "Application Support", "edith"))
    expect(paths.logs).toBe(join("/Users/testuser", "Library", "Logs", "edith"))
    expect(paths.cache).toBe(join("/Users/testuser", "Library", "Caches", "edith"))
  })

  it("always returns all four path fields", () => {
    for (const os of ["linux", "win32", "darwin"] as const) {
      mockPlatform.mockReturnValue(os)
      const paths = getRuntimePaths()
      expect(paths).toHaveProperty("config")
      expect(paths).toHaveProperty("data")
      expect(paths).toHaveProperty("logs")
      expect(paths).toHaveProperty("cache")
    }
  })
})

describe("getLegacyEdithDir", () => {
  it("returns ~/.edith path", () => {
    mockHomedir.mockReturnValue("/home/testuser")

    expect(getLegacyEdithDir()).toBe(join("/home/testuser", ".edith"))
  })
})
