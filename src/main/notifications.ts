// ============================================================================
// notifications — native OS notifications for the desktop shell.
// ----------------------------------------------------------------------------
// Two features, both desktop-only (the plain web runner never reaches here):
//
//  1. New published mock → native notification. The RUNNER's realtime watcher
//     calls window.desktop.notify({title,body,route}) (preload → 'notify:show'
//     IPC); attachNotifications() shows an Electron Notification and, on click,
//     focuses the window + (if route) re-navigates the runner to that path.
//
//  2. Practice reminder. A lightweight timer fires a gentle "ready to practice?"
//     notification ~30 min after launch, then every few hours, SUPPRESSED while
//     an exam route is active and skipped if any notification was shown recently
//     so it never stacks on top of a fresh new-mock toast.
//
// All notification calls are guarded by Notification.isSupported() so a platform
// without notification support simply no-ops. AppUserModelId is set by the
// caller (main) so Windows shows the app name/icon on the toast.
// ============================================================================
import { Notification } from 'electron'
import type { BrowserWindow, IpcMain } from 'electron'

// --- Named timing constants (kept here so they're easy to tune) -------------
/** First practice reminder fires this long after launch. */
export const FIRST_REMINDER_MS = 30 * 60 * 1000 // 30 min
/** Subsequent practice reminders fire on this repeat interval. */
export const REMINDER_REPEAT_MS = 3 * 60 * 60 * 1000 // every 3 hours
/** Don't fire a practice reminder if any notification fired within this window
 *  (avoids stacking a reminder right after a new-mock toast). */
export const RECENT_NOTIFY_QUIET_MS = 10 * 60 * 1000 // 10 min

export const PRACTICE_REMINDER_TITLE = '📚 Ready to practice?'
export const PRACTICE_REMINDER_BODY = `Open a mock on ${__BRAND_NAME__}.`

export interface ReminderDecisionInput {
  /** True while a real exam route is active (lockdown engaged). */
  examActive: boolean
  /** ms since the last notification of any kind was shown (Infinity if none). */
  msSinceLastNotify: number
}

/**
 * Decide whether a scheduled practice reminder should actually fire. Pure +
 * unit-tested so the suppression policy has no Electron dependency.
 *   - never during an exam (don't interrupt a student mid-test)
 *   - never if a notification fired within the recent-quiet window
 */
export function shouldFireReminder(input: ReminderDecisionInput): boolean {
  if (input.examActive) return false
  if (input.msSinceLastNotify < RECENT_NOTIFY_QUIET_MS) return false
  return true
}

export interface NotificationPayload {
  title: string
  body: string
  route?: string
}

export interface AttachNotificationsOptions {
  /** True while an exam route is active — wire this to the lockdown controller. */
  isExamActive: () => boolean
  /** Focus + restore the window (and navigate when a route is provided). */
  onActivate: (route?: string) => void
  /** Override the clock for tests. */
  now?: () => number
  /** Override timers for tests (defaults to global setTimeout/setInterval). */
  schedule?: {
    setTimeout: (cb: () => void, ms: number) => unknown
    setInterval: (cb: () => void, ms: number) => unknown
    clearTimeout: (h: unknown) => void
    clearInterval: (h: unknown) => void
  }
}

export interface NotificationsController {
  /** Show a notification immediately (used by the 'notify:show' IPC). */
  show: (payload: NotificationPayload) => void
  /** Stop the practice-reminder timers. */
  dispose: () => void
}

/**
 * Wire native notifications onto the app: registers the 'notify:show' IPC and
 * starts the practice-reminder schedule. Returns a controller (mostly for tests
 * / teardown). Safe to call once from main after the window is created.
 */
export function attachNotifications(
  win: BrowserWindow,
  ipcMain: IpcMain,
  opts: AttachNotificationsOptions,
): NotificationsController {
  const now = opts.now ?? Date.now
  const timers = opts.schedule ?? {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  }

  let lastNotifyAt = 0
  let hasNotified = false

  function show(payload: NotificationPayload): void {
    if (!payload?.title) return
    if (!Notification.isSupported()) return
    const n = new Notification({ title: payload.title, body: payload.body ?? '' })
    n.on('click', () => opts.onActivate(payload.route))
    n.show()
    lastNotifyAt = now()
    hasNotified = true
  }

  // Feature 1: renderer-driven notifications (new published mock, etc.).
  const onNotify = (_e: unknown, payload: NotificationPayload): void => {
    show(payload)
  }
  ipcMain.on('notify:show', onNotify)

  // Feature 2: practice reminder schedule.
  function maybeFireReminder(): void {
    const msSinceLastNotify = hasNotified ? now() - lastNotifyAt : Infinity
    if (!shouldFireReminder({ examActive: opts.isExamActive(), msSinceLastNotify })) return
    show({ title: PRACTICE_REMINDER_TITLE, body: PRACTICE_REMINDER_BODY })
  }

  let intervalHandle: unknown = null
  const firstHandle = timers.setTimeout(() => {
    maybeFireReminder()
    intervalHandle = timers.setInterval(maybeFireReminder, REMINDER_REPEAT_MS)
  }, FIRST_REMINDER_MS)

  return {
    show,
    dispose: () => {
      try {
        ipcMain.removeListener('notify:show', onNotify)
      } catch {
        /* ignore */
      }
      timers.clearTimeout(firstHandle)
      if (intervalHandle !== null) timers.clearInterval(intervalHandle)
    },
  }
}
