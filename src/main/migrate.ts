// ============================================================================
// main/migrate — move a clone app onto the one shared app.
// ----------------------------------------------------------------------------
// One build now serves every centre, so the seven clone desktop apps are being
// retired. A clone's final release shows the student a notice and this is what
// the button behind it does.
//
// It deliberately reuses electron-updater rather than downloading an installer
// by hand: the feed is simply pointed at the shared app's one, and everything
// that already works for an ordinary update — sha512 verification, resumable
// download, progress events the renderer is already listening to, a silent
// install, relaunch — works here too. The only difference is WHICH app comes
// down, and the installer on the other end knows to remove this one
// (build/installer.nsh).
//
// The centre is not lost in the move: every flavour shares one user-data
// folder and the runner is served from the same loopback origin in all of
// them, so the clone writes `ms_active_centre` into localStorage before
// starting and the shared app reads it back on its first launch.
//
// macOS is NOT handled here. There the installer is a .dmg the student has to
// drag into Applications, so the notice opens the download page instead.
// ============================================================================
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/** The shared app's update feed — the same one Mock Stream itself installs
 *  from. R2 serves the binaries; GCS holds a copy of the manifests.
 *
 *  MS_MIGRATION_FEED overrides it, so the whole hand-off can be rehearsed
 *  against a local feed without publishing anything. Nothing sets that
 *  variable in a student's install. */
const SHARED_FEED =
  process.env.MS_MIGRATION_FEED || 'https://audio.mock-stream.com/desktop/mockstream'

export function attachMigration(
  getWindow: () => BrowserWindow | null,
  isExamActive: () => boolean = () => false,
): void {
  let started = false

  ipcMain.on('migrate:start', () => {
    const send = (phase: string, extra: Record<string, unknown> = {}) =>
      getWindow()?.webContents.send('migrate:progress', { phase, ...extra })

    // Never mid-exam, and never twice.
    if (isExamActive()) return send('error', { message: 'An exam is in progress.' })
    if (started) return
    if (!app.isPackaged) return send('error', { message: 'Only a packaged app can migrate.' })
    started = true

    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: SHARED_FEED })
      // The shared app's version may be at or below this clone's, depending on
      // which shipped last. This is a migration, not a version race.
      autoUpdater.allowDowngrade = true
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = false

      autoUpdater.once('update-downloaded', () => {
        send('installing')
        // Let the frame paint before the app goes away under the student.
        setTimeout(() => {
          try {
            autoUpdater.quitAndInstall()
          } catch (err) {
            started = false
            send('error', { message: (err as Error)?.message ?? 'Install failed.' })
          }
        }, 1200)
      })

      // electron-updater will not fetch a build that is not NEWER than this
      // one, and allowDowngrade does not cover an equal version. So the shared
      // app must be released above every clone before the migration is turned
      // on — and if that is ever forgotten, say so instead of leaving the
      // student watching "Finding the new app…" forever (which is exactly what
      // the first run of this did, 2026-10-23).
      autoUpdater.once('update-not-available', (info) => {
        started = false
        send('error', {
          message: `The shared app (${info?.version ?? '?'}) is not newer than this one (${app.getVersion()}).`,
        })
      })

      autoUpdater.once('error', (err) => {
        started = false
        send('error', { message: err?.message ?? 'Download failed.' })
      })

      autoUpdater.on('download-progress', (p) => {
        send('downloading', { percent: Math.round(p.percent) })
      })

      send('checking')
      autoUpdater.checkForUpdates().catch((err: Error) => {
        started = false
        send('error', { message: err?.message ?? 'Could not reach the download.' })
      })
    } catch (err) {
      started = false
      send('error', { message: (err as Error)?.message ?? 'Migration could not start.' })
    }
  })
}
