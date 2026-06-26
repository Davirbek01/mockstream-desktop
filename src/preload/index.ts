import { contextBridge, ipcRenderer } from 'electron'

// Mutable mirror of main's lockdown state, kept current by the `lockdown:state`
// IPC event so synchronous reads (window.desktop.lockdownActive) are cheap.
let lockdownActive = false
let focusLossCount = 0

ipcRenderer.on('lockdown:state', (_e, state: { active: boolean; focusLossCount: number }) => {
  lockdownActive = !!state?.active
  focusLossCount = state?.focusLossCount ?? focusLossCount
})

contextBridge.exposeInMainWorld('desktop', {
  // Lets the runner detect the packaged desktop shell so it can route the
  // Telegram bridge return through the allow-listed mockstream:// deep link
  // instead of the loopback origin (which the bridge rejects).
  isDesktop: true,
  appVersion: () => ipcRenderer.invoke('app:version'),
  platform: process.platform,

  /** Hardware-backed machine id (hashed in main). Used as the runner's device
   *  id so guest results history survives app-data clears / reinstalls.
   *  Resolves '' if the OS GUID can't be read (runner keeps its localStorage id). */
  machineId: (): Promise<string> => ipcRenderer.invoke('app:machineId'),

  // --- Native OS notifications -------------------------------------------
  /** Fire a native desktop notification. The main process shows an Electron
   *  Notification; clicking it focuses the window and (if `route` is given)
   *  navigates the runner to that path. Fire-and-forget. */
  notify(n: { title: string; body: string; route?: string }) {
    ipcRenderer.send('notify:show', n)
  },

  // --- Secure exam lockdown bridge ---------------------------------------
  /** True while an exam route is active (kiosk + escape-block engaged). Reads
   *  the locally-mirrored value updated by the `lockdown:state` event. */
  get lockdownActive() {
    return lockdownActive
  },
  /** Running focus-loss count for the current exam (mirrored locally). */
  getFocusLossCount: () => focusLossCount,
  /** Subscribe to lockdown active/count changes. Returns an unsubscribe fn. */
  onLockdownState(cb: (state: { active: boolean; focusLossCount: number }) => void) {
    const handler = (_e: unknown, state: { active: boolean; focusLossCount: number }) => {
      lockdownActive = !!state?.active
      focusLossCount = state?.focusLossCount ?? focusLossCount
      cb(state)
    }
    ipcRenderer.on('lockdown:state', handler)
    return () => ipcRenderer.removeListener('lockdown:state', handler)
  },
  /** Subscribe to focus-loss events (student returned after leaving the window).
   *  The callback receives the running count. Returns an unsubscribe fn. */
  onFocusLoss(cb: (count: number) => void) {
    const handler = (_e: unknown, payload: { focusLossCount: number }) => {
      focusLossCount = payload?.focusLossCount ?? focusLossCount
      cb(focusLossCount)
    }
    ipcRenderer.on('lockdown:focus-loss', handler)
    return () => ipcRenderer.removeListener('lockdown:focus-loss', handler)
  },

  // --- CORS-free text fetch (main process) -------------------------------
  /** Fetch a text resource via the MAIN process (Node — no browser CORS). Used
   *  by the runner to load the scoring rubric (mock-stream.com/scoring-prompts.js),
   *  which sends no CORS header and is otherwise blocked from the 127.0.0.1
   *  origin. Main allow-lists the URL. Resolves null on any failure. */
  fetchText(url: string): Promise<string | null> {
    return ipcRenderer.invoke('net:fetchText', url)
  },

  // --- Auto-update bridge ------------------------------------------------
  /** Subscribe to "a new version finished downloading and is ready to install".
   *  The runner shows an "Update ready — Restart to update" banner. Returns an
   *  unsubscribe fn. */
  onUpdateReady(cb: (info: { version: string }) => void) {
    const handler = (_e: unknown, info: { version: string }) => cb(info)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
  /** Apply the downloaded update now: the main process quits, installs it, and
   *  relaunches into the new version. Ignored by main while an exam is active. */
  restartToUpdate() {
    ipcRenderer.send('update:restart')
  },
})
