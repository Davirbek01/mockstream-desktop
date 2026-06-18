import { app, BrowserWindow, ipcMain, net } from 'electron'
import { join } from 'node:path'
import { resolveRunnerTarget } from './runner-target'
import { loadRunnerConfig } from './config'

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

  const target = resolveRunnerTarget({
    online: net.isOnline(),
    config: loadRunnerConfig()
  })

  if (target.type === 'remote') {
    win.loadURL(target.target)
  } else {
    win.loadFile(target.target)
  }
  return win
}

ipcMain.handle('app:version', () => app.getVersion())

app.whenReady().then(() => {
  createWindow()
})
