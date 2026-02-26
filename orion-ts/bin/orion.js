#!/usr/bin/env node

import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import net from "node:net"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const CLI_CONFIG_DIR_NAME = ".orion"
const CLI_CONFIG_FILE_NAME = "cli.json"
const CLI_PROFILES_DIR_NAME = "profiles"
const DEFAULT_PROFILE_NAME = "default"
const DEV_PROFILE_NAME = "dev"
const LOCAL_PACKAGE_NAME = "orion"
const SUPPORTED_CHANNELS = ["telegram", "discord", "whatsapp", "webchat"]

function testIcon(level) {
  if (level === "ok") return "OK"
  if (level === "warn") return "WARN"
  return "ERR"
}

function countCommaSeparatedValues(value) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) {
    return 0
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean).length
}

export function getPnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm"
}

export function shouldUseShellForCommand(command, platform = process.platform) {
  if (platform !== "win32") {
    return false
  }
  return /\.(cmd|bat)$/i.test(String(command ?? "").trim())
}

function printHelp() {
  console.log("Orion CLI (OpenClaw-style wrapper)")
  console.log("==================================")
  console.log("")
  console.log("Usage:")
  console.log("  orion                           Smart entrypoint (first-run: launches setup wizard)")
  console.log("  orion link <path-to-orion-ts>     Link your Orion repo once")
  console.log("  orion repo                        Show linked repo path")
  console.log("  orion profile                     Show active profile path")
  console.log("  orion profile init                Create ~/.orion profile files (env/workspace/state)")
  console.log("  orion setup                       OpenClaw-style setup alias (quickstart wizard)")
  console.log("  orion init                        Bootstrap profile + run quickstart wizard")
  console.log("  orion quickstart                  Run onboarding wizard")
  console.log("  orion configure                   Re-run onboarding wizard (configure alias)")
  console.log("  orion dashboard                   Start gateway and print dashboard URL")
  console.log("  orion status                      Readiness/status check (self-test alias)")
  console.log("  orion logs [all|gateway]          Stream live logs by starting a target mode")
  console.log("  orion channels login ...          OpenClaw-style channel login namespace (WhatsApp QR / Cloud)")
  console.log("  orion channels status [--channel] Channel readiness/status alias")
  console.log("  orion channels logs [--channel]   Channel log entrypoint (live logs fallback)")
  console.log("  orion self-test                   Check repo/profile/env readiness (beginner-friendly)")
  console.log("  orion wa scan                     WhatsApp QR setup (OpenClaw-style)")
  console.log("  orion wa cloud                    WhatsApp Cloud API setup")
  console.log("  orion all                         Start Orion (gateway + channels + CLI)")
  console.log("  orion gateway                     Start gateway mode")
  console.log("  orion doctor                      Run doctor checks")
  console.log("  orion onboard -- <args>           Pass raw args to onboard CLI")
  console.log("")
  console.log("Options:")
  console.log("  --repo <path>                     Override linked repo for this command")
  console.log("  --profile <name|path>             Use a named profile (~/.orion/profiles/<name>) or an explicit path")
  console.log("  --dev                             Use isolated dev profile (~/.orion/profiles/dev)")
  console.log("  --help, -h                        Show help")
  console.log("")
  console.log("Examples:")
  console.log("  orion link C:\\Users\\you\\orion\\orion-ts")
  console.log("  orion profile init")
  console.log("  orion --profile work wa scan --yes --provider groq")
  console.log("  orion channels login --channel whatsapp --non-interactive --provider groq")
  console.log("  orion --dev dashboard")
  console.log("  orion wa scan")
  console.log("  orion all")
}

function normalizePathInput(value) {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().replace(/^"(.*)"$/, "$1")
  return trimmed || null
}

export function shouldInvokeCli(importMetaUrl, argv1, platform = process.platform) {
  if (!argv1) {
    return false
  }

  const importPath = path.resolve(fileURLToPath(importMetaUrl))
  const invokedPath = path.resolve(argv1)

  let normalizedImport = importPath
  let normalizedInvoked = invokedPath

  try {
    normalizedImport = fsSync.realpathSync.native
      ? fsSync.realpathSync.native(importPath)
      : fsSync.realpathSync(importPath)
  } catch {
    normalizedImport = importPath
  }

  try {
    normalizedInvoked = fsSync.realpathSync.native
      ? fsSync.realpathSync.native(invokedPath)
      : fsSync.realpathSync(invokedPath)
  } catch {
    normalizedInvoked = invokedPath
  }

  if (platform === "win32") {
    if (normalizedImport.toLowerCase() === normalizedInvoked.toLowerCase()) {
      return true
    }
  } else if (normalizedImport === normalizedInvoked) {
    return true
  }

  // Fallback for npm shim / symlink edge cases where the invoked path resolves differently
  // but the process was clearly launched with this script filename.
  return path.basename(normalizedImport).toLowerCase() === path.basename(normalizedInvoked).toLowerCase()
}

export function getCliConfigDir() {
  return path.join(os.homedir(), CLI_CONFIG_DIR_NAME)
}

export function getCliConfigPath() {
  return path.join(getCliConfigDir(), CLI_CONFIG_FILE_NAME)
}

export function getProfilesRootDir() {
  return path.join(getCliConfigDir(), CLI_PROFILES_DIR_NAME)
}

export function getDefaultProfileDir() {
  return path.join(getProfilesRootDir(), DEFAULT_PROFILE_NAME)
}

export function getNamedProfileDir(profileName) {
  return path.join(getProfilesRootDir(), profileName)
}

export function isLikelyProfileName(value) {
  const normalized = normalizePathInput(value)
  if (!normalized) {
    return false
  }

  if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return false
  }
  if (normalized.startsWith(".") || normalized.startsWith("/") || normalized.startsWith("\\\\")) {
    return false
  }
  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    return false
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    return false
  }
  return true
}

export function resolveProfileSelector(profileSelector, cwd = process.cwd(), homeDir = os.homedir()) {
  const normalized = normalizePathInput(profileSelector)
  if (!normalized) {
    return null
  }

  if (isLikelyProfileName(normalized)) {
    return path.join(homeDir, CLI_CONFIG_DIR_NAME, CLI_PROFILES_DIR_NAME, normalized)
  }

  if (normalized === "~") {
    return homeDir
  }
  if (normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    return path.join(homeDir, normalized.slice(2))
  }
  return path.resolve(cwd, normalized)
}

export function normalizeChannelName(value) {
  const normalized = normalizePathInput(value)?.toLowerCase() ?? null
  if (!normalized) {
    return null
  }
  return SUPPORTED_CHANNELS.includes(normalized) ? normalized : null
}

export function normalizeWhatsAppLoginMode(value) {
  const normalized = normalizePathInput(value)?.toLowerCase() ?? null
  if (!normalized) {
    return "scan"
  }
  if (["scan", "qr", "baileys"].includes(normalized)) {
    return "scan"
  }
  if (normalized === "cloud") {
    return "cloud"
  }
  return null
}

export function parseChannelsArgs(argv) {
  const args = [...argv]
  let channel = null
  let mode = null
  let help = false
  let json = false
  const positionals = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--channel" && args[i + 1]) {
      const next = normalizeChannelName(args[i + 1])
      if (!next) {
        throw new Error(`Invalid --channel '${args[i + 1]}'`)
      }
      channel = next
      i += 1
      continue
    }
    if (arg.startsWith("--channel=")) {
      const next = normalizeChannelName(arg.slice("--channel=".length))
      if (!next) {
        throw new Error(`Invalid --channel '${arg.slice("--channel=".length)}'`)
      }
      channel = next
      continue
    }
    if (arg === "--mode" && args[i + 1]) {
      mode = normalizePathInput(args[i + 1])?.toLowerCase() ?? null
      i += 1
      continue
    }
    if (arg.startsWith("--mode=")) {
      mode = normalizePathInput(arg.slice("--mode=".length))?.toLowerCase() ?? null
      continue
    }
    positionals.push(arg)
  }

  return { channel, mode, positionals, help, json }
}

