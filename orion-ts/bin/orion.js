#!/usr/bin/env node

import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
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
  const positionals = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      help = true
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

  return { channel, mode, positionals, help }
}

export function parseSelfTestArgs(argv) {
  const args = [...argv]
  let fix = false
  let help = false
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
    positionals.push(arg)
  }

  return { fix, help, positionals }
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
      return { repoOverride: null, profileOverride: null, dev: false, positionals: [], help: true }
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
  const normalized = String(content ?? "").replace(/\r\n/g, "\n")
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim()
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
  console.log("  orion self-test [--fix]")
  console.log("  orion status [--fix]")
  console.log("")
  console.log("Options:")
  console.log("  --fix   Apply safe local fixes (profile bootstrap, permissions template, env baseline keys)")
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

async function printChannelStatus(repoDir, profileDir, channel) {
  const { profilePaths, envMap } = await loadProfileEnvMap(profileDir)
  let checks = []

  if (channel === "whatsapp") {
    checks = buildWhatsAppSelfTestChecks(envMap, profilePaths)
  } else if (channel === "telegram") {
    checks = buildTelegramSelfTestChecks(envMap)
  } else if (channel === "discord") {
    checks = buildDiscordSelfTestChecks(envMap)
  } else if (channel === "webchat") {
    checks = buildWebchatSelfTestChecks(envMap)
  } else {
    throw new Error(`Unsupported channel '${channel}'`)
  }

  const errors = checks.filter((c) => c.level === "error").length
  const warnings = checks.filter((c) => c.level === "warn").length
  console.log(`Orion Channel Status (${channel})`)
  console.log("=".repeat(24 + channel.length))
  console.log(`Repo:    ${repoDir}`)
  console.log(`Profile: ${profilePaths.profileDir}`)
  console.log("")
  for (const check of checks) {
    console.log(`${testIcon(check.level)} ${check.label} - ${check.detail}`)
  }
  console.log("")
  console.log(`Summary: ${errors} errors, ${warnings} warnings`)
  return { errors, warnings }
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
  if (options.fix) {
    const fixResult = await applySelfTestFixes(repoDir, profileDir)
    appliedFixes = fixResult.fixes
  }
  const { checks, profilePaths } = await collectSelfTestChecks(repoDir, profileDir)

  const errors = checks.filter((c) => c.level === "error").length
  const warnings = checks.filter((c) => c.level === "warn").length

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

  process.exit(errors > 0 ? 1 : 0)
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

async function handleDashboard(repoDir, profileDir) {
  const gatewayPort = await detectGatewayPortFromProfileEnv(profileDir)
  console.log(`Dashboard URL: http://127.0.0.1:${gatewayPort}`)
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
  console.log("  - `channels status` currently reuses `orion status` (self-test readiness).")
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
      const summary = await printChannelStatus(repoDir, profileDir, channel)
      process.exit(summary.errors > 0 ? 1 : 0)
      return
    }
    await handleSelfTest(repoOverride, profileOverride, devMode, remainingPositionals)
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
    await handleDashboard(repoDir, profileDir)
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
