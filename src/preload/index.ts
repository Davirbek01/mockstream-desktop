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
})
