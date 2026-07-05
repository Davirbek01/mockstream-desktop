import { app, BrowserWindow, ipcMain, net, session, Tray, Menu, nativeImage } from 'electron'
import { join, resolve as resolvePath } from 'node:path'
import { resolveRunnerTarget } from './runner-target'
import { loadRunnerConfig } from './config'
import { startRunnerServer } from './runner-server'
import { extractTgAuthPayload, deepLinkArg } from './deeplink'
import { attachLockdown } from './lockdown'
import { attachNotifications, type NotificationsController } from './notifications'
import { attachAutoUpdater } from './updater'
import { getMachineId } from './machineId'
import { TRAY_ICON_DATA_URL, BEK_TRAY_ICON_DATA_URL, RECORD_TRAY_ICON_DATA_URL, NINERS_TRAY_ICON_DATA_URL, GLOBAL_TRAY_ICON_DATA_URL, ACHIEVERS_TRAY_ICON_DATA_URL, MUZAFFARS_TRAY_ICON_DATA_URL } from './tray-icon'

const PROTOCOL = __BRAND_PROTOCOL__
const APP_ID = __BRAND_APP_ID__
const BRAND_NAME = __BRAND_NAME__

// Launched at OS login (Windows/macOS register the app with `--hidden`): start in
// the tray without showing a window so broadcasts/reminders arrive silently in
// the background until the user opens it from the tray.
const startHidden = process.argv.includes('--hidden')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
// True once the user really wants to quit (tray Quit / app.quit for update). Until
// then, closing the window only HIDES it to the tray so notifications keep coming.
let isQuitting = false
// The base URL the window is currently serving (local runner server or remote/
// env URL). Remembered so a Telegram deep link can re-navigate the SAME runner
// with the #tgAuthResult payload appended, triggering its mount-time completion.
let currentRunnerBaseUrl: string | null = null
let notifications: NotificationsController | null = null
// The active lockdown controller, hoisted so the auto-updater can ask whether an
// exam is in progress before applying a "Restart to update" request.
let lockdownController: ReturnType<typeof attachLockdown> | null = null

/** Build the URL to navigate the current runner to a route path (e.g.
 *  `/reading/123`). The runner uses BrowserRouter, so routes are real paths off
 *  the base URL's origin. Returns null when there's no served base URL (offline
 *  fallback file://) or the route is empty. */
function runnerRouteUrl(route: string | undefined): string | null {
  if (!route || !currentRunnerBaseUrl) return null
  try {
    const u = new URL(currentRunnerBaseUrl)
    u.hash = ''
    u.search = ''
    u.pathname = route.startsWith('/') ? route : `/${route}`
    return u.toString()
  } catch {
    return null
  }
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    // Start hidden when launched at login; otherwise reveal after we maximize so
    // the window never flashes at the default size first.
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep renderer timers (the notification poll) running while the window is
      // hidden/minimized to the tray, so broadcasts still surface in the bg.
      backgroundThrottling: false
    }
  })

  // Fill the screen on launch (still resizable). F11 toggles true fullscreen;
  // Esc exits fullscreen.
  win.maximize()
  if (!startHidden) win.show()

  // Close-to-tray: the window keeps running in the background (so push broadcasts
  // + practice reminders still fire) until the user explicitly quits from the
  // tray. A real quit (tray Quit / auto-update relaunch) sets isQuitting first.
  win.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    win.hide()
  })
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
  lockdownController = lockdown
  win.webContents.on('did-navigate', (_e, url) => lockdown.handleNavigation(url))
  win.webContents.on('did-navigate-in-page', (_e, url) => lockdown.handleNavigation(url))

  // Native notifications: new-published-mock toasts (renderer-driven) + a gentle
  // practice reminder. Reuses the lockdown controller's exam-active state to
  // suppress reminders during a test. Clicking a notification focuses the window
  // and (for a new-mock toast) navigates the runner to the mock's route.
  notifications?.dispose()
  notifications = attachNotifications(win, ipcMain, {
    isExamActive: () => lockdown.active,
    onActivate: (route) => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      const url = runnerRouteUrl(route)
      if (url) void win.loadURL(url)
    },
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

/** Reveal + focus the main window from the tray / a notification click. */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  // Windows foreground-lock: a background process (tray click / re-launch) often
  // can't steal focus, so the window would appear BEHIND other windows or just
  // flash the taskbar. A brief alwaysOnTop toggle reliably pops it to the front.
  mainWindow.setAlwaysOnTop(true)
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(false)
}

