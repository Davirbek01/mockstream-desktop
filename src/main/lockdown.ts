// ============================================================================
// lockdown — secure exam mode (detect-and-flag) for the desktop shell.
// ----------------------------------------------------------------------------
// v1 is browser/Electron-feasible only: it does NOT attempt OS-level kernel
// blocking (alt-tab can't be truly prevented and shouldn't be). Instead it:
//
//   1. Kiosk fullscreen   — win.setFullScreen(true) + win.setKiosk(true) while
//                           an exam is active; restored on release.
//   2. Focus-loss flag    — counts window `blur` events during an exam and, when
//                           focus returns, pushes a warning + the running count
//                           to the renderer (via IPC → preload bridge) so the
//                           runner can display it (and, future, record it).
//   3. Escape-route block — swallows devtools/reload/view-source key combos via
//                           before-input-event, nulls the menu, auto-closes
//                           devtools, and suppresses Electron's default
//                           context-menu (the runner ships its own highlighter
//                           menu, which is untouched).
//
// Exam-active is detected purely from the URL path (see isExamPath): a skill
// segment (reading|listening|writing|speaking) followed by a non-empty id.
// `attachLockdown` wires the BrowserWindow up and returns a small controller so
// the rest of main can stay slim and testable.
// ============================================================================
import type { BrowserWindow, IpcMain } from 'electron'

const EXAM_SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const

/** True when the URL path is an active-exam route — a skill segment followed by
 *  a non-empty id, e.g. `/reading/cefr-12`, `/speaking/supabase:abc`. The picker
 *  (`/reading`), home (`/`) and results (`/results`) are NOT exam routes. Pure
 *  and unit-tested so the exam-active gate has no Electron dependency. */
export function isExamPath(pathname: string): boolean {
  if (!pathname) return false
  // Tolerate a full URL or a bare path; strip query/hash and any origin.
  let path = pathname
  const schemeIdx = path.indexOf('://')
  if (schemeIdx !== -1) {
    const afterScheme = path.slice(schemeIdx + 3)
    const slash = afterScheme.indexOf('/')
    path = slash === -1 ? '/' : afterScheme.slice(slash)
  }
  path = path.split('?')[0].split('#')[0]
  const segs = path.split('/').filter(Boolean)
  if (segs.length < 2) return false
  const [skill, id] = segs
  return (EXAM_SKILLS as readonly string[]).includes(skill) && id.trim().length > 0
}

export interface LockdownController {
  /** True while an exam route is engaged (kiosk + escape-block on). */
  readonly active: boolean
  /** Running count of focus-losses observed during the CURRENT exam session.
   *  Resets to 0 each time a new exam is entered. */
  readonly focusLossCount: number
  /** Re-evaluate exam-active from a navigation to `url` and engage/release. */
  handleNavigation(url: string): void
}

interface AttachOptions {
  /** Override the engage action (tests). Defaults to kiosk fullscreen. */
  engageWindow?: (win: BrowserWindow) => void
  /** Override the release action (tests). Defaults to exit kiosk/fullscreen. */
  releaseWindow?: (win: BrowserWindow) => void
}

/** Wire secure-exam lockdown onto a BrowserWindow. Returns a controller; main
 *  calls handleNavigation() from did-navigate / did-navigate-in-page. */
export function attachLockdown(
  win: BrowserWindow,
  ipcMain: IpcMain,
  opts: AttachOptions = {},
): LockdownController {
  let active = false
  let focusLossCount = 0
  // Set true on `blur` while an exam is active; on the next `focus` we know the
  // student returned to the window and surface the warning.
  let leftDuringExam = false

  const wc = win.webContents

  const engage = opts.engageWindow ?? ((w) => {
    try { w.setKiosk(true) } catch { /* platform may not support kiosk */ }
    try { w.setFullScreen(true) } catch { /* ignore */ }
  })
  const release = opts.releaseWindow ?? ((w) => {
    try { w.setKiosk(false) } catch { /* ignore */ }
    try { w.setFullScreen(false) } catch { /* ignore */ }
  })

  function pushState(): void {
    if (win.isDestroyed()) return
    wc.send('lockdown:state', { active, focusLossCount })
  }

  function engageLockdown(): void {
    if (active) return
    active = true
    focusLossCount = 0
    leftDuringExam = false
    engage(win)
    pushState()
  }

  function releaseLockdown(): void {
    if (!active) return
    active = false
    leftDuringExam = false
    release(win)
    pushState()
  }

  // --- Exam-active detection from navigation -------------------------------
  function handleNavigation(url: string): void {
    if (isExamPath(url)) engageLockdown()
    else releaseLockdown()
  }

  // --- Focus-loss detection + flag -----------------------------------------
  win.on('blur', () => {
    if (!active) return
    leftDuringExam = true
    focusLossCount += 1
    // Keep the renderer's count fresh even before focus returns.
    pushState()
  })
  win.on('focus', () => {
    if (!active || !leftDuringExam) return
    leftDuringExam = false
    // Tell the runner to surface the on-screen warning toast with the count.
    if (!win.isDestroyed()) {
      wc.send('lockdown:focus-loss', { focusLossCount })
    }
  })

  // --- Block escape routes (only meaningful while an exam is active) -------
  wc.on('before-input-event', (event, input) => {
    if (!active) return
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const ctrl = input.control || input.meta
    const shift = input.shift
    // F12 (devtools), Ctrl+Shift+I/J/C (devtools/inspect), Ctrl+R / Ctrl+Shift+R
    // (reload), Ctrl+U (view-source).
    const isDevtools = key === 'f12' || (ctrl && shift && (key === 'i' || key === 'j' || key === 'c'))
    const isReload = ctrl && key === 'r'
    const isViewSource = ctrl && key === 'u'
    if (isDevtools || isReload || isViewSource) {
      event.preventDefault()
    }
  })

  // Auto-close devtools if they ever open during an exam.
  wc.on('devtools-opened', () => {
    if (active) wc.closeDevTools()
  })

  // Suppress Electron's default context menu (reload/inspect). The runner's own
  // highlighter menu is a DOM element and is unaffected by this main-side block.
  wc.on('context-menu', (event) => {
    if (active) event.preventDefault()
  })

  // Renderer can pull the current count on mount (banner first paint).
  ipcMain.handle('lockdown:get-count', () => focusLossCount)
  ipcMain.handle('lockdown:get-active', () => active)

  return {
    get active() { return active },
    get focusLossCount() { return focusLossCount },
    handleNavigation,
  }
}
