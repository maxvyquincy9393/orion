import fs from "node:fs"
import path from "node:path"

const DEFAULT_STATE_DIR = ".edith"

function asTrimmedString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolvePersistenceEnabled(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") {
    return explicit
  }

  const env = asTrimmedString(process.env.EDITH_MEMORY_PERSIST)
  if (env) {
    const normalized = env.toLowerCase()
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false
    }
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true
    }
  }

  return process.env.NODE_ENV !== "test"
}

export function resolveStateDir(explicitStateDir?: string): string {
  const envStateDir = asTrimmedString(process.env.EDITH_STATE_DIR)
  const selected = asTrimmedString(explicitStateDir) ?? envStateDir ?? DEFAULT_STATE_DIR
  return path.resolve(selected)
}

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null
  }

  const raw = fs.readFileSync(filePath, "utf-8")
  if (raw.trim().length === 0) {
    return null
  }

  return JSON.parse(raw) as T
}

export function writeJsonAtomic(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf-8")
  fs.renameSync(tmpPath, filePath)
}

export function safeFileToken(input: string): string {
  const normalized = input
    .trim()
    .replace(/[^a-z0-9_.-]/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  if (normalized.length === 0) {
    return "default"
  }

  return normalized.slice(0, 120)
}