/** System-tray icon so the app keeps running (and receiving notifications) after
 *  the window is closed. Left-click opens the window; the menu offers Open/Quit. */
function createTray(): void {
  if (tray) return
  const TRAY_BY_PROTOCOL: Record<string, string> = {
    mockstreambek: BEK_TRAY_ICON_DATA_URL,
    mockstreamrecord: RECORD_TRAY_ICON_DATA_URL,
    mockstreamniners: NINERS_TRAY_ICON_DATA_URL,
    mockstreamglobal: GLOBAL_TRAY_ICON_DATA_URL,
    mockstreamachievers: ACHIEVERS_TRAY_ICON_DATA_URL,
    mockstreammuzaffars: MUZAFFARS_TRAY_ICON_DATA_URL,
  }
  const icon = nativeImage.createFromDataURL(
    TRAY_BY_PROTOCOL[__BRAND_PROTOCOL__] || TRAY_ICON_DATA_URL
  )
  tray = new Tray(icon)
  tray.setToolTip(BRAND_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${BRAND_NAME}`, click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}

ipcMain.handle('app:version', () => app.getVersion())

// Hardware-backed machine id for the runner's device id (stable across app-data
// clears / reinstalls, unlike localStorage). Hashed in main; '' if unreadable.
ipcMain.handle('app:machineId', () => getMachineId())

// CORS-free text fetch for the runner's scoring rubric. The browser blocks
// reading mock-stream.com/scoring-prompts.js from the 127.0.0.1 origin (no CORS
// header), which broke AI grading on desktop. The main process (Node) has no
// CORS, so we fetch it here. Allow-listed to the scoring-prompts file only.
ipcMain.handle('net:fetchText', async (_e, url: unknown): Promise<string | null> => {
  if (typeof url !== 'string') return null
  let ok = false
  try {
    const u = new URL(url)
    ok = u.protocol === 'https:' && u.hostname === 'mock-stream.com' && u.pathname === '/scoring-prompts.js'
  } catch {
    return null
  }
  if (!ok) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
})

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
    // Re-launching (e.g. tapping the desktop icon) while the app is hidden to the
    // tray must SHOW the window — a hidden window can't be focused, so the old
    // restore()+focus() did nothing and the app looked like it wouldn't reopen.
    // showMainWindow() restores-if-minimized, shows, and focuses.
    showMainWindow()
    handleDeepLink(deepLinkArg(argv))
  })

  // macOS delivers the deep link via open-url (warm or cold start).
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleDeepLink(url)
  })

  app.whenReady().then(async () => {
    // Windows shows the AppUserModelId's app name/icon on notification toasts;
    // it must match electron-builder's appId so installed builds resolve the
    // Start-menu shortcut (and thus the app name/icon) for the toast.
    app.setAppUserModelId(APP_ID)
    // Grant the microphone to the bundled runner so the Speaking exam can record
    // (Electron denies media by default). The runner is our own bundled origin.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'audioCapture')
    })
    mainWindow = await createWindow()
    // Keep running in the system tray after the window is closed, and launch at
    // OS login (packaged only — never register the dev electron.exe). Combined,
    // broadcasts + reminders reach the user even with the window closed.
    createTray()
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    }
    // Cold start via the link on Windows: the URL is in this instance's argv.
    handleDeepLink(deepLinkArg(process.argv))
    // Background auto-update (packaged Windows only; installs on next quit, or
    // immediately when the user clicks "Restart to update" outside an exam).
    attachAutoUpdater(() => mainWindow, () => !!lockdownController?.active)
  })

  // A real quit was requested (tray Quit, or the auto-updater relaunch) — let the
  // window 'close' handler through instead of hiding to tray.
  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('window-all-closed', () => {
    // The window normally only hides (close-to-tray), so this fires only on a real
    // quit — honour it everywhere except macOS, where tray apps stay resident.
    if (process.platform !== 'darwin' && isQuitting) app.quit()
  })

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow()
    } else {
      // Window exists but may be hidden in the tray — reveal it.
      showMainWindow()
    }
  })
}
