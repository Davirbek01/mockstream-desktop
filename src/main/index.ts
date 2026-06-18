import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile(join(__dirname, '../renderer/fallback.html'))
  return win
}

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(() => {
  createWindow()
})