export function parseSelfTestArgs(argv) {
  const args = [...argv]
  let fix = false
  let migrate = false
  let help = false
  let json = false
  const positionals = []

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }
    if (arg === "--fix") {
      fix = true
      continue
    }
    if (arg === "--migrate") {
      migrate = true
      continue
    }
    if (arg === "--json") {
      json = true
      continue
    }
    positionals.push(arg)
  }

  return { fix, migrate, help, json, positionals }
}

export function parseDashboardArgs(argv) {
  const args = [...argv]
  let open = false
  let help = false
  const positionals = []

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true
      continue
    }
    if (arg === "--open") {
      open = true
      continue
    }
    if (arg === "--no-open") {
      open = false
      continue
    }
    positionals.push(arg)
  }

  return { open, help, positionals }
}

export function parseOrionCliArgs(argv) {
  const args = [...argv]
  let repoOverride = null
  let profileOverride = null
  let dev = false
  const positionals = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      if (positionals.length === 0) {
        return { repoOverride: null, profileOverride: null, dev: false, positionals: [], help: true }
      }
      positionals.push(arg)
      continue
    }
    if (arg === "--repo" && args[i + 1]) {
      repoOverride = normalizePathInput(args[i + 1])
      i += 1
      continue
    }
    if (arg.startsWith("--repo=")) {
      repoOverride = normalizePathInput(arg.slice("--repo=".length))
      continue
    }
    if (arg === "--profile" && args[i + 1]) {
      profileOverride = normalizePathInput(args[i + 1])
      i += 1
      continue
    }
    if (arg.startsWith("--profile=")) {
      profileOverride = normalizePathInput(arg.slice("--profile=".length))
      continue
    }
    if (arg === "--dev") {
      dev = true
      continue
    }
    positionals.push(arg)
  }

  return { repoOverride, profileOverride, dev, positionals, help: false }
}

