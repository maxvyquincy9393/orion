const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const WebSocket = require("ws")

let mainWindow = null
let tray = null
let edithProcess = null
let ws = null
let gatewayReady = false

// ── EDITH Config Path ───────────────────────────────────────────────
// edith.json lives next to the engine (EDITH-ts/) so both desktop app
// and engine read the same file — EDITH pattern.
const NOVA_ENGINE_DIR = path.join(__dirname, "../../EDITH-ts")
const EDITH_CONFIG_PATH = path.join(NOVA_ENGINE_DIR, "edith.json")

function readEdithConfig() {
  try {
    return JSON.parse(fs.readFileSync(EDITH_CONFIG_PATH, "utf-8"))
  } catch {
    return null
  }
}

function writeEdithConfig(config) {
  fs.mkdirSync(path.dirname(EDITH_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(EDITH_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

function deepMerge(target, source) {
  const result = { ...target }
  for (const [key, value] of Object.entries(source || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

function resolveTsxCommand() {
  const localTsxCli = path.join(
    NOVA_ENGINE_DIR,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  )

  if (fs.existsSync(localTsxCli)) {
    return { command: process.execPath, args: [localTsxCli] }
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsx"],
  }
}

function prepareWakeModelOnHost(modelName = "hey_mycroft") {
  return new Promise((resolve, reject) => {
    const tsx = resolveTsxCommand()
    const child = spawn(
      tsx.command,
      [...tsx.args, "src/cli/voice-wake-prepare.ts", "--json", "--model", modelName],
      {
        cwd: NOVA_ENGINE_DIR,
        windowsHide: true,
      },
    )

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data) => { stdout += data.toString() })
    child.stderr.on("data", (data) => { stderr += data.toString() })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Wake model prepare exited with code ${code}`))
        return
      }
      try {
        const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        const parsed = JSON.parse(lines[lines.length - 1] || "{}")
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    })
  })
}

// ── isConfigured: any known provider key or local endpoint ─────────
function isConfigured() {
  const cfg = readEdithConfig()
  if (!cfg || !cfg.env) return false
  const env = cfg.env
  return !!(
    env.GROQ_API_KEY ||
    env.ANTHROPIC_API_KEY ||
    env.OPENAI_API_KEY ||
    env.GEMINI_API_KEY ||
    env.OPENROUTER_API_KEY ||
    env.DEEPSEEK_API_KEY ||
    env.MISTRAL_API_KEY ||
    env.XAI_API_KEY ||
    env.TOGETHER_API_KEY ||
    env.FIREWORKS_API_KEY ||
    env.PERPLEXITY_API_KEY ||
    env.OLLAMA_BASE_URL ||
    env.LM_STUDIO_BASE_URL ||
    // legacy key names
    env.OLLAMA_HOST
  )
}

function startGateway() {
  edithProcess = spawn("node", [
    path.join(__dirname, "../../EDITH-ts/dist/main.js"),
    "--mode", "gateway"
  ])

  edithProcess.stdout.on("data", (data) => {
    const text = data.toString()
    console.log("[edith]", text)
    if (text.includes("gateway running")) {
      gatewayReady = true
      connectToGateway()
    }
  })

  edithProcess.stderr.on("data", (data) => {
    console.error("[edith stderr]", data.toString())
  })

  edithProcess.on("exit", () => {
    gatewayReady = false
    console.log("Gateway process exited")
  })
}

function connectToGateway() {
  if (ws) ws.close()

  ws = new WebSocket("ws://127.0.0.1:18789/ws")

  ws.on("open", () => {
    console.log("Connected to gateway")
    mainWindow?.webContents.send("gateway:connected")
  })

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      mainWindow?.webContents.send("gateway:message", msg)
    } catch (err) {
      console.error("Failed to parse gateway message:", err)
    }
  })

  ws.on("close", () => {
    console.log("Gateway connection closed, reconnecting in 3s")
    setTimeout(connectToGateway, 3000)
  })

  ws.on("error", (err) => {
    console.error("Gateway WebSocket error:", err)
  })
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip("EDITH")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open EDITH", click: () => mainWindow?.show() },
    { label: "Status", click: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "status" }))
      }
    }},
    { type: "separator" },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit() } }
  ]))

  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide()
    else mainWindow?.show()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isConfigured()) {
    mainWindow.loadFile(path.join(__dirname, "renderer/index.html"))
    startGateway()
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer/onboarding.html"))
  }

  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL()
    if (url.includes("index.html") && !edithProcess && isConfigured()) {
      startGateway()
    }
  })

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

app.on("window-all-closed", () => {})

app.on("before-quit", () => {
  app.isQuitting = true
  edithProcess?.kill()
  ws?.close()
})

app.whenReady().then(() => {
  createTray()
  createWindow()
})

// ─────────────────────────────────────────────────────────────────────
// Chat IPC
// ─────────────────────────────────────────────────────────────────────
ipcMain.handle("send:message", async (_, content, userId = "owner") => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { error: "Gateway not ready" }
  ws.send(JSON.stringify({ type: "message", content, userId }))
  return { ok: true }
})

ipcMain.handle("send:gateway", async (_, payload) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { error: "Gateway not ready" }
  ws.send(JSON.stringify(payload))
  return { ok: true }
})

ipcMain.handle("get:status", async () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return { error: "Not connected" }
  ws.send(JSON.stringify({ type: "status" }))
  return { ok: true }
})

// ─────────────────────────────────────────────────────────────────────
// Config IPC — writes directly to edith.json, never touches .env
// ─────────────────────────────────────────────────────────────────────
ipcMain.handle("config:save", async (_, config) => {
  try {
    const existing = readEdithConfig() || {}
    const merged = deepMerge(existing, config)
    writeEdithConfig(merged)
    return { ok: true, path: EDITH_CONFIG_PATH }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle("config:load", async () => {
  try {
    const config = readEdithConfig()
    return { ok: true, config: config || {} }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle("config:is-configured", async () => {
  return { configured: isConfigured() }
})

ipcMain.handle("config:pick-wake-model", async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: "Select Wake Word Model",
      filters: [{ name: "Wake Word Models", extensions: ["ppn", "onnx", "tflite"] }],
      properties: ["openFile"],
    })
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, cancelled: true }
    return { ok: true, path: result.filePaths[0] }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle("config:prepare-wake-model", async (_, options = {}) => {
  try {
    const result = await prepareWakeModelOnHost(options.modelName || "hey_mycroft")
    return result
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ─────────────────────────────────────────────────────────────────────
// Provider connection test — all providers
// Credentials come in as { PROVIDER_API_KEY: "..." } matching env keys
// ─────────────────────────────────────────────────────────────────────
ipcMain.handle("config:test-provider", async (_, provider, creds) => {
  try {
    switch (provider) {

      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${creds.GROQ_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": creds.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }]
          })
        })
        // 200 or 400 both mean key is valid (400 = model issue, not auth)
        return { ok: res.status !== 401 && res.status !== 403, status: res.status }
      }

      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${creds.OPENAI_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "gemini": {
        const key = creds.GEMINI_API_KEY
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
        )
        return { ok: res.ok, status: res.status }
      }

      case "openrouter": {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${creds.OPENROUTER_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "deepseek": {
        const res = await fetch("https://api.deepseek.com/v1/models", {
          headers: { Authorization: `Bearer ${creds.DEEPSEEK_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "mistral": {
        const res = await fetch("https://api.mistral.ai/v1/models", {
          headers: { Authorization: `Bearer ${creds.MISTRAL_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "xai": {
        const res = await fetch("https://api.x.ai/v1/models", {
          headers: { Authorization: `Bearer ${creds.XAI_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "together": {
        const res = await fetch("https://api.together.xyz/v1/models", {
          headers: { Authorization: `Bearer ${creds.TOGETHER_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "fireworks": {
        const res = await fetch("https://api.fireworks.ai/inference/v1/models", {
          headers: { Authorization: `Bearer ${creds.FIREWORKS_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }

      case "perplexity": {
        // Perplexity doesn't have a /models endpoint — test with tiny completion
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1
          })
        })
        return { ok: res.status !== 401 && res.status !== 403, status: res.status }
      }

      case "ollama": {
        const base = creds.OLLAMA_BASE_URL || creds.OLLAMA_HOST || "http://localhost:11434"
        const res = await fetch(`${base}/api/tags`)
        return { ok: res.ok, status: res.status }
      }

      case "lmstudio": {
        const base = creds.LM_STUDIO_BASE_URL || "http://localhost:1234"
        const res = await fetch(`${base}/v1/models`)
        if (!res.ok) return { ok: false, status: res.status }
        const data = await res.json()
        const hasModel = Array.isArray(data.data) && data.data.length > 0
        return {
          ok: hasModel,
          status: res.status,
          error: hasModel ? undefined : "LM Studio is running but no model is loaded. Load a model in LM Studio first."
        }
      }

      case "deepgram": {
        const res = await fetch("https://api.deepgram.com/v1/projects", {
          headers: { Authorization: `Token ${creds.DEEPGRAM_API_KEY || creds.apiKey || ""}` }
        })
        return { ok: res.ok, status: res.status }
      }

      default:
        return { ok: false, error: `Unknown provider: ${provider}` }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ─────────────────────────────────────────────────────────────────────
// Window IPC
// ─────────────────────────────────────────────────────────────────────
ipcMain.handle("window:minimize", async () => { mainWindow?.hide(); return { ok: true } })
ipcMain.handle("window:close",   async () => { mainWindow?.hide(); return { ok: true } })
ipcMain.handle("app:quit",       async () => { app.isQuitting = true; app.quit(); return { ok: true } })
