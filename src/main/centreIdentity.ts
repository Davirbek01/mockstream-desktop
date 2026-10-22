// ============================================================================
// main/centreIdentity — wear the picked centre's face.
// ----------------------------------------------------------------------------
// One build now serves every centre (the runner asks the student which one on
// first entry). The shell still has to LOOK like that centre, and on Windows
// that is four different things with four different rules:
//
//   • window title — win.setTitle, live.
//   • Dock icon on macOS — app.dock.setIcon, live, but only while running (the
//     .app bundle icon itself is fixed; that is as far as macOS lets us go).
//   • the Start-menu / desktop icon — baked into the .exe at build time and NOT
//     changeable. So we write SHORTCUTS of our own instead, named after the
//     centre and carrying its .ico. The installer's own "Mock Stream" shortcut
//     is left alone: it is the one the uninstaller knows about.
//   • the TASKBAR button icon — the one that first surprised us. Windows groups
//     taskbar buttons by AppUserModelID and takes the button's icon from the
//     Start-menu shortcut registered for that id, NOT from win.setIcon. So a
//     centre needs its own AppUserModelID *and* a matching Start-menu shortcut
//     carrying its icon. The id can only be set before the first window opens,
//     so a pick restarts the app — which is what the Settings copy promises.
//     That same shortcut is what Windows toast notifications resolve, so the
//     notification name and icon follow the centre for free.
//
// The centre id arrives from the renderer, so it is validated against this map
// and the brand NAME is taken from here, never from the message.
// ============================================================================
import { app, nativeImage, shell, type BrowserWindow, type IpcMain } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The eight centres, shell-side. Mirrors the runner's config/brand.ts. */
export const CENTRE_NAMES: Record<string, string> = {
  mock_stream: 'Mock Stream',
  bek: 'Bekzods Multilevel',
  record: 'Cambridge Innovation School',
  niners: 'Niners Academy',
  global: 'Global Education LC',
  achievers: 'Achievers Academy',
  muzaffars: "Muzaffar's English",
  max: 'Multilevel Max',
}

interface Stored {
  /** The centre the shell is wearing — read before the first window opens,
   *  because the AppUserModelID has to be set by then. */
  centre?: string
  /** Full paths of the shortcuts WE wrote, so we can take them back later. */
  shortcut?: string
  startMenu?: string
}

let currentName = ''
let bootAumid = ''
const listeners = new Set<(centreId: string, name: string) => void>()

/** The brand the window should be wearing right now — the picked centre's name
 *  once one is known, else '' so the caller keeps its build-time brand. */
export function currentBrandName(): string {
  return currentName
}

/** Called whenever the worn centre changes (the tray rebuilds on it). */
export function onCentreChange(cb: (centreId: string, name: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function iconDir(): string {
  // Packaged: extraResources drops the folder beside the asar. Dev: the main
  // bundle lives in out/main, two levels under the repo root.
  return app.isPackaged
    ? join(process.resourcesPath, 'centre-icons')
    : join(__dirname, '../../build/centre-icons')
}

function statePath(): string {
  return join(app.getPath('userData'), 'centre-identity.json')
}

function readState(): Stored {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as Stored
  } catch {
    return {}
  }
}

function writeState(s: Stored): void {
  try {
    writeFileSync(statePath(), JSON.stringify(s), 'utf8')
  } catch {
    /* a read-only profile just loses the ability to clean up the old shortcut */
  }
}

/** Windows forbids these in a file name; an apostrophe (Muzaffar's) is fine. */
function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Mock Stream'
}

/** The AppUserModelID a centre's window, shortcuts and toasts share.
 *  Mock Stream keeps the plain app id, so the installer's own shortcut, its
 *  taskbar pin and its toasts all carry on untouched. */
function aumidFor(centreId: string): string {
  return centreId && centreId !== 'mock_stream'
    ? `${__BRAND_APP_ID__}.${centreId}`
    : __BRAND_APP_ID__
}

/** The centre's icon as an image. null when the file is missing, so the caller
 *  keeps the build's own icon rather than showing nothing. */