export async function loadCliConfig(fsModule = fs) {
  try {
    const raw = await fsModule.readFile(getCliConfigPath(), "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

export async function saveCliConfig(config, fsModule = fs) {
  await fsModule.mkdir(getCliConfigDir(), { recursive: true })
  const content = `${JSON.stringify(config, null, 2)}\n`
  await fsModule.writeFile(getCliConfigPath(), content, "utf-8")
}

export async function isOrionRepoDir(repoDir, fsModule = fs) {
  const packageJsonPath = path.join(repoDir, "package.json")
  try {
    const raw = await fsModule.readFile(packageJsonPath, "utf-8")
    const parsed = JSON.parse(raw)
    return parsed?.name === LOCAL_PACKAGE_NAME
  } catch {
    return false
  }
}

export async function findOrionRepoUpwards(startDir, fsModule = fs) {
  let current = path.resolve(startDir)

  while (true) {
    if (await isOrionRepoDir(current, fsModule)) {
      return current
    }

    const nestedCandidate = path.join(current, "orion-ts")
    if (await isOrionRepoDir(nestedCandidate, fsModule)) {
      return nestedCandidate
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export function getProfilePaths(profileDir) {
  const resolvedProfileDir = path.resolve(profileDir)
  return {
    profileDir: resolvedProfileDir,
    envPath: path.join(resolvedProfileDir, ".env"),
    workspaceDir: path.join(resolvedProfileDir, "workspace"),
    stateDir: path.join(resolvedProfileDir, ".orion"),
  }
}

function formatEnvLiteral(value) {
  return /[\s#]/.test(value) ? JSON.stringify(value) : value
}

function buildProfileBootstrapEnv(profilePaths) {
  const dbPath = path.join(profilePaths.profileDir, "orion.db").replaceAll("\\", "/")
  const permissionsPath = path.join(profilePaths.profileDir, "permissions", "permissions.yaml")
  return [
    "# Orion profile env (generated by `orion profile init`)",
    `DATABASE_URL=${formatEnvLiteral(`file:${dbPath}`)}`,
    `PERMISSIONS_FILE=${formatEnvLiteral(permissionsPath)}`,
    "DEFAULT_USER_ID=owner",
    "LOG_LEVEL=info",
    "",
  ].join("\n")
}

async function copyFileIfMissing(sourcePath, targetPath) {
  try {
    await fs.access(targetPath)
    return false
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error
    }
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath)
  return true
}

export async function ensureProfileBootstrap(repoDir, profileDir) {
  const paths = getProfilePaths(profileDir)
  await fs.mkdir(paths.profileDir, { recursive: true })
  await fs.mkdir(paths.workspaceDir, { recursive: true })
  await fs.mkdir(paths.stateDir, { recursive: true })

  const repoPermissionsPath = path.join(repoDir, "permissions", "permissions.yaml")
  const profilePermissionsPath = path.join(paths.profileDir, "permissions", "permissions.yaml")

  try {
    await copyFileIfMissing(repoPermissionsPath, profilePermissionsPath)
  } catch {
    // Permissions template may not exist in some dev checkouts. The app will surface it in doctor/startup.
  }

  try {
    await fs.access(paths.envPath)
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error
    }

    const repoEnvExample = path.join(repoDir, ".env.example")
    let baseContent = ""
    try {
      baseContent = await fs.readFile(repoEnvExample, "utf-8")
    } catch {
      baseContent = ""
    }

    const generated = [
      baseContent.replace(/\r\n/g, "\n").replace(/\n+$/g, ""),
      baseContent.trim().length > 0 ? "" : "",
      buildProfileBootstrapEnv(paths).trim(),
      "",
    ].join("\n").replace(/\n{3,}/g, "\n\n")

    await fs.writeFile(paths.envPath, generated, "utf-8")
  }

  return paths
}

function buildOrionChildEnv(parentEnv, profileDir) {
  const paths = getProfilePaths(profileDir)
  return {
    ...parentEnv,
    ORION_PROFILE_DIR: paths.profileDir,
    ORION_ENV_FILE: paths.envPath,
    ORION_WORKSPACE: paths.workspaceDir,
    ORION_STATE_DIR: paths.stateDir,
  }
}

export function parseEnvContentLoose(content) {
  const out = {}
  const normalized = String(content ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/^\uFEFF/, "").trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) {
      continue
    }

    const [, key, valueRaw] = match
    let value = valueRaw
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }

  return out
}

function isTruthyEnv(value) {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function boolToEnvString(value) {
  return value ? "true" : "false"
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function runChildCapture(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: shouldUseShellForCommand(command),
    ...options,
  })

  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk)
  })
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk)
  })

  return await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`))
        return
      }
      resolve({ code: code ?? 0, stdout, stderr })
    })
  })
}

export function buildWhatsAppSelfTestChecks(envMap, profilePaths) {
  const checks = []
  const enabled = isTruthyEnv(envMap.WHATSAPP_ENABLED ?? "")
  const mode = (envMap.WHATSAPP_MODE ?? "baileys").trim().toLowerCase()

  if (!enabled) {
    checks.push({
      level: "warn",
      label: "WhatsApp",
      detail: "Disabled (set WHATSAPP_ENABLED=true to use WhatsApp)",
    })
    return checks
  }

  if (mode !== "baileys" && mode !== "cloud") {
    checks.push({
      level: "error",
      label: "WhatsApp Mode",
      detail: `Invalid WHATSAPP_MODE='${mode || "(empty)"}' (expected 'baileys' or 'cloud')`,
    })
    return checks
  }

  checks.push({
    level: "ok",
    label: "WhatsApp Mode",
    detail: mode === "baileys" ? "QR Scan (Baileys)" : "Cloud API",
  })

  if (mode === "baileys") {
    const authDir = path.join(profilePaths.stateDir, "whatsapp-auth")
    checks.push({
      level: "ok",
      label: "WhatsApp Auth State",
      detail: `Will use profile-scoped auth dir: ${authDir}`,
    })
    return checks
  }

  const requiredCloudKeys = [
    "WHATSAPP_CLOUD_ACCESS_TOKEN",
    "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
    "WHATSAPP_CLOUD_VERIFY_TOKEN",
  ]

  const missing = requiredCloudKeys.filter((key) => !(envMap[key] ?? "").trim())
  if (missing.length > 0) {
    checks.push({
      level: "error",
      label: "WhatsApp Cloud Config",
      detail: `Missing: ${missing.join(", ")}`,
    })
  } else {
    checks.push({
      level: "ok",
      label: "WhatsApp Cloud Config",
      detail: "Access token, phone number ID, and verify token are set",
    })
  }

  return checks
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

function asRecordObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value
}

function maskMiddleToken(value) {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) {
    return null
  }
  if (raw.length <= 2) {
    return `${raw[0] ?? "*"}*`
  }
  if (raw.length <= 6) {
    return `${raw.slice(0, 1)}***${raw.slice(-1)}`
  }
  return `${raw.slice(0, 3)}***${raw.slice(-2)}`
}

function maskWhatsAppJid(jid) {
  const raw = typeof jid === "string" ? jid.trim() : ""
  if (!raw) {
    return null
  }
  const atIndex = raw.indexOf("@")
  const localPart = atIndex >= 0 ? raw.slice(0, atIndex) : raw
  const domainPart = atIndex >= 0 ? raw.slice(atIndex + 1) : ""
  const [primaryId, ...deviceParts] = localPart.split(":")
  const maskedPrimary = maskMiddleToken(primaryId) ?? "***"
  const maskedLocal = deviceParts.length > 0
    ? [maskedPrimary, ...deviceParts].join(":")
    : maskedPrimary
  return domainPart ? `${maskedLocal}@${domainPart}` : maskedLocal
}

function formatStatusTimestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return null
  }
  return value.toISOString()
}

export function summarizeTelegramBotToken(token) {
  const raw = typeof token === "string" ? token.trim() : ""
  if (!raw) {
    return {
      configured: false,
      formatLikelyValid: false,
      preview: null,
    }
  }
  return {
    configured: true,
    formatLikelyValid: /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(raw),
    preview: maskMiddleToken(raw),
  }
}

export function summarizeDiscordBotToken(token) {
  const raw = typeof token === "string" ? token.trim() : ""
  if (!raw) {
    return {
      configured: false,
      formatLikelyValid: false,
      preview: null,
    }
  }
  // Discord bot tokens vary in shape/length over time; this is a loose sanity check only.
  const hasNoWhitespace = !/\s/.test(raw)
  const likelySegmented = raw.split(".").filter(Boolean).length >= 2
  const likelyLength = raw.length >= 30
  return {
    configured: true,
    formatLikelyValid: hasNoWhitespace && likelyLength && likelySegmented,
    preview: maskMiddleToken(raw),
  }
}

export async function probeLocalTcpPort(port, options = {}) {
  const host = typeof options.host === "string" && options.host.trim() ? options.host.trim() : "127.0.0.1"
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 400
  const startedAt = Date.now()

  return await new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (payload) => {
      if (settled) {
        return
      }
      settled = true
      try {
        socket.destroy()
      } catch {
        // no-op
      }
      resolve(payload)
    }

    socket.setTimeout(timeoutMs)
    socket.once("connect", () => {
      finish({
        reachable: true,
        host,
        port,
        latencyMs: Math.max(0, Date.now() - startedAt),
        error: null,
      })
    })
    socket.once("timeout", () => {
      finish({
        reachable: false,
        host,
        port,
        latencyMs: Math.max(0, Date.now() - startedAt),
        error: `timeout after ${timeoutMs}ms`,
      })
    })
    socket.once("error", (error) => {
      const message = error instanceof Error ? error.message : String(error)
      finish({
        reachable: false,
        host,
        port,
        latencyMs: Math.max(0, Date.now() - startedAt),
        error: message,
      })
    })

    socket.connect({ host, port })
  })
}

export function summarizeWhatsAppBaileysCreds(rawCreds) {
  const root = asRecordObject(rawCreds)
  if (!root) {
    return {
      parseable: false,
      paired: false,
      maskedJid: null,
      registered: null,
      hasIdentityMaterial: false,
    }
  }

  const me = asRecordObject(root.me)
  const rawJid = typeof me?.id === "string" && me.id.trim().length > 0 ? me.id.trim() : null
  const advSecretKey = typeof root.advSecretKey === "string" ? root.advSecretKey.trim() : ""
  const registrationId = typeof root.registrationId === "number" && Number.isFinite(root.registrationId)
  const noiseKey = asRecordObject(root.noiseKey)

  return {
    parseable: true,
    paired: Boolean(rawJid),
    maskedJid: rawJid ? maskWhatsAppJid(rawJid) : null,
    registered: typeof root.registered === "boolean" ? root.registered : null,
    hasIdentityMaterial: Boolean(advSecretKey || registrationId || noiseKey),
  }
}

export async function inspectWhatsAppBaileysAuthState(authDir, fsModule = fs) {
  const credsPath = path.join(authDir, "creds.json")
  const result = {
    authDir,
    exists: false,
    entryCount: 0,
    credsPath,
    credsExists: false,
    credsMtime: null,
    readError: null,
    parseError: null,
    creds: summarizeWhatsAppBaileysCreds(null),
  }

  let entries = []
  try {
    const rawEntries = await fsModule.readdir(authDir)
    entries = Array.isArray(rawEntries) ? rawEntries.map((entry) => String(entry)) : []
    result.exists = true
    result.entryCount = entries.length
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return result
    }
    result.readError = error instanceof Error ? error.message : String(error)
    return result
  }

  result.credsExists = entries.some((entry) => entry.toLowerCase() === "creds.json")
  if (!result.credsExists) {
    return result
  }

  try {
    const raw = await fsModule.readFile(credsPath, "utf-8")
    result.creds = summarizeWhatsAppBaileysCreds(JSON.parse(raw))
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error)
  }

  try {
    const stat = await fsModule.stat(credsPath)
    result.credsMtime = formatStatusTimestamp(stat?.mtime)
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      const message = error instanceof Error ? error.message : String(error)
      result.readError = result.readError ?? `Failed to stat creds.json: ${message}`
    }
  }

  return result
}

async function buildWhatsAppChannelStatusChecks(envMap, profilePaths) {
  const checks = buildWhatsAppSelfTestChecks(envMap, profilePaths)
  const enabled = isTruthyEnv(envMap.WHATSAPP_ENABLED ?? "")
  const mode = (envMap.WHATSAPP_MODE ?? "baileys").trim().toLowerCase()

  if (!enabled || (mode !== "baileys" && mode !== "cloud")) {
    return { checks, runtime: null }
  }

  if (mode === "cloud") {
    const allowlistRaw = (envMap.WHATSAPP_CLOUD_ALLOWED_WA_IDS ?? "").trim()
    const allowlistCount = allowlistRaw
      ? allowlistRaw.split(",").map((item) => item.trim()).filter(Boolean).length
      : 0
    checks.push({
      level: allowlistCount > 0 ? "ok" : "warn",
      label: "WhatsApp Cloud Allowlist",
      detail: allowlistCount > 0
        ? `${allowlistCount} allowed sender(s) configured`
        : "No WHATSAPP_CLOUD_ALLOWED_WA_IDS set (inbound access is open to senders who can message the business number)",
    })
    return {
      checks,
      runtime: {
        mode: "cloud",
        allowlistConfigured: allowlistCount > 0,
        allowlistCount,
      },
    }
  }

  const authDir = path.join(profilePaths.stateDir, "whatsapp-auth")
  const auth = await inspectWhatsAppBaileysAuthState(authDir)

  if (auth.readError) {
    checks.push({
      level: "error",
      label: "WhatsApp Auth Runtime",
      detail: `Failed to inspect auth state dir: ${auth.readError}`,
    })
  } else if (!auth.exists) {
    checks.push({
      level: "warn",
      label: "WhatsApp Session",
      detail: "Auth state dir does not exist yet (start `orion all` to generate QR login state)",
    })
  } else {
    checks.push({
      level: "ok",
      label: "WhatsApp Auth Files",
      detail: `${auth.entryCount} file(s) found in auth state dir`,
    })

    if (!auth.credsExists) {
      checks.push({
        level: "warn",
        label: "WhatsApp Session",
        detail: "Auth dir exists but creds.json is missing (run `orion all` and scan QR, or clear stale auth dir)",
      })
    } else if (auth.parseError) {
      checks.push({
        level: "error",
        label: "WhatsApp Session",
        detail: `creds.json is unreadable (${auth.parseError})`,
      })
    } else if (auth.creds.paired) {
      const identity = auth.creds.maskedJid ? ` as ${auth.creds.maskedJid}` : ""
      const updated = auth.credsMtime ? ` (creds updated ${auth.credsMtime})` : ""
      checks.push({
        level: "ok",
        label: "WhatsApp Session",
        detail: `Paired session detected${identity}${updated}`,
      })
    } else {
      checks.push({
        level: "warn",
        label: "WhatsApp Session",
        detail: auth.creds.hasIdentityMaterial
          ? "Auth keys exist but account is not paired yet (start `orion all` and scan QR)"
          : "No usable WhatsApp credentials yet (start `orion all` and scan QR)",
      })
    }
  }

  return {
    checks,
    runtime: {
      mode: "baileys",
      auth: {
        authDir: auth.authDir,
        exists: auth.exists,
        entryCount: auth.entryCount,
        credsExists: auth.credsExists,
        credsMtime: auth.credsMtime,
        readError: auth.readError,
        parseError: auth.parseError,
        paired: auth.creds.paired,
        maskedJid: auth.creds.maskedJid,
        registered: auth.creds.registered,
        hasIdentityMaterial: auth.creds.hasIdentityMaterial,
      },
    },
  }
}

function buildTelegramChannelStatusChecks(envMap) {
  const checks = buildTelegramSelfTestChecks(envMap)
  const token = summarizeTelegramBotToken(envMap.TELEGRAM_BOT_TOKEN ?? "")
  if (!token.configured) {
    return { checks, runtime: null }
  }

  const allowlistCount = countCommaSeparatedValues(envMap.TELEGRAM_CHAT_ID ?? "")
  checks.push({
    level: token.formatLikelyValid ? "ok" : "warn",
    label: "Telegram Token Format",
    detail: token.formatLikelyValid
      ? `Looks like a Bot API token (${token.preview})`
      : `Token is set but format looks unusual (${token.preview ?? "hidden"})`,
  })

  return {
    checks,
    runtime: {
      mode: "bot-api",
      tokenConfigured: true,
      tokenFormatLikelyValid: token.formatLikelyValid,
      tokenPreview: token.preview,
      allowlistConfigured: allowlistCount > 0,
      allowlistCount,
    },
  }
}

function buildDiscordChannelStatusChecks(envMap) {
  const checks = buildDiscordSelfTestChecks(envMap)
  const token = summarizeDiscordBotToken(envMap.DISCORD_BOT_TOKEN ?? "")
  if (!token.configured) {
    return { checks, runtime: null }
  }

  const allowlistCount = countCommaSeparatedValues(envMap.DISCORD_CHANNEL_ID ?? "")
  checks.push({
    level: token.formatLikelyValid ? "ok" : "warn",
    label: "Discord Token Format",
    detail: token.formatLikelyValid
      ? `Token format looks plausible (${token.preview})`
      : `Token is set but format looks unusual (${token.preview ?? "hidden"})`,
  })

  return {
    checks,
    runtime: {
      mode: "bot-token",
      tokenConfigured: true,
      tokenFormatLikelyValid: token.formatLikelyValid,
      tokenPreview: token.preview,
      allowlistConfigured: allowlistCount > 0,
      allowlistCount,
    },
  }
}

function resolveWebchatPort(envMap) {
  const rawPort = (envMap.WEBCHAT_PORT ?? "").trim()
  const parsed = Number.parseInt(rawPort, 10)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 8080
}

async function buildWebchatChannelStatusChecks(envMap) {
  const checks = buildWebchatSelfTestChecks(envMap)
  const port = resolveWebchatPort(envMap)
  const probe = await probeLocalTcpPort(port, { host: "127.0.0.1", timeoutMs: 350 })
  const url = `http://127.0.0.1:${port}`

  checks.push({
    level: probe.reachable ? "ok" : "warn",
    label: "WebChat Reachability",
    detail: probe.reachable
      ? `Local listener detected at ${url} (${probe.latencyMs}ms)`
      : `No local listener detected at ${url} (${probe.error ?? "unreachable"})`,
  })

  return {
    checks,
    runtime: {
      mode: "local-web",
      url,
      probe: {
        reachable: probe.reachable,
        host: probe.host,
        port: probe.port,
        latencyMs: probe.latencyMs,
        error: probe.error,
      },
    },
  }
}

