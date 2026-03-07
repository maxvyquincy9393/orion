const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const WebSocket = require("ws")

let mainWindow = null
let tray = null
let novaProcess = null
let ws = null
let gatewayReady = false

// ── Nova Config Path ───────────────────────────────────────────────
// nova.json lives next to the engine (orion-ts/) so both desktop app
// and engine read the same file — OpenClaw pattern.
const NOVA_ENGINE_DIR = path.join(__dirname, "../../orion-ts")
const NOVA_CONFIG_PATH = path.join(NOVA_ENGINE_DIR, "nova.json")

function readNovaConfig() {
  try {
    return JSON.parse(fs.readFileSync(NOVA_CONFIG_PATH, "utf-8"))
  } catch {
    return null
  }
}

function writeNovaConfig(config) {
  fs.mkdirSync(path.dirname(NOVA_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(NOVA_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

function isConfigured() {
  const cfg = readNovaConfig()
  if (!cfg || !cfg.env) return false
  // At least one API key must be set, or Ollama mode
  const env = cfg.env
  return !!(env.GROQ_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.OLLAMA_HOST)
}

function startGateway() {
  novaProcess = spawn("node", [
    path.join(__dirname, "../../orion-ts/dist/main.js"),
    "--mode", "gateway"
  ])

  novaProcess.stdout.on("data", (data) => {
    const text = data.toString()
    console.log("[nova]", text)
    if (text.includes("gateway running")) {
      gatewayReady = true
      connectToGateway()
    }
  })

  novaProcess.stderr.on("data", (data) => {
    console.error("[nova stderr]", data.toString())
  })

  novaProcess.on("exit", () => {
    gatewayReady = false
    console.log("Gateway process exited")
  })
}

function connectToGateway() {
  if (ws) {
    ws.close()
  }

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
  tray.setToolTip("Nova")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Nova", click: () => mainWindow?.show() },
    { label: "Status", click: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "status" }))
      }
    }},
    { type: "separator" },
    { label: "Quit", click: () => {
      app.isQuitting = true
      app.quit()
    }}
  ]))

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 700,
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

  // Show onboarding wizard if not configured yet, otherwise chat
  if (isConfigured()) {
    mainWindow.loadFile(path.join(__dirname, "renderer/index.html"))
    startGateway()
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer/onboarding.html"))
  }

  // When navigating from onboarding → chat, start gateway if needed
  mainWindow.webContents.on("did-finish-load", () => {
    const url = mainWindow.webContents.getURL()
    if (url.includes("index.html") && !novaProcess && isConfigured()) {
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

app.on("window-all-closed", () => {
})

app.on("before-quit", () => {
  app.isQuitting = true
  novaProcess?.kill()
  ws?.close()
})

// ── App ready ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray()
  createWindow()
})

// ── Chat IPC ───────────────────────────────────────────────────────
ipcMain.handle("send:message", async (_, content, userId = "owner") => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: "Gateway not ready" }
  }
  ws.send(JSON.stringify({ type: "message", content, userId }))
  return { ok: true }
})

ipcMain.handle("get:status", async () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: "Not connected" }
  }
  ws.send(JSON.stringify({ type: "status" }))
  return { ok: true }
})

// ── Config IPC (OpenClaw-style — writes nova.json) ─────────────────
ipcMain.handle("config:save", async (_, config) => {
  try {
    // Build the nova.json structure from onboarding credentials
    const existing = readNovaConfig() || {}
    const merged = { ...existing, ...config }
    writeNovaConfig(merged)
    return { ok: true, path: NOVA_CONFIG_PATH }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle("config:load", async () => {
  try {
    const config = readNovaConfig()
    return { ok: true, config: config || {} }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle("config:is-configured", async () => {
  return { configured: isConfigured() }
})

ipcMain.handle("config:test-provider", async (_, provider, credentials) => {
  try {
    switch (provider) {
      case "groq": {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${credentials.GROQ_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }
      case "anthropic": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": credentials.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }]
          })
        })
        // 200 or 400 (bad request but key valid) both mean key works
        return { ok: res.status !== 401 && res.status !== 403, status: res.status }
      }
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${credentials.OPENAI_API_KEY}` }
        })
        return { ok: res.ok, status: res.status }
      }
      case "ollama": {
        const host = credentials.OLLAMA_HOST || "http://127.0.0.1:11434"
        const res = await fetch(`${host}/api/tags`)
        return { ok: res.ok, status: res.status }
      }
      default:
        return { ok: false, error: `Unknown provider: ${provider}` }
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── Window IPC ─────────────────────────────────────────────────────
ipcMain.handle("window:minimize", async () => {
  mainWindow?.hide()
  return { ok: true }
})

ipcMain.handle("window:close", async () => {
  mainWindow?.hide()
  return { ok: true }
})

ipcMain.handle("app:quit", async () => {
  app.isQuitting = true
  app.quit()
  return { ok: true }
})