export function centreIconImage(centreId: string): Electron.NativeImage | null {
  try {
    const png = join(iconDir(), `${centreId}.png`)
    if (!existsSync(png)) return null
    const img = nativeImage.createFromPath(png)
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

/** Called once before the first window is created: adopt the stored centre's
 *  AppUserModelID and name, so the taskbar button, the toasts and the window
 *  are that centre's from the very first frame. Returns its icon, if any. */
export function applyBootIdentity(): Electron.NativeImage | null {
  const centreId = readState().centre || ''
  const name = CENTRE_NAMES[centreId]
  bootAumid = aumidFor(name ? centreId : '')
  app.setAppUserModelId(bootAumid)
  if (!name) return null
  currentName = name
  return centreIconImage(centreId)
}

/** Put this centre's shortcuts on the desktop and in the Start menu, and take
 *  back the ones we wrote for the previous centre. Mock Stream gets none: the
 *  installer already made those, and duplicates would only puzzle the student.
 *
 *  The Start-menu one is not decoration — it is what Windows reads for the
 *  taskbar button icon and for toast notifications. */
function syncShortcuts(centreId: string, name: string): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const state = readState()
  const ico = join(iconDir(), `${centreId}.ico`)
  const own = centreId !== 'mock_stream'
  const file = `${safeFileName(name)}.lnk`
  const desktopLink = own ? join(app.getPath('desktop'), file) : ''
  const startLink = own
    ? join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', file)
    : ''

  for (const [old, next] of [
    [state.shortcut, desktopLink],
    [state.startMenu, startLink],
  ]) {
    if (old && old !== next) {
      try {
        rmSync(old, { force: true })
      } catch {
        /* the student may have moved or deleted it themselves — fine either way */
      }
    }
  }

  if (!own) {
    writeState({ centre: centreId })
    return
  }

  const options = {
    target: process.execPath,
    icon: existsSync(ico) ? ico : process.execPath,
    iconIndex: 0,
    description: name,
    appUserModelId: aumidFor(centreId),
  }
  const written: Stored = { centre: centreId }
  for (const [path, key] of [
    [desktopLink, 'shortcut'],
    [startLink, 'startMenu'],
  ] as const) {
    try {
      shell.writeShortcutLink(path, 'create', options)
      written[key] = path
    } catch {
      /* OneDrive-redirected desktops and locked-down profiles can refuse this;
         the window title and icons still carry the centre. */
    }
  }
  writeState(written)
}

/** Wear a centre: window title, window icon, Dock icon, and — only when the
 *  student has just PICKED it — the shortcuts. Returns true when the identity
 *  changed in a way only a restart can finish (the AppUserModelID). */
export function applyCentre(win: BrowserWindow | null, centreId: string, picked: boolean): boolean {
  const name = CENTRE_NAMES[centreId]
  if (!name) return false // unknown id: ignore rather than half-apply it
  currentName = name

  try {
    if (win && !win.isDestroyed()) win.setTitle(name)
  } catch {
    /* ignore */
  }

  const img = centreIconImage(centreId)
  if (img) {
    try {
      if (win && !win.isDestroyed()) win.setIcon(img)
      app.dock?.setIcon(img)
    } catch {
      /* ignore */
    }
  }

  if (picked) syncShortcuts(centreId, name)

  for (const cb of listeners) {
    try {
      cb(centreId, name)
    } catch {
      /* one bad listener must not stop the others */
    }
  }

  return picked && aumidFor(centreId) !== bootAumid
}

/** Wire the two messages the runner sends: `applied` on every launch (title +
 *  icons) and `picked` the first launch after a choice (shortcuts too, then a
 *  restart if the AppUserModelID moved — the taskbar button cannot change
 *  without one). */
export function attachCentreIdentity(win: BrowserWindow, ipc: IpcMain): void {
  ipc.on('centre:applied', (_e, centreId: unknown) => {
    if (typeof centreId === 'string') applyCentre(win, centreId, false)
  })
  ipc.on('centre:picked', (_e, centreId: unknown) => {
    if (typeof centreId !== 'string') return
    if (!applyCentre(win, centreId, true)) return
    // Relaunch WITHOUT --hidden: the student is sitting in front of the app,
    // not starting it at login.
    app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') })
    app.exit(0)
  })
}
