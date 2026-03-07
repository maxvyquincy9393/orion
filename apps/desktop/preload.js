const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("edith", {
  sendMessage: (content, userId) =>
    ipcRenderer.invoke("send:message", content, userId),

  sendGatewayMessage: (payload) =>
    ipcRenderer.invoke("send:gateway", payload),

  getStatus: () =>
    ipcRenderer.invoke("get:status"),

  // ── Config / Onboarding ──────────────────────────────────────────
  saveConfig: (config) =>
    ipcRenderer.invoke("config:save", config),

  loadConfig: () =>
    ipcRenderer.invoke("config:load"),

  testProvider: (provider, credentials) =>
    ipcRenderer.invoke("config:test-provider", provider, credentials),

  pickWakeModel: () =>
    ipcRenderer.invoke("config:pick-wake-model"),

  prepareWakeModel: (options) =>
    ipcRenderer.invoke("config:prepare-wake-model", options),

  isConfigured: () =>
    ipcRenderer.invoke("config:is-configured"),

  // ── Window controls ──────────────────────────────────────────────
  minimizeWindow: () =>
    ipcRenderer.invoke("window:minimize"),

  closeWindow: () =>
    ipcRenderer.invoke("window:close"),

  quitApp: () =>
    ipcRenderer.invoke("app:quit"),

  onMessage: (callback) => {
    const handler = (_, msg) => callback(msg)
    ipcRenderer.on("gateway:message", handler)
    return () => ipcRenderer.removeListener("gateway:message", handler)
  },

  onConnected: (callback) => {
    const handler = () => callback()
    ipcRenderer.on("gateway:connected", handler)
    return () => ipcRenderer.removeListener("gateway:connected", handler)
  },

  removeAllListeners: (channel) =>
    ipcRenderer.removeAllListeners(channel)
})
