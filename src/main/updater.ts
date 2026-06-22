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
import { app, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const SIX_HOURS = 6 * 60 * 60 * 1000

/** Wire background update checks. `getWindow` yields the current main window (or
 *  null) so we can ping the renderer when an update is ready. */
export function attachAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // Dev / unpacked has no update metadata — skip entirely.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Update ready',
        body: `Mock Stream ${info.version} will install automatically next time you close the app.`,
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
}
