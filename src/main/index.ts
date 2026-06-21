import { app, BrowserWindow, ipcMain, net, session } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import { resolveRunnerTarget } from './runner-target'
import { loadRunnerConfig } from './config'
import { startRunnerServer } from './runner-server'
import { extractTgAuthPayload, deepLinkArg } from './deeplink'
import { attachLockdown } from './lockdown'

const PROTOCOL = 'mockstream'

let mainWindow: BrowserWindow | null = null
// The base URL the window is currently serving (local runner server or remote/
// env URL). Remembered so a Telegram deep link can re-navigate the SAME runner
// with the #tgAuthResult payload appended, triggering its mount-time completion.
let currentRunnerBaseUrl: string | null = null

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

  // No application menu — also strips the default reload/devtools accelerators.
  win.setMenu(null)

  // Secure exam lockdown: kiosk fullscreen + focus-loss flag + escape-route
  // blocking, engaged only while a real exam route is active (detect-and-flag).
  const lockdown = attachLockdown(win, ipcMain)
  win.webContents.on('did-navigate', (_e, url) => lockdown.handleNavigation(url))
  win.webContents.on('did-navigate-in-page', (_e, url) => lockdown.handleNavigation(url))

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
      currentRunnerBaseUrl = baseUrl
      armFallback()
      await win.loadURL(baseUrl)
    } catch {
      currentRunnerBaseUrl = null
      await win.loadFile(config.localFallback)
    }
  } else if (target.type === 'remote') {
    currentRunnerBaseUrl = target.target
    armFallback()
    await win.loadURL(target.target)
  } else {
    currentRunnerBaseUrl = null
    await win.loadFile(target.target)
  }

  return win
}

/** Handle an incoming `mockstream://` deep link. For the Telegram return we
 *  pull the tgAuthResult payload off the URL, focus the window, and re-navigate
 *  the SAME runner base URL with `#tgAuthResult=<payload>` appended. The runner
 *  completes the login on mount (AuthContext → completeTelegramLogin reads the
 *  payload off window.location.href), so the reload remounts and finishes it. */
function handleDeepLink(url: string | undefined | null): void {
  if (!url) return
  const payload = extractTgAuthPayload(url)
  if (!payload) return

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (currentRunnerBaseUrl) {
      // payload is already URL-encoded by the bridge; pass it through unchanged
      // so completeTelegramLogin sees the same base64url it would on web.
      const sep = currentRunnerBaseUrl.includes('#') ? '&' : '#'
      void mainWindow.loadURL(`${currentRunnerBaseUrl}${sep}tgAuthResult=${payload}`)
    }
  }
}

ipcMain.handle('app:version', () => app.getVersion())

// Register the app as the handler for mockstream:// so Windows routes Telegram
// bridge returns (and the mobile-shared scheme) back to this app once installed.
// In dev (electron run via electron-vite) argv[1] is the entry script — pass the
// exec path + that arg so the scheme resolves to the running dev instance too.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolvePath(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  // Windows delivers the deep link as a command-line arg to the second instance.
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    handleDeepLink(deepLinkArg(argv))
  })

  // macOS delivers the deep link via open-url (warm or cold start).
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  app.whenReady().then(async () => {
    // Grant the microphone to the bundled runner so the Speaking exam can record
    // (Electron denies media by default). The runner is our own bundled origin.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'audioCapture')
    })
    mainWindow = await createWindow()
    // Cold start via the link on Windows: the URL is in this instance's argv.
    handleDeepLink(deepLinkArg(process.argv))
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = await createWindow()
  })
}
