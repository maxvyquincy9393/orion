const { autoUpdater } = require("electron-updater")
const { ipcMain } = require("electron")

class Updater {
  init(mainWindow) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on("update-available", (info) => {
      mainWindow.webContents.send("update:available", info)
    })

    autoUpdater.on("update-not-available", () => {
      mainWindow.webContents.send("update:none")
    })

    autoUpdater.on("download-progress", (progress) => {
      mainWindow.webContents.send("update:progress", progress)
    })

    autoUpdater.on("update-downloaded", () => {
      mainWindow.webContents.send("update:ready")
    })

    autoUpdater.on("error", (err) => {
      mainWindow.webContents.send("update:error", String(err))
    })

    autoUpdater.checkForUpdates().catch(() => {})

    ipcMain.handle("update:download", () => {
      autoUpdater.downloadUpdate()
    })

    ipcMain.handle("update:install", () => {
      autoUpdater.quitAndInstall()
    })

    ipcMain.handle("update:check", () => {
      autoUpdater.checkForUpdates()
    })
  }
}

module.exports = new Updater()
