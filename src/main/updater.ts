// ============================================================================
// main/updater — silent auto-update via electron-updater (Windows NSIS).
// ----------------------------------------------------------------------------
// The packaged app checks the GCS "generic" feed (configured in
// electron-builder.yml `publish`) for a newer version, downloads it in the
// background, and installs it the next time the user QUITS the app — so a new
// build reaches students/you without a manual reinstall.
//
// Safety choices:
//   • Only runs in PACKAGED builds — dev (electron-vite) has no app-update.yml,
//     and `app.isPackaged` is false there, so we no-op.
//   • An update found in the first minutes after launch is applied THERE AND
//     THEN, the way a phone applies its OTA: the renderer shows a "Downloading
//     update…" screen with progress and the app restarts into the new version
//     by itself - no "Restart to update" to press. "Later" steps out of that
//     and falls back to the quiet path below.
//   • autoInstallOnAppQuit = true → never interrupts an in-progress exam; an
//     update found mid-session is applied on the next normal quit.
//   • All errors are swallowed (offline, feed missing, signature checks): an
//     update problem must NEVER block the app from running.
//   • Windows NSIS updates are verified by the sha512 in latest.yml, so this
//     works while the app is still unsigned (a CA cert later just removes the
//     SmartScreen prompt — it isn't required for the update mechanism).
// ============================================================================
import { app, ipcMain, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const SIX_HOURS = 6 * 60 * 60 * 1000
/** How long after launch an update still counts as "while starting up", and so
 *  may install itself without asking. Long enough to cover a slow download on a
 *  slow connection, short enough that a student who has settled into the app is
 *  never restarted under their hands. */
const STARTUP_WINDOW = 5 * 60 * 1000
/** Let the "Installing update…" frame paint before the app goes away. */
const PAINT_MS = 1200

/** Wire background update checks.
 *  @param getWindow    yields the current main window (or null) so we can ping
 *                      the renderer when an update is ready.
 *  @param isExamActive guard so a "Restart to update" request is ignored while
 *                      a student is mid-exam (it still applies on the next quit
 *                      via autoInstallOnAppQuit). */
export function attachAutoUpdater(
  getWindow: () => BrowserWindow | null,
  isExamActive: () => boolean = () => false,
): void {
  // The renderer's "Restart to update" button asks main to apply the update now
  // — but never mid-exam. Registered even in dev so the IPC channel exists; it
  // only acts once an update has actually been downloaded.
  // "Later" is wired below, once armRestart exists. A startup update has no
  // "Later" at all — it is applied, full stop; this only ever postpones the
  // mid-session countdown.
  let snooze: () => void = () => {}
  ipcMain.on('update:later', () => snooze())

  ipcMain.on('update:restart', () => {
    if (isExamActive()) return // never interrupt an exam; applies on next quit
    try {
      autoUpdater.quitAndInstall()
    } catch (err) {
      console.warn('[updater] quitAndInstall failed:', (err as Error)?.message ?? err)
    }
  })

  // Dev / unpacked has no update metadata — skip the background checks.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const launchedAt = Date.now()
  /** Latched the moment we decide to apply an update at launch. The startup
   *  window gates STARTING the download, never finishing it: the macOS build
   *  is >200 MB, and on a slow line the download outlives five minutes. When
   *  the window was re-checked per event, the progress bar froze at whatever
   *  percent the clock ran out on and the screen then vanished — the student
   *  gained nothing and still had to quit twice for the update to land. */
  let installAtLaunch = false
  /** Starting up and nobody mid-exam. */
  const mayInstallNow = () => {
    if (isExamActive()) return false
    if (installAtLaunch) return true
    if (Date.now() - launchedAt >= STARTUP_WINDOW) return false
    installAtLaunch = true
    return true
  }
  const toRenderer = (channel: string, payload: unknown) => {
    try {
      getWindow()?.webContents.send(channel, payload)
    } catch {
      /* renderer gone - ignore */
    }
  }

  // Tell the renderer as soon as there is something to wait for, so the screen
  // says "Downloading update…" instead of sitting silent.
  autoUpdater.on('update-available', (info) => {
    if (!mayInstallNow()) return
    toRenderer('update:progress', { phase: 'downloading', version: info?.version ?? '', percent: 0 })
  })

  autoUpdater.on('download-progress', (p) => {
    if (!mayInstallNow()) return
    toRenderer('update:progress', { phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))) })
  })

  /** Seconds of warning before a mid-session restart. Long enough to finish a
   *  sentence and put a pen down, short enough that nobody wanders off. */
  const RESTART_COUNTDOWN = 60
  /** How long "Later" buys. It postpones, it does not cancel: the whole point
   *  of the mid-session countdown is that a machine left open for weeks still
   *  ends up on the new build. */
  const SNOOZE = 30 * 60 * 1000
  let countdownTimer: NodeJS.Timeout | null = null
  let snoozeTimer: NodeJS.Timeout | null = null
  /** Warn, count down, restart. An exam that starts mid-countdown cancels it;
   *  we go back to waiting and try again once the exam is over. */
  const armRestart = (version: string) => {
    if (countdownTimer || snoozeTimer) return
    snooze = () => {
      if (countdownTimer) clearInterval(countdownTimer)
      countdownTimer = null
      toRenderer('update:progress', { phase: 'idle' })
      if (snoozeTimer) clearTimeout(snoozeTimer)
      snoozeTimer = setTimeout(() => {
        snoozeTimer = null
        armRestart(version)
      }, SNOOZE)
    }
    let left = RESTART_COUNTDOWN
    countdownTimer = setInterval(() => {
      if (isExamActive()) {
        // Put it away and re-arm later — a restart must never land on an exam.
        left = RESTART_COUNTDOWN
        toRenderer('update:progress', { phase: 'idle' })
        return
      }
      if (left > 0) {
        toRenderer('update:progress', { phase: 'restarting', version, seconds: left })
        left -= 1
        return
      }
      if (countdownTimer) clearInterval(countdownTimer)
      countdownTimer = null
      toRenderer('update:progress', { phase: 'installing', version })
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall()
        } catch (err) {
          console.warn('[updater] quitAndInstall failed:', (err as Error)?.message ?? err)
          // Fall back to the old path so the student still has a way through.
          toRenderer('update:progress', { phase: 'idle' })
          try {
            getWindow()?.webContents.send('update:downloaded', { version })
          } catch { /* renderer gone — ignore */ }
        }
      }, PAINT_MS)
    }, 1000)
  }

  autoUpdater.on('update-downloaded', (info) => {
    // Found while starting up: apply it now, like a phone does.
    if (mayInstallNow()) {
      toRenderer('update:progress', { phase: 'installing', version: info?.version ?? '' })
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall()
        } catch (err) {
          console.warn('[updater] quitAndInstall failed:', (err as Error)?.message ?? err)
          toRenderer('update:progress', { phase: 'idle' })
        }
      }, PAINT_MS)
      return
    }
    // Found mid-session. Waiting for a quit is not good enough: the window
    // hides to tray rather than quitting, so a machine left open at a centre
    // can sit on an old build for weeks with the download already staged.
    // Warn, count down, and restart — but never while an exam is running.
    if (Notification.isSupported()) {
      new Notification({
        title: 'Update ready',
        body: `${__BRAND_NAME__} ${info.version} is about to install.`,
      }).show()
    }
    armRestart(info?.version ?? '')
  })

  // Never let an update error surface to the user or block the app. The
  // renderer MUST be told: the overlay covers the whole app while it thinks a
  // download is running, so a connection that drops mid-download used to leave
  // a frozen percentage over an app the student could no longer use.
  autoUpdater.on('error', (err) => {
    console.warn('[updater] check failed:', err?.message ?? err)
    installAtLaunch = false
    toRenderer('update:progress', { phase: 'idle' })
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] check failed:', err?.message ?? err)
    })
  }

  // Check shortly after launch, then on a 6-hour cadence.
  check()
  setInterval(check, SIX_HOURS)

  // Also re-check whenever the user returns focus to the app (throttled to once
  // a minute), so a freshly published update is noticed promptly — no relaunch
  // or waiting for the 6h timer. This is what surfaces the "Restart to update"
  // banner shortly after you click back into the window.
  let lastFocusCheck = 0
  app.on('browser-window-focus', () => {
    const now = Date.now()
    if (now - lastFocusCheck < 60_000) return
    lastFocusCheck = now
    check()
  })
}
