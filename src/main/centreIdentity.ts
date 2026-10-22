// ============================================================================
// main/centreIdentity — wear the picked centre's face.
// ----------------------------------------------------------------------------
// One build now serves every centre (the runner asks the student which one on
// first entry). The shell still has to LOOK like that centre, which on Windows
// means three different things, only one of which an app can change freely:
//
//   • the window + taskbar icon of the RUNNING app — `win.setIcon`, live.
//   • the Dock icon on macOS — `app.dock.setIcon`, live, but only while running.
//   • the icon in Start menu / on the desktop — baked into the .exe at build
//     time and NOT changeable. So we write a SHORTCUT of our own instead, named
//     after the centre and carrying its .ico. The installer's own "Mock Stream"
//     shortcut is left exactly as it is: it is the one the uninstaller knows
//     about, and removing it behind the user's back would be rude.
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
  /** Full path of the shortcut WE wrote, so we can take it back later. */
  shortcut?: string
}

let currentName = ''
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
  return name.replace(/[\/:*?"<>|]/g, '').trim() || 'Mock Stream'
}

/** Put a shortcut for this centre on the desktop and take back the one we wrote
 *  for the previous centre. Mock Stream gets none: the installer already made
 *  one, and a second identical icon would only puzzle the student. */
function syncShortcut(centreId: string, name: string): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const state = readState()
  const ico = join(iconDir(), `${centreId}.ico`)
  const target =
    centreId === 'mock_stream' ? '' : join(app.getPath('desktop'), `${safeFileName(name)}.lnk`)

  if (state.shortcut && state.shortcut !== target) {
    try {
      rmSync(state.shortcut, { force: true })
    } catch {
      /* the student may have moved or deleted it themselves — fine either way */
    }
  }

  if (!target) {
    writeState({})
    return
  }

  try {
    shell.writeShortcutLink(target, 'create', {
      target: process.execPath,
      icon: existsSync(ico) ? ico : process.execPath,
      iconIndex: 0,
      description: name,
    })
    writeState({ shortcut: target })
  } catch {
    /* OneDrive-redirected desktops and locked-down profiles can refuse this;
       the window and taskbar icon still carry the centre. */
  }
}

/** Wear a centre: window title, window/taskbar icon, Dock icon, and — only when
 *  the student has just PICKED it — the desktop shortcut. */
export function applyCentre(win: BrowserWindow | null, centreId: string, picked: boolean): void {
  const name = CENTRE_NAMES[centreId]
  if (!name) return // unknown id: ignore rather than half-apply it
  currentName = name

  try {
    if (win && !win.isDestroyed()) win.setTitle(name)
  } catch {
    /* ignore */
  }

  try {
    const png = join(iconDir(), `${centreId}.png`)
    if (existsSync(png)) {
      const img = nativeImage.createFromPath(png)
      if (!img.isEmpty()) {
        if (win && !win.isDestroyed()) win.setIcon(img)
        // macOS: the .app bundle icon is fixed, but the Dock follows this.
        app.dock?.setIcon(img)
      }
    }
  } catch {
    /* ignore */
  }

  if (picked) syncShortcut(centreId, name)

  for (const cb of listeners) {
    try {
      cb(centreId, name)
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/** Wire the two messages the runner sends: `applied` on every launch (icon +
 *  title only) and `picked` the first launch after a choice (shortcut too). */
export function attachCentreIdentity(win: BrowserWindow, ipc: IpcMain): void {
  ipc.on('centre:applied', (_e, centreId: unknown) => {
    if (typeof centreId === 'string') applyCentre(win, centreId, false)
  })
  ipc.on('centre:picked', (_e, centreId: unknown) => {
    if (typeof centreId === 'string') applyCentre(win, centreId, true)
  })
}

/** The centre's icon as an image, for the tray (which wants a small one).
 *  null when the file is missing, so the caller keeps the build's own icon. */
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
