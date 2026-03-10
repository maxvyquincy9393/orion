/**
 * @file runtime-paths.ts
 * @description Provides platform-aware runtime paths for EDITH config, data,
 *   logs, cache, and legacy directory locations.
 *
 * ARCHITECTURE / INTEGRATION:
 *   Used by daemon, CLI onboard, and any module that needs consistent
 *   XDG / platform-standard directory resolution.
 */

import { homedir, platform } from "node:os"
import { join } from "node:path"

/** All resolved runtime directories for an EDITH installation. */
export interface RuntimePaths {
  /** Primary config directory (config files, edith.json). */
  config: string
  /** Data directory (databases, workspace files). */
  data: string
  /** Log directory. */
  logs: string
  /** Cache directory (embeddings, model downloads). */
  cache: string
}

const APP_NAME = "edith"

/**
 * Resolves platform-aware runtime paths following XDG conventions on Linux,
 * standard locations on macOS/Windows.
 *
 * @returns RuntimePaths with config, data, logs, and cache directories.
 */
export function getRuntimePaths(): RuntimePaths {
  const home = homedir()
  const os = platform()

  if (os === "win32") {
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming")
    const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local")
    return {
      config: join(appData, APP_NAME),
      data: join(localAppData, APP_NAME, "data"),
      logs: join(localAppData, APP_NAME, "logs"),
      cache: join(localAppData, APP_NAME, "cache"),
    }
  }

  if (os === "darwin") {
    return {
      config: join(home, "Library", "Application Support", APP_NAME),
      data: join(home, "Library", "Application Support", APP_NAME, "data"),
      logs: join(home, "Library", "Logs", APP_NAME),
      cache: join(home, "Library", "Caches", APP_NAME),
    }
  }

  // Linux / other: follow XDG Base Directory Specification
  const xdgConfig = process.env["XDG_CONFIG_HOME"] ?? join(home, ".config")
  const xdgData = process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share")
  const xdgCache = process.env["XDG_CACHE_HOME"] ?? join(home, ".cache")
  const xdgState = process.env["XDG_STATE_HOME"] ?? join(home, ".local", "state")

  return {
    config: join(xdgConfig, APP_NAME),
    data: join(xdgData, APP_NAME),
    logs: join(xdgState, APP_NAME, "logs"),
    cache: join(xdgCache, APP_NAME),
  }
}

/**
 * Returns the legacy EDITH config directory path (~/.edith).
 * Used for migration detection — if this directory exists, the user may
 * have data from a previous EDITH version.
 *
 * @returns Absolute path to the legacy directory.
 */
export function getLegacyEdithDir(): string {
  return join(homedir(), ".edith")
}