export function buildTelegramSelfTestChecks(envMap) {
  const checks = []
  const botToken = (envMap.TELEGRAM_BOT_TOKEN ?? "").trim()
  const allowlist = (envMap.TELEGRAM_CHAT_ID ?? "").trim()
  if (!botToken) {
    checks.push({
      level: "warn",
      label: "Telegram Bot",
      detail: "Disabled (set TELEGRAM_BOT_TOKEN to enable Telegram)",
    })
    return checks
  }

  checks.push({
    level: "ok",
    label: "Telegram Bot",
    detail: "TELEGRAM_BOT_TOKEN is configured",
  })
  checks.push({
    level: allowlist ? "ok" : "warn",
    label: "Telegram Allowlist",
    detail: allowlist
      ? "TELEGRAM_CHAT_ID is configured (allowlisted chats/groups)"
      : "No TELEGRAM_CHAT_ID set (private chats only by default)",
  })
  return checks
}

export function buildDiscordSelfTestChecks(envMap) {
  const checks = []
  const botToken = (envMap.DISCORD_BOT_TOKEN ?? "").trim()
  const allowlist = (envMap.DISCORD_CHANNEL_ID ?? "").trim()
  if (!botToken) {
    checks.push({
      level: "warn",
      label: "Discord Bot",
      detail: "Disabled (set DISCORD_BOT_TOKEN to enable Discord)",
    })
    return checks
  }

  checks.push({
    level: "ok",
    label: "Discord Bot",
    detail: "DISCORD_BOT_TOKEN is configured",
  })
  checks.push({
    level: allowlist ? "ok" : "warn",
    label: "Discord Allowlist",
    detail: allowlist
      ? "DISCORD_CHANNEL_ID is configured (allowlisted guild channels)"
      : "No DISCORD_CHANNEL_ID set (DMs only by default)",
  })
  return checks
}

export function buildWebchatSelfTestChecks(envMap) {
  const rawPort = (envMap.WEBCHAT_PORT ?? "").trim()
  const parsed = Number.parseInt(rawPort, 10)
  const port = Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 8080
  return [{
    level: "ok",
    label: "WebChat",
    detail: `WebChat available on http://127.0.0.1:${port} (when Orion is running)`,
  }]
}

export function isProfileEnvLikelyConfigured(envMap) {
  const providerKeys = [
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
  ]
  if (providerKeys.some((key) => (envMap[key] ?? "").trim().length > 0)) {
    return true
  }

  if (isTruthyEnv(envMap.WHATSAPP_ENABLED ?? "")) {
    return true
  }
  if ((envMap.TELEGRAM_BOT_TOKEN ?? "").trim()) {
    return true
  }
  if ((envMap.DISCORD_BOT_TOKEN ?? "").trim()) {
    return true
  }

  return false
}

function buildDefaultPermissionsTemplate() {
  return [
    "# Orion permissions template (generated by `orion self-test --fix`)",
    "# Review and tighten before broader use.",
    "messaging:",
    "  enabled: true",
    "proactive:",
    "  enabled: true",
    "  require_confirm: true",
    "file_system:",
    "  enabled: true",
    "  read: true",
    "  write: true",
    "  require_confirm: true",
    "terminal:",
    "  enabled: true",
    "  require_confirm: true",
    "calendar:",
    "  enabled: false",
    "search:",
    "  enabled: true",
    "browsing:",
    "  enabled: true",
    "",
  ].join("\n")
}

