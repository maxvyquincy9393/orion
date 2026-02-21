const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("orion", {
  sendMessage: (content, userId) =>
    ipcRenderer.invoke("send:message", content, userId),

  getStatus: () =>
    ipcRenderer.invoke("get:status"),

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
