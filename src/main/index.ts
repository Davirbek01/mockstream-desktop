import { app, BrowserWindow, ipcMain, net } from 'electron'
import { join } from 'node:path'
import { resolveRunnerTarget } from './runner-target'
import { loadRunnerConfig } from './config'
import { startRunnerServer } from './runner-server'

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<BrowserWindow> {
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

  // Fill the screen on launch (still resizable). F11 toggles true fullscreen;
  // Esc exits fullscreen.
  win.maximize()
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false)
    }
  })

  const config = loadRunnerConfig({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  })
  const target = resolveRunnerTarget({ online: net.isOnline(), config })

  // Safety net: if the main frame fails to load, drop to the offline fallback.
  const armFallback = (): void => {
    win.webContents.once('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) win.loadFile(config.localFallback)
    })
  }

  if (target.type === 'bundled') {
    // Serve the bundled runner SPA from a local http server so BrowserRouter
    // (history routing) works — file:// would break deep links/refresh.
    try {
      const baseUrl = await startRunnerServer(target.target)
      armFallback()
      await win.loadURL(baseUrl)
    } catch {
      await win.loadFile(config.localFallback)
    }
  } else if (target.type === 'remote') {
    armFallback()
    await win.loadURL(target.target)
  } else {
    await win.loadFile(target.target)
  }

  return win
}

ipcMain.handle('app:version', () => app.getVersion())

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    mainWindow = await createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createWindow()
  })
}