function buildProfileBootstrapEnvMap(profilePaths) {
  return {
    DATABASE_URL: `file:${path.join(profilePaths.profileDir, "orion.db").replaceAll("\\", "/")}`,
    PERMISSIONS_FILE: path.join(profilePaths.profileDir, "permissions", "permissions.yaml"),
    DEFAULT_USER_ID: "owner",
    LOG_LEVEL: "info",
  }
}

function mergeMissingEnvKeys(baseContent, updates, sourceLabel = "orion self-test --fix") {
  const normalizedBase = String(baseContent ?? "").replace(/\r\n/g, "\n")
  const lines = normalizedBase.split("\n")
  const present = new Set()
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (match) {
      present.add(match[1])
    }
  }

  const missingEntries = Object.entries(updates).filter(([key, value]) => !present.has(key) && value != null)
  if (missingEntries.length === 0) {
    return { content: normalizedBase.endsWith("\n") ? normalizedBase : `${normalizedBase}\n`, changed: false }
  }

  const out = [...lines]
  if (out.length > 0 && out[out.length - 1] !== "") {
    out.push("")
  }
  out.push(`# Added by \`${sourceLabel}\``)
  for (const [key, value] of missingEntries) {
    out.push(`${key}=${/[\s#]/.test(String(value)) ? JSON.stringify(String(value)) : String(value)}`)
  }
  return { content: `${out.join("\n").replace(/\n+$/g, "")}\n`, changed: true }
}

async function applySelfTestFixes(repoDir, profileDir) {
  const profilePaths = await ensureProfileBootstrap(repoDir, profileDir)
  const fixes = []

  const permissionsPath = path.join(profilePaths.profileDir, "permissions", "permissions.yaml")
  if (!(await pathExists(permissionsPath))) {
    await fs.mkdir(path.dirname(permissionsPath), { recursive: true })
    await fs.writeFile(permissionsPath, buildDefaultPermissionsTemplate(), "utf-8")
    fixes.push(`Created ${permissionsPath}`)
  }

  let envRaw = ""
  try {
    envRaw = await fs.readFile(profilePaths.envPath, "utf-8")
  } catch {
    envRaw = ""
  }
  const envMap = parseEnvContentLoose(envRaw)
  const bootstrapDefaults = buildProfileBootstrapEnvMap(profilePaths)
  const envUpdates = { ...bootstrapDefaults }

  if ((envMap.WHATSAPP_ENABLED ?? "").trim().toLowerCase() === "true") {
    const waMode = (envMap.WHATSAPP_MODE ?? "baileys").trim().toLowerCase()
    if (waMode === "cloud" && !(envMap.AUTO_START_GATEWAY ?? "").trim()) {
      envUpdates.AUTO_START_GATEWAY = "true"
    }
  }

  const merged = mergeMissingEnvKeys(envRaw, envUpdates)
  if (merged.changed) {
    await fs.writeFile(profilePaths.envPath, merged.content, "utf-8")
    const addedKeys = Object.keys(envUpdates).filter((key) => !(envMap[key] ?? "").trim())
    if (addedKeys.length > 0) {
      fixes.push(`Updated ${profilePaths.envPath} (added: ${addedKeys.join(", ")})`)
    }
  }

  return { profilePaths, fixes }
}

function printSelfTestHelp() {
  console.log("Orion Self-Test")
  console.log("===============")
  console.log("")
  console.log("Usage:")
  console.log("  orion self-test [--fix] [--migrate] [--json]")
  console.log("  orion status [--fix] [--migrate] [--json]")
  console.log("")
  console.log("Options:")
  console.log("  --fix   Apply safe local fixes (profile bootstrap, permissions template, env baseline keys)")
  console.log("  --migrate   Run profile DB migration preflight (`prisma migrate deploy`) after fixes/checks")
  console.log("  --json   Print machine-readable JSON output")
}

