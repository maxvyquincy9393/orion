const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const os = require("os")
const WebSocket = require("ws")

let mainWindow = null
let tray = null
let edithProcess = null
let ws = null
let gatewayReady = false

function log(...args) {
  console.log("[edith:main]", ...args)
}

/**
 * Send a payload to the EDITH gateway WebSocket if connected.
 * @param {object} payload - JSON-serializable payload
 */
function sendToGateway(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

/**
 * Merge new env key=value lines into existing .env content without duplication.
 * Existing keys are updated; new keys are appended.
 * @param {string} existing - Existing .env file content
 * @param {string} updates - New key=value lines to merge
 * @returns {string} Merged content
 */
function mergeEnvContent(existing, updates) {
  const lines = existing.split('\n').filter(l => l.trim())
  const updateMap = {}
  updates.split('\n').filter(l => l.trim() && l.includes('=')).forEach(l => {
    const [k] = l.split('=')
    updateMap[k.trim()] = l
  })
  const merged = lines.map(l => {
    const [k] = l.split('=')
    return updateMap[k.trim()] ? updateMap[k.trim()] : l
  })
  Object.entries(updateMap).forEach(([k, v]) => {
    if (!lines.some(l => l.startsWith(k + '='))) merged.push(v)
  })
  return merged.join('\n') + '\n'
}

/**
 * Initialize the auto-updater using electron-updater (optional dep).
 * Gracefully degrades if electron-updater is not installed.
 */
function initAutoUpdater() {
  let autoUpdater
  try { ({ autoUpdater } = require("electron-updater")) } catch { return }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // use our own logging

  autoUpdater.on("checking-for-update", () => log("checking for update..."))
  autoUpdater.on("update-available", (info) => {
    tray?.setToolTip(`EDITH — Update v${info.version} available`)
    mainWindow?.webContents.send("updater:available", info)
    sendToGateway({ type: "tts", text: `EDITH version ${info.version} is available. Downloading in the background.` })
  })
  autoUpdater.on("update-downloaded", (info) => {
    tray?.setToolTip(`EDITH — Restart to apply v${info.version}`)
    mainWindow?.webContents.send("updater:downloaded", info)
    sendToGateway({ type: "tts", text: "Update downloaded. Will install on next restart." })
  })
  autoUpdater.on("error", (err) => log("Updater error (non-fatal):", err.message))

  // Delayed check so gateway is ready
  setTimeout(() => { try { autoUpdater.checkForUpdatesAndNotify() } catch {} }, 10_000)

  ipcMain.handle("updater:check", () => { try { return autoUpdater.checkForUpdatesAndNotify() } catch {} })
  ipcMain.handle("updater:install", () => { try { autoUpdater.quitAndInstall() } catch {} })
}

function startGateway() {
  edithProcess = spawn("node", [
    path.join(__dirname, "../../dist/main.js"),
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
  tray.setToolTip("EDITH")

  let voiceMuted = false

  const buildMenu = () => Menu.buildFromTemplate([
    { label: "Open EDITH", click: () => mainWindow?.show() },
    { label: "Status", click: () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "status" }))
      }
    }},
    { label: voiceMuted ? "Voice: Unmute" : "Voice: Mute", click: () => {
      voiceMuted = !voiceMuted
      sendToGateway({ type: "voice:mute", muted: voiceMuted })
      tray?.setContextMenu(buildMenu())
    }},
    { label: "Check for updates", click: () => {
      ipcMain.emit("updater:check")
      try { require("electron-updater").autoUpdater.checkForUpdatesAndNotify() } catch {}
    }},
    { type: "separator" },
    { label: "Quit", click: () => {
      app.isQuitting = true
      app.quit()
    }}
  ])

  tray.setContextMenu(buildMenu())

  tray.on("click", () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
    }
  })
}

/**
 * Check whether edith.json contains at least one non-empty credential.
 * Used to decide whether to show the OOBE wizard on first launch.
 * @returns {boolean} true if credentials exist
 */
function hasCredentials() {
  try {
    const cfgPath = path.join(__dirname, "../../edith.json")
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"))
    const creds = cfg.credentials || {}
    return Object.values(creds).some(v => typeof v === "string" && v.trim() !== "")
  } catch {
    return false
  }
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

  // Show OOBE wizard on first launch when no credentials are configured
  const startPage = hasCredentials() ? "index.html" : "onboarding.html"
  mainWindow.loadFile(path.join(__dirname, "renderer", startPage))

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

app.whenReady().then(() => {
  createTray()
  createWindow()
  startGateway()
  initAutoUpdater()
})

app.on("window-all-closed", () => {
})

app.on("before-quit", () => {
  app.isQuitting = true
  edithProcess?.kill()
  ws?.close()
})

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

/**
 * Read or initialize edith.json, merge data, and write back.
 * @param {object} data - Object with optional credentials/features/identity/channels sections
 * @returns {{ success: boolean, error?: string }}
 */
function writeEdithJson(data) {
  const cfgPath = path.join(__dirname, "../../edith.json")
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) } catch {}
  if (data.credentials) cfg.credentials = { ...(cfg.credentials || {}), ...data.credentials }
  if (data.features) cfg.features = { ...(cfg.features || {}), ...data.features }
  if (data.identity) cfg.identity = { ...(cfg.identity || {}), ...data.identity }
  if (data.channels) cfg.channels = { ...(cfg.channels || {}), ...data.channels }
  // Allow arbitrary top-level merges for settings:save
  for (const [key, value] of Object.entries(data)) {
    if (!["credentials", "features", "identity", "channels"].includes(key)) {
      cfg[key] = typeof value === "object" && value !== null && typeof cfg[key] === "object" && cfg[key] !== null
        ? { ...cfg[key], ...value }
        : value
    }
  }
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf-8")
  return { success: true }
}

ipcMain.handle("oobe:save-credentials", async (_, data) => {
  try {
    return writeEdithJson(data)
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle("oobe:load-credentials", async () => {
  try {
    const cfgPath = path.join(__dirname, "../../edith.json")
    let cfg = {}
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) } catch {}
    return { success: true, credentials: cfg.credentials || {}, features: cfg.features || {}, identity: cfg.identity || {} }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle("settings:save", async (_, data) => {
  try {
    return writeEdithJson(data)
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle("settings:load", async () => {
  try {
    const cfgPath = path.join(__dirname, "../../edith.json")
    let cfg = {}
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) } catch {}
    return { success: true, config: cfg }
  } catch (err) {
    return { success: false, error: err.message }
  }
})
