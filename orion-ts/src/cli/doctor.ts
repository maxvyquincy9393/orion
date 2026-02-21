import fs from "node:fs/promises"
import net from "node:net"

import { execa } from "execa"

import config from "../config.js"
import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import { memory } from "../memory/store.js"

const log = createLogger("cli.doctor")

type Level = "ok" | "warn" | "error"

interface CheckResult {
  level: Level
  label: string
  detail: string
}

function icon(level: Level): string {
  if (level === "ok") return "OK"
  if (level === "warn") return "WARN"
  return "ERR"
}

async function checkPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  try {
    await prisma.$connect()
    const count = await prisma.message.count()
    results.push({ level: "ok", label: "Database", detail: `Connected (SQLite, ${count} messages)` })
  } catch (error) {
    results.push({ level: "error", label: "Database", detail: `Failed to connect: ${String(error)}` })
  }

  try {
    await memory.init()
    results.push({ level: "ok", label: "LanceDB", detail: "Initialized" })
  } catch (error) {
    results.push({ level: "error", label: "LanceDB", detail: `Init failed: ${String(error)}` })
  }

  const apiChecks: Array<{ name: string; value: string }> = [
    { name: "Anthropic", value: config.ANTHROPIC_API_KEY },
    { name: "OpenAI", value: config.OPENAI_API_KEY },
    { name: "Gemini", value: config.GEMINI_API_KEY },
    { name: "Groq", value: config.GROQ_API_KEY },
    { name: "OpenRouter", value: config.OPENROUTER_API_KEY },
  ]

  for (const item of apiChecks) {
    if (item.value.trim()) {
      results.push({ level: "ok", label: item.name, detail: "API key configured" })
    } else {
      results.push({ level: "warn", label: item.name, detail: "API key missing" })
    }
  }

  try {
    await fs.access(config.PERMISSIONS_FILE)
    results.push({ level: "ok", label: "Permissions", detail: `Found ${config.PERMISSIONS_FILE}` })
  } catch {
    results.push({ level: "error", label: "Permissions", detail: `Missing ${config.PERMISSIONS_FILE}` })
  }

  try {
    const { stdout, stderr } = await execa(config.PYTHON_PATH, ["--version"], { timeout: 10_000 })
    results.push({ level: "ok", label: "Python", detail: (stdout || stderr).trim() || "Detected" })
  } catch (error) {
    results.push({ level: "error", label: "Python", detail: `Not available: ${String(error)}` })
  }

  const gatewayFree = await checkPortAvailable(config.GATEWAY_PORT)
  results.push({
    level: gatewayFree ? "ok" : "warn",
    label: "Gateway Port",
    detail: gatewayFree
      ? `Port ${config.GATEWAY_PORT} available`
      : `Port ${config.GATEWAY_PORT} already in use`,
  })

  const webchatFree = await checkPortAvailable(config.WEBCHAT_PORT)
  results.push({
    level: webchatFree ? "ok" : "warn",
    label: "WebChat Port",
    detail: webchatFree
      ? `Port ${config.WEBCHAT_PORT} available`
      : `Port ${config.WEBCHAT_PORT} already in use`,
  })

  if (config.DISCORD_BOT_TOKEN.trim() && !config.DISCORD_CHANNEL_ID.trim()) {
    results.push({ level: "warn", label: "Discord", detail: "Token configured but DISCORD_CHANNEL_ID missing" })
  }

  if (config.TELEGRAM_BOT_TOKEN.trim() && !config.TELEGRAM_CHAT_ID.trim()) {
    results.push({ level: "warn", label: "Telegram", detail: "Token configured but TELEGRAM_CHAT_ID missing" })
  }

  if (config.WHATSAPP_ENABLED) {
    results.push({ level: "ok", label: "WhatsApp", detail: "Enabled" })
  }

  return results
}

async function main(): Promise<void> {
  const results = await runChecks()

  const errors = results.filter((item) => item.level === "error").length
  const warnings = results.filter((item) => item.level === "warn").length

  console.log("Orion Doctor")
  console.log("============")

  for (const result of results) {
    console.log(`${icon(result.level)} ${result.label} - ${result.detail}`)
  }

  console.log("")
  console.log(`Issues: ${errors} errors, ${warnings} warnings`)

  await prisma.$disconnect().catch((error) => log.warn("prisma disconnect failed", error))

  process.exit(errors > 0 ? 1 : 0)
}

void main()