async function collectSelfTestChecks(repoDir, profileDir) {
  const checks = []
  const profilePaths = await ensureProfileBootstrap(repoDir, profileDir)
  const envExists = await pathExists(profilePaths.envPath)
  const workspaceExists = await pathExists(profilePaths.workspaceDir)
  const stateExists = await pathExists(profilePaths.stateDir)
  const permissionsExists = await pathExists(path.join(profilePaths.profileDir, "permissions", "permissions.yaml"))

  checks.push({
    level: "ok",
    label: "Repo",
    detail: repoDir,
  })
  checks.push({
    level: "ok",
    label: "Profile",
    detail: profilePaths.profileDir,
  })
  checks.push({
    level: envExists ? "ok" : "error",
    label: "Profile Env",
    detail: envExists ? `Found ${profilePaths.envPath}` : `Missing ${profilePaths.envPath}`,
  })
  checks.push({
    level: workspaceExists ? "ok" : "error",
    label: "Workspace",
    detail: workspaceExists ? `Found ${profilePaths.workspaceDir}` : `Missing ${profilePaths.workspaceDir}`,
  })
  checks.push({
    level: stateExists ? "ok" : "error",
    label: "State Dir",
    detail: stateExists ? `Found ${profilePaths.stateDir}` : `Missing ${profilePaths.stateDir}`,
  })
  checks.push({
    level: permissionsExists ? "ok" : "warn",
    label: "Permissions",
    detail: permissionsExists
      ? "Profile permissions template is present"
      : "Profile permissions file is missing (doctor/startup may fail until created)",
  })

  let envMap = {}
  if (envExists) {
    const raw = await fs.readFile(profilePaths.envPath, "utf-8")
    envMap = parseEnvContentLoose(raw)
  }

  const providerKeys = [
    "GROQ_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
  ]
  const providerConfigured = providerKeys.some((key) => (envMap[key] ?? "").trim().length > 0)
  const ollamaConfigured = (envMap.OLLAMA_BASE_URL ?? "").trim().length > 0
  checks.push({
    level: providerConfigured || ollamaConfigured ? "ok" : "warn",
    label: "Model Provider",
    detail: providerConfigured || ollamaConfigured
      ? "At least one provider or OLLAMA_BASE_URL is configured"
      : "No provider key found (wizard can still set this)",
  })

  const autoGateway = isTruthyEnv(envMap.AUTO_START_GATEWAY ?? "")
  checks.push({
    level: autoGateway ? "ok" : "warn",
    label: "AUTO_START_GATEWAY",
    detail: autoGateway
      ? "Enabled for `pnpm dev`"
      : "Disabled (fine for `orion all`; required if you expect `pnpm dev` to start gateway automatically)",
  })

  checks.push(...buildWhatsAppSelfTestChecks(envMap, profilePaths))

  try {
    const pnpm = await runChildCapture(getPnpmCommand(), ["--version"])
    checks.push({
      level: pnpm.code === 0 ? "ok" : "error",
      label: "pnpm",
      detail: pnpm.code === 0
        ? `Detected ${pnpm.stdout.trim() || pnpm.stderr.trim() || "installed"}`
        : `pnpm failed (exit ${pnpm.code})`,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const hint = /enoent/i.test(errorMessage)
      ? " (install pnpm and reopen terminal so PATH refreshes)"
      : ""
    checks.push({
      level: "error",
      label: "pnpm",
      detail: `Not available on PATH: ${errorMessage}${hint}`,
    })
  }

  checks.push({
    level: "ok",
    label: "Node",
    detail: process.version,
  })

  return { checks, profilePaths }
}

async function loadProfileEnvMap(profileDir) {
  const profilePaths = getProfilePaths(profileDir)
  let envMap = {}
  try {
    const raw = await fs.readFile(profilePaths.envPath, "utf-8")
    envMap = parseEnvContentLoose(raw)
  } catch {
    envMap = {}
  }
  return { profilePaths, envMap }
}

function summarizeMigrateOutput(stdout, stderr) {
  const combined = `${stdout ?? ""}\n${stderr ?? ""}`
  if (/No pending migrations/i.test(combined)) {
    return "Profile DB schema is up to date."
  }
  if (/Applying migration|migrations found|The following migration/i.test(combined)) {
    return "Applied profile DB migrations for the active profile."
  }
  return "Profile DB migration check completed."
}

async function maybeAutoMigrateProfileDb(repoDir, profileDir, triggerCommand) {
  const { envMap } = await loadProfileEnvMap(profileDir)
  const databaseUrl = (envMap.DATABASE_URL ?? "").trim()
  if (!databaseUrl) {
    return
  }

  console.log(`Ensuring profile database schema is up to date before \`orion ${triggerCommand}\`...`)
  const result = await runChildCapture(getPnpmCommand(), ["--dir", repoDir, "exec", "prisma", "migrate", "deploy"], {
    env: {
      ...buildOrionChildEnv(process.env, profileDir),
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
  })

  if (result.code !== 0) {
    const preview = (result.stderr || result.stdout || "").trim()
    throw new Error(`Profile DB migration failed before \`${triggerCommand}\`.\n${preview}`)
  }

  console.log(summarizeMigrateOutput(result.stdout, result.stderr))
}

async function runProfileDbMigrationPreflight(repoDir, profileDir, triggerCommand) {
  const { envMap } = await loadProfileEnvMap(profileDir)
  const databaseUrl = (envMap.DATABASE_URL ?? "").trim()
  if (!databaseUrl) {
    return {
      attempted: false,
      ok: true,
      message: "Skipped DB migration preflight (DATABASE_URL missing in active profile env).",
    }
  }

  const result = await runChildCapture(getPnpmCommand(), ["--dir", repoDir, "exec", "prisma", "migrate", "deploy"], {
    env: {
      ...buildOrionChildEnv(process.env, profileDir),
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    },
  })

  const summary = summarizeMigrateOutput(result.stdout, result.stderr)
  return {
    attempted: true,
    ok: result.code === 0,
    exitCode: result.code,
    message: summary,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

async function printChannelStatus(repoDir, profileDir, channel) {
  const { profilePaths, envMap } = await loadProfileEnvMap(profileDir)
  let checks = []
  let runtime = null

  if (channel === "whatsapp") {
    const result = await buildWhatsAppChannelStatusChecks(envMap, profilePaths)
    checks = result.checks
    runtime = result.runtime
  } else if (channel === "telegram") {
    const result = buildTelegramChannelStatusChecks(envMap)
    checks = result.checks
    runtime = result.runtime
  } else if (channel === "discord") {
    const result = buildDiscordChannelStatusChecks(envMap)
    checks = result.checks
    runtime = result.runtime
  } else if (channel === "webchat") {
    const result = await buildWebchatChannelStatusChecks(envMap)
    checks = result.checks
    runtime = result.runtime
  } else {
    throw new Error(`Unsupported channel '${channel}'`)
  }

  const errors = checks.filter((c) => c.level === "error").length
  const warnings = checks.filter((c) => c.level === "warn").length
  return {
    channel,
    repoDir,
    profileDir: profilePaths.profileDir,
    checks,
    errors,
    warnings,
    runtime,
  }
}

async function handleSelfTest(repoOverride, profileOverride, devMode = false, rest = []) {
  const options = parseSelfTestArgs(rest)
  if (options.help) {
    printSelfTestHelp()
    return
  }
  const repoDir = await resolveRepoDir(repoOverride)
  const profileDir = await resolveProfileDir(profileOverride, devMode)
  let appliedFixes = []
  let migration = null
  if (options.fix) {
    const fixResult = await applySelfTestFixes(repoDir, profileDir)
    appliedFixes = fixResult.fixes
  }
  if (options.migrate) {
    try {
      migration = await runProfileDbMigrationPreflight(repoDir, profileDir, "self-test --migrate")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      migration = {
        attempted: true,
        ok: false,
        message,
        stdout: "",
        stderr: message,
      }
    }
  }
  const { checks, profilePaths } = await collectSelfTestChecks(repoDir, profileDir)

  const errors = checks.filter((c) => c.level === "error").length
  const warnings = checks.filter((c) => c.level === "warn").length
  const summary = { errors, warnings }
  const output = {
    command: "self-test",
    repoDir,
    profileDir: profilePaths.profileDir,
    checks,
    summary,
    fixes: {
      requested: options.fix,
      applied: appliedFixes,
    },
    migration: options.migrate ? migration : null,
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2))
    const migrationFailed = options.migrate && migration && !migration.ok
    process.exit(errors > 0 || migrationFailed ? 1 : 0)
  }

  console.log("Orion Self-Test")
  console.log("===============")
  console.log(`Repo:    ${repoDir}`)
  console.log(`Profile: ${profilePaths.profileDir}`)
  console.log("")

  for (const check of checks) {
    console.log(`${testIcon(check.level)} ${check.label} - ${check.detail}`)
  }

  console.log("")
  console.log(`Summary: ${errors} errors, ${warnings} warnings`)
  if (options.migrate && migration) {
    console.log("")
    if (migration.ok) {
      console.log(`DB Migration: ${migration.message}`)
    } else {
      console.log(`DB Migration: failed (${migration.message})`)
      const preview = String(migration.stderr || migration.stdout || "").trim()
      if (preview) {
        console.log(preview)
      }
    }
  }
  if (options.fix) {
    console.log("")
    if (appliedFixes.length > 0) {
      console.log("Applied fixes:")
      for (const item of appliedFixes) {
        console.log(`- ${item}`)
      }
    } else {
      console.log("Applied fixes: no changes needed")
    }
  }
  if (errors === 0) {
    console.log("")
    console.log("Next:")
    console.log("- `orion wa scan` (WhatsApp QR setup)")
    console.log("- `orion all` (start Orion)")
  }

  const migrationFailed = options.migrate && migration && !migration.ok
  process.exit(errors > 0 || migrationFailed ? 1 : 0)
}

async function resolveRepoDirWithAutoDetect(repoOverride) {
  if (repoOverride) {
    return { repoDir: await resolveRepoDir(repoOverride), autoLinked: false }
  }

  try {
    return { repoDir: await resolveRepoDir(null), autoLinked: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/No Orion repo linked/i.test(message)) {
      throw error
    }

    const detected = await findOrionRepoUpwards(process.cwd())
    if (!detected) {
      throw error
    }

    return { repoDir: detected, autoLinked: true }
  }
}

async function handleDefaultEntry(repoOverride, profileOverride, devMode = false) {
  let resolved
  try {
    resolved = await resolveRepoDirWithAutoDetect(repoOverride)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/No Orion repo linked/i.test(message)) {
      console.log("Orion CLI")
      console.log("=========")
      console.log("")
      console.log("No linked Orion repo found yet.")
      console.log("OpenClaw-style first run needs a repo path one time (until standalone package runtime lands).")
      console.log("")
      console.log("Next:")
      console.log("- `orion link C:\\path\\to\\orion-ts`")
      console.log("- then run `orion` again (it will launch setup wizard if profile is not configured)")
      console.log("")
      console.log("Tip: if you run this inside the repo, use `orion link .`")
      return
    }
    throw error
  }

  const { repoDir, autoLinked } = resolved
  const profileDir = await resolveProfileDir(profileOverride, devMode)
  await ensureProfileBootstrap(repoDir, profileDir)

  if (autoLinked && !repoOverride && !profileOverride) {
    await saveCliConfig({ ...(await loadCliConfig()), repoDir, profileDir })
    console.log(`Auto-linked Orion repo: ${repoDir}`)
    console.log(`Active profile: ${profileDir}`)
    console.log("")
  }

  const { envMap } = await loadProfileEnvMap(profileDir)
  if (!isProfileEnvLikelyConfigured(envMap)) {
    console.log("No provider/channel setup detected for the active profile.")
    console.log("Launching setup wizard (OpenClaw-style first run)...")
    await runPnpmScript(repoDir, profileDir, "quickstart")
    return
  }

  console.log("Orion CLI is ready.")
  console.log(`Repo:    ${repoDir}`)
  console.log(`Profile: ${profileDir}`)
  console.log("")
  console.log("Next:")
  console.log("- `orion dashboard` (web dashboard / gateway)")
  console.log("- `orion channels login --channel whatsapp` (QR login)")
  console.log("- `orion all` (run Orion + channels)")
  console.log("- `orion status` (readiness check)")
}

async function resolveRepoDir(repoOverride) {
  if (repoOverride) {
    const resolved = path.resolve(process.cwd(), repoOverride)
    if (!(await isOrionRepoDir(resolved))) {
      throw new Error(`Invalid Orion repo path: ${resolved}`)
    }
    return resolved
  }

  const envRepo = normalizePathInput(process.env.ORION_REPO_DIR ?? "")
  if (envRepo) {
    const resolved = path.resolve(envRepo)
    if (await isOrionRepoDir(resolved)) {
      return resolved
    }
  }

  const autoDetected = await findOrionRepoUpwards(process.cwd())
  if (autoDetected) {
    return autoDetected
  }

  const cfg = await loadCliConfig()
  const linkedRepo = normalizePathInput(typeof cfg.repoDir === "string" ? cfg.repoDir : "")
  if (linkedRepo) {
    const resolved = path.resolve(linkedRepo)
    if (await isOrionRepoDir(resolved)) {
      return resolved
    }
    throw new Error(`Linked repo not found or invalid: ${resolved}. Run \`orion link <path>\` again.`)
  }

  throw new Error("No Orion repo linked. Run `orion link <path-to-orion-ts>` first.")
}

async function resolveProfileDir(profileOverride, devMode = false) {
  if (profileOverride) {
    return resolveProfileSelector(profileOverride) ?? getDefaultProfileDir()
  }

  if (devMode) {
    return getNamedProfileDir(DEV_PROFILE_NAME)
  }

  const envProfile = normalizePathInput(process.env.ORION_PROFILE_DIR ?? "")
  if (envProfile) {
    return resolveProfileSelector(envProfile) ?? getDefaultProfileDir()
  }

  const cfg = await loadCliConfig()
  const linkedProfile = normalizePathInput(typeof cfg.profileDir === "string" ? cfg.profileDir : "")
  if (linkedProfile) {
    return resolveProfileSelector(linkedProfile) ?? getDefaultProfileDir()
  }

  return getDefaultProfileDir()
}

async function runChild(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: shouldUseShellForCommand(command),
    ...options,
  })

  return await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`))
        return
      }
      resolve(code ?? 0)
    })
  })
}

function tryOpenUrl(url) {
  const platform = process.platform
  if (platform === "win32") {
    // `start` is a shell builtin, so we invoke through cmd.
    spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref()
    return true
  }

  const command = platform === "darwin" ? "open" : "xdg-open"
  spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  }).unref()
  return true
}

async function runPnpmScript(repoDir, profileDir, script, extraArgs = []) {
  const args = ["--dir", repoDir, script, ...extraArgs]
  const code = await runChild(getPnpmCommand(), args, {
    env: buildOrionChildEnv(process.env, profileDir),
  })
  process.exit(code)
}

async function runPnpmRaw(repoDir, profileDir, args) {
  const code = await runChild(getPnpmCommand(), ["--dir", repoDir, ...args], {
    env: buildOrionChildEnv(process.env, profileDir),
  })
  process.exit(code)
}

async function handleLink(targetPathArg, profileOverride, devMode = false) {
  const candidate = targetPathArg
    ? path.resolve(process.cwd(), targetPathArg)
    : await findOrionRepoUpwards(process.cwd())

  if (!candidate) {
    throw new Error("Could not auto-detect Orion repo here. Pass a path: `orion link <path-to-orion-ts>`")
  }

  if (!(await isOrionRepoDir(candidate))) {
    throw new Error(`Not an Orion repo: ${candidate}`)
  }

  const profileDir = await resolveProfileDir(profileOverride, devMode)
  await saveCliConfig({ repoDir: candidate, profileDir })
  console.log(`Linked Orion repo: ${candidate}`)
  console.log(`Active profile: ${profileDir}`)
  console.log("You can now run `orion wa scan` or `orion quickstart` from any directory.")
}

async function handleRepo(repoOverride) {
  const repoDir = await resolveRepoDir(repoOverride)
  console.log(repoDir)
}

async function handleProfile(repoOverride, profileOverride, subcommand, devMode = false) {
  const repoDir = await resolveRepoDir(repoOverride)
  const profileDir = await resolveProfileDir(profileOverride, devMode)

  if (!subcommand || subcommand === "show") {
    console.log(profileDir)
    return
  }

  if (subcommand === "init") {
    const paths = await ensureProfileBootstrap(repoDir, profileDir)
    if (!repoOverride && !profileOverride) {
      await saveCliConfig({ ...(await loadCliConfig()), repoDir, profileDir })
    }
    console.log(`Profile ready: ${paths.profileDir}`)
    console.log(`Env: ${paths.envPath}`)
    console.log(`Workspace: ${paths.workspaceDir}`)
    console.log(`State: ${paths.stateDir}`)
    return
  }

  throw new Error("Unknown `orion profile` subcommand. Use `orion profile` or `orion profile init`.")
}

async function detectGatewayPortFromProfileEnv(profileDir) {
  try {
    const raw = await fs.readFile(getProfilePaths(profileDir).envPath, "utf-8")
    const envMap = parseEnvContentLoose(raw)
    const parsed = Number.parseInt(envMap.GATEWAY_PORT ?? "", 10)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed
    }
  } catch {
    // Best-effort only; fallback below.
  }
  return 18789
}

async function handleLogs(repoDir, profileDir, rest) {
  const target = (rest[0] ?? "all").toLowerCase()
  if (target !== "all" && target !== "gateway") {
    console.log("Orion does not run a persistent daemon log store yet.")
    console.log("Use `orion logs all` or `orion logs gateway` to stream live logs by starting a process.")
    return
  }
  console.log(`Streaming live logs via \`orion ${target}\` (foreground process). Press Ctrl+C to stop.`)
  await runPnpmScript(repoDir, profileDir, target)
}

