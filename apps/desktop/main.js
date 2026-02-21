const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron")
const { spawn } = require("child_process")
const path = require("path")
const WebSocket = require("ws")

let mainWindow = null
let tray = null
let orionProcess = null
let ws = null
let gatewayReady = false

function startGateway() {
  orionProcess = spawn("node", [
    path.join(__dirname, "../../orion-ts/dist/main.js"),
    "--mode", "gateway"
  ])

  orionProcess.stdout.on("data", (data) => {
    const text = data.toString()
    console.log("[orion]", text)
    if (text.includes("gateway running")) {
      gatewayReady = true
      connectToGateway()
    }
  })

  orionProcess.stderr.on("data", (data) => {
    console.error("[orion stderr]", data.toString())
  })

  orionProcess.on("exit", () => {
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
  tray.setToolTip("Orion")
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Orion", click: () => mainWindow?.show() },
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

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"))

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
})

app.on("window-all-closed", () => {
})

app.on("before-quit", () => {
  app.isQuitting = true
  orionProcess?.kill()
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
