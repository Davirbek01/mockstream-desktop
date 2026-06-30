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
//   • autoInstallOnAppQuit = true → never interrupts an in-progress exam; the
//     update is applied on the next normal quit, not mid-session.
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

  autoUpdater.on('update-downloaded', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Update ready',
        body: `${__BRAND_NAME__} ${info.version} will install automatically next time you close the app.`,
      }).show()
    }
    try {
      getWindow()?.webContents.send('update:downloaded', { version: info.version })
    } catch {
      /* renderer gone — ignore */
    }
  })

  // Never let an update error surface to the user or block the app.
  autoUpdater.on('error', (err) => {
    console.warn('[updater] check failed:', err?.message ?? err)
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