async function handleDashboard(repoDir, profileDir, rest = []) {
  const options = parseDashboardArgs(rest)
  if (options.help) {
    console.log("Orion Dashboard")
    console.log("==============")
    console.log("")
    console.log("Usage:")
    console.log("  orion dashboard [--open|--no-open]")
    console.log("")
    console.log("Options:")
    console.log("  --open      Open dashboard URL in the default browser (best effort)")
    console.log("  --no-open   Do not auto-open browser (default)")
    return
  }

  await maybeAutoMigrateProfileDb(repoDir, profileDir, "dashboard")
  const gatewayPort = await detectGatewayPortFromProfileEnv(profileDir)
  const dashboardUrl = `http://127.0.0.1:${gatewayPort}`
  console.log(`Dashboard URL: ${dashboardUrl}`)
  if (options.open) {
    try {
      tryOpenUrl(dashboardUrl)
      console.log("Opening dashboard in your default browser (best effort)...")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`Could not auto-open browser: ${message}`)
    }
  }
  console.log("Starting gateway in foreground (Ctrl+C to stop)...")
  await runPnpmScript(repoDir, profileDir, "gateway")
}

function printChannelsHelp() {
  console.log("Orion Channels (OpenClaw-style namespace)")
  console.log("=========================================")
  console.log("")
  console.log("Usage:")
  console.log("  orion channels login --channel whatsapp [--mode scan|cloud] [-- ...args]")
  console.log("  orion channels status [--channel whatsapp]")
  console.log("  orion channels logs [all|gateway] [--channel whatsapp]")
  console.log("")
  console.log("Notes:")
  console.log("  - `channels login` maps to the existing Orion setup/login flows.")
  console.log("  - WhatsApp defaults to QR scan mode unless `--mode cloud` is provided.")
  console.log("  - `channels status --channel <name>` prints channel-focused readiness (and runtime auth/session hints where supported).")
  console.log("  - `channels status` without `--channel` reuses `orion status` (global self-test).")
  console.log("  - `channels logs` currently reuses live foreground logs (`orion logs ...`).")
}

async function handleChannelsCommand(repoOverride, profileOverride, devMode, rest) {
  const parsed = parseChannelsArgs(rest)
  const [subcommandRaw, maybeChannelPositional, ...tailPositionals] = parsed.positionals
  const subcommand = (subcommandRaw ?? "").toLowerCase()

  if (parsed.help || !subcommand || subcommand === "help") {
    printChannelsHelp()
    return
  }

  const positionalChannel = normalizeChannelName(maybeChannelPositional ?? "")
  const channel = parsed.channel ?? positionalChannel
  const remainingPositionals = positionalChannel ? tailPositionals : (parsed.positionals.slice(1))

  if (subcommand === "status") {
    if (channel) {
      const repoDir = await resolveRepoDir(repoOverride)
      const profileDir = await resolveProfileDir(profileOverride, devMode)
      await ensureProfileBootstrap(repoDir, profileDir)
      const status = await printChannelStatus(repoDir, profileDir, channel)
      if (parsed.json) {
        console.log(JSON.stringify({
          command: "channels status",
          channel: status.channel,
          repoDir: status.repoDir,
          profileDir: status.profileDir,
          checks: status.checks,
          runtime: status.runtime ?? null,
          summary: {
            errors: status.errors,
            warnings: status.warnings,
          },
        }, null, 2))
      } else {
        console.log(`Orion Channel Status (${channel})`)
        console.log("=".repeat(24 + channel.length))
        console.log(`Repo:    ${repoDir}`)
        console.log(`Profile: ${status.profileDir}`)
        console.log("")
        for (const check of status.checks) {
          console.log(`${testIcon(check.level)} ${check.label} - ${check.detail}`)
        }
        console.log("")
        console.log(`Summary: ${status.errors} errors, ${status.warnings} warnings`)
      }
      process.exit(status.errors > 0 ? 1 : 0)
      return
    }
    const passthroughArgs = parsed.json ? [...remainingPositionals, "--json"] : remainingPositionals
    await handleSelfTest(repoOverride, profileOverride, devMode, passthroughArgs)
    return
  }

  const repoDir = await resolveRepoDir(repoOverride)
  const profileDir = await resolveProfileDir(profileOverride, devMode)
  await ensureProfileBootstrap(repoDir, profileDir)

  if (subcommand === "logs") {
    if (channel) {
      console.log(`Channel-specific log filtering for '${channel}' is not implemented yet; showing Orion live logs.`)
    }
    const firstTarget = (remainingPositionals[0] ?? "").toLowerCase()
    const hasExplicitTarget = firstTarget === "all" || firstTarget === "gateway"
    const targetArgs = channel && !hasExplicitTarget ? ["all", ...remainingPositionals] : remainingPositionals
    await handleLogs(repoDir, profileDir, targetArgs)
    return
  }

  if (subcommand === "login") {
    const resolvedChannel = channel ?? "whatsapp"
    if (resolvedChannel === "whatsapp") {
      const mode = normalizeWhatsAppLoginMode(parsed.mode)
      if (!mode) {
        throw new Error(`Invalid WhatsApp login mode '${parsed.mode}'. Use 'scan' or 'cloud'.`)
      }
      const targetScript = mode === "cloud" ? "wa:cloud" : "wa:scan"
      await runPnpmScript(repoDir, profileDir, targetScript, remainingPositionals)
      return
    }

    if (["telegram", "discord", "webchat"].includes(resolvedChannel)) {
      console.log(`Channel '${resolvedChannel}' does not have a standalone login flow in Orion yet.`)
      console.log("Launching onboarding quickstart for that channel instead.")
      await runPnpmScript(repoDir, profileDir, "quickstart", ["--channel", resolvedChannel, ...remainingPositionals])
      return
    }
  }

  throw new Error("Unknown `orion channels` subcommand. Use `orion channels help`.")
}

async function handleCommand(repoOverride, profileOverride, devMode, positionals) {
  const [command, ...rest] = positionals

  if (!command || command === "help") {
    if (!command) {
      await handleDefaultEntry(repoOverride, profileOverride, devMode)
      return
    }
    printHelp()
    return
  }

  if (command === "link") {
    await handleLink(rest[0] ?? null, profileOverride, devMode)
    return
  }

  if (command === "unlink") {
    await saveCliConfig({})
    console.log("Unlinked Orion repo.")
    return
  }

  if (command === "repo") {
    await handleRepo(repoOverride)
    return
  }

  if (command === "profile") {
    await handleProfile(repoOverride, profileOverride, (rest[0] ?? "").toLowerCase() || null, devMode)
    return
  }

  if (command === "self-test" || command === "selftest" || command === "status") {
    await handleSelfTest(repoOverride, profileOverride, devMode, rest)
    return
  }

  if (command === "channels") {
    await handleChannelsCommand(repoOverride, profileOverride, devMode, rest)
    return
  }

  const repoDir = await resolveRepoDir(repoOverride)
  const profileDir = await resolveProfileDir(profileOverride, devMode)

  if (command === "init") {
    await ensureProfileBootstrap(repoDir, profileDir)
    if (!repoOverride && !profileOverride) {
      await saveCliConfig({ ...(await loadCliConfig()), repoDir, profileDir })
    }
    await runPnpmScript(repoDir, profileDir, "quickstart", rest)
    return
  }

  // Commands below run Orion using the linked profile env/state instead of the repo root.
  await ensureProfileBootstrap(repoDir, profileDir)

  if (command === "quickstart" || command === "setup" || command === "configure") {
    await runPnpmScript(repoDir, profileDir, "quickstart", rest)
    return
  }

  if (command === "dashboard") {
    await handleDashboard(repoDir, profileDir, rest)
    return
  }

  if (command === "wa") {
    const sub = (rest[0] ?? "").toLowerCase()
    const waArgs = rest.slice(1)
    if (sub === "scan") {
      await runPnpmScript(repoDir, profileDir, "wa:scan", waArgs)
      return
    }
    if (sub === "cloud") {
      await runPnpmScript(repoDir, profileDir, "wa:cloud", waArgs)
      return
    }
    throw new Error("Unknown `orion wa` subcommand. Use `orion wa scan` or `orion wa cloud`.")
  }

  if (command === "all" || command === "doctor" || command === "gateway") {
    if (command === "all" || command === "gateway") {
      await maybeAutoMigrateProfileDb(repoDir, profileDir, command)
    }
    await runPnpmScript(repoDir, profileDir, command)
    return
  }

  if (command === "logs") {
    await handleLogs(repoDir, profileDir, rest)
    return
  }

  if (command === "onboard") {
    const delimiterIndex = rest.indexOf("--")
    const forwardArgs = delimiterIndex >= 0 ? rest.slice(delimiterIndex + 1) : rest
    await runPnpmRaw(repoDir, profileDir, ["onboard", "--", ...forwardArgs])
    return
  }

  if (command === "run" && rest[0]) {
    const [script, ...scriptArgs] = rest
    await runPnpmScript(repoDir, profileDir, script, scriptArgs)
    return
  }

  throw new Error(`Unknown command: ${command}. Run \`orion help\`.`)
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseOrionCliArgs(argv)
  if (parsed.help) {
    printHelp()
    return
  }

  try {
    await handleCommand(parsed.repoOverride, parsed.profileOverride, parsed.dev, parsed.positionals)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Orion CLI error: ${message}`)
    if (/No Orion repo linked/i.test(message)) {
      console.error("Hint: run `orion link C:\\path\\to\\orion-ts` once, then retry.")
    }
    process.exit(1)
  }
}

if (shouldInvokeCli(import.meta.url, process.argv[1])) {
  void main()
}
