import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// --- Mock electron's Notification so no real OS toast is fired in tests. ----
const shownTitles: string[] = []
const clickHandlers: Array<(payload: { title: string; route?: string }) => void> = []
let notificationSupported = true

vi.mock('electron', () => {
  class FakeNotification {
    title: string
    body: string
    private handler: (() => void) | null = null
    constructor(opts: { title: string; body: string }) {
      this.title = opts.title
      this.body = opts.body
    }
    static isSupported() {
      return notificationSupported
    }
    on(_evt: string, cb: () => void) {
      this.handler = cb
    }
    show() {
      shownTitles.push(this.title)
      if (this.handler) clickHandlers.push(() => this.handler!())
    }
  }
  return { Notification: FakeNotification }
})

import {
  attachNotifications,
  shouldFireReminder,
  FIRST_REMINDER_MS,
  REMINDER_REPEAT_MS,
  RECENT_NOTIFY_QUIET_MS,
  PRACTICE_REMINDER_TITLE,
} from './notifications'

describe('shouldFireReminder', () => {
  test('suppressed during an active exam', () => {
    expect(shouldFireReminder({ examActive: true, msSinceLastNotify: Infinity })).toBe(false)
  })
  test('suppressed if a notification fired recently', () => {
    expect(shouldFireReminder({ examActive: false, msSinceLastNotify: RECENT_NOTIFY_QUIET_MS - 1 })).toBe(false)
  })
  test('fires when idle and outside the quiet window', () => {
    expect(shouldFireReminder({ examActive: false, msSinceLastNotify: RECENT_NOTIFY_QUIET_MS + 1 })).toBe(true)
    expect(shouldFireReminder({ examActive: false, msSinceLastNotify: Infinity })).toBe(true)
  })
})

// --- attachNotifications: schedule + suppression + IPC + click --------------
type IpcStub = {
  handlers: Record<string, (e: unknown, p: unknown) => void>
  on: (ch: string, cb: (e: unknown, p: unknown) => void) => void
  removeListener: (ch: string, cb: unknown) => void
}

function makeIpc(): IpcStub {
  const handlers: Record<string, (e: unknown, p: unknown) => void> = {}
  return {
    handlers,
    on(ch, cb) {
      handlers[ch] = cb
    },
    removeListener(ch) {
      delete handlers[ch]
    },
  }
}

function makeWin() {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(),
  }
}

/** Controllable fake timer set so we can fire the first delay + interval. */
function makeSchedule() {
  let firstCb: (() => void) | null = null
  let intervalCb: (() => void) | null = null
  return {
    runFirst: () => firstCb?.(),
    runInterval: () => intervalCb?.(),
    schedule: {
      setTimeout: (cb: () => void, _ms: number) => {
        firstCb = cb
        return 1
      },
      setInterval: (cb: () => void, _ms: number) => {
        intervalCb = cb
        return 2
      },
      clearTimeout: () => {},
      clearInterval: () => {},
    },
  }
}

describe('attachNotifications', () => {
  beforeEach(() => {
    shownTitles.length = 0
    clickHandlers.length = 0
    notificationSupported = true
  })
  afterEach(() => vi.clearAllMocks())

  test('notify:show IPC fires a notification and click activates with route', () => {
    const ipc = makeIpc()
    const win = makeWin()
    const onActivate = vi.fn()
    const sched = makeSchedule()
    attachNotifications(win as never, ipc as never, {
      isExamActive: () => false,
      onActivate,
      now: () => 1000,
      schedule: sched.schedule,
    })

    ipc.handlers['notify:show'](null, { title: 'New IELTS Reading mock added', body: 'x', route: '/reading/5' })
    expect(shownTitles).toEqual(['New IELTS Reading mock added'])

    clickHandlers[0]()
    expect(onActivate).toHaveBeenCalledWith('/reading/5')
  })

  test('practice reminder fires after the first delay when idle', () => {
    const ipc = makeIpc()
    const sched = makeSchedule()
    let t = 0
    attachNotifications(makeWin() as never, ipc as never, {
      isExamActive: () => false,
      onActivate: vi.fn(),
      now: () => t,
      schedule: sched.schedule,
    })
    t = FIRST_REMINDER_MS
    sched.runFirst()
    expect(shownTitles).toEqual([PRACTICE_REMINDER_TITLE])
  })

  test('practice reminder is suppressed while an exam is active', () => {
    const ipc = makeIpc()
    const sched = makeSchedule()
    attachNotifications(makeWin() as never, ipc as never, {
      isExamActive: () => true,
      onActivate: vi.fn(),
      now: () => FIRST_REMINDER_MS,
      schedule: sched.schedule,
    })
    sched.runFirst()
    expect(shownTitles).toEqual([])
  })

  test('practice reminder is suppressed right after a new-mock toast', () => {
    const ipc = makeIpc()
    const sched = makeSchedule()
    let t = 1000
    attachNotifications(makeWin() as never, ipc as never, {
      isExamActive: () => false,
      onActivate: vi.fn(),
      now: () => t,
      schedule: sched.schedule,
    })
    // A new-mock toast just fired at t=1000…
    ipc.handlers['notify:show'](null, { title: 'New mock added', body: 'x' })
    // …and the first reminder lands only a couple minutes later → suppressed.
    t = 1000 + (RECENT_NOTIFY_QUIET_MS - 1)
    sched.runFirst()
    expect(shownTitles).toEqual(['New mock added'])
  })

  test('no-op when Notification.isSupported() is false', () => {
    notificationSupported = false
    const ipc = makeIpc()
    const sched = makeSchedule()
    attachNotifications(makeWin() as never, ipc as never, {
      isExamActive: () => false,
      onActivate: vi.fn(),
      now: () => FIRST_REMINDER_MS,
      schedule: sched.schedule,
    })
    ipc.handlers['notify:show'](null, { title: 'x', body: 'y' })
    sched.runFirst()
    expect(shownTitles).toEqual([])
  })

  test('reminder repeat interval is scheduled after the first fire', () => {
    expect(REMINDER_REPEAT_MS).toBeGreaterThan(0)
    const ipc = makeIpc()
    const sched = makeSchedule()
    let t = FIRST_REMINDER_MS
    attachNotifications(makeWin() as never, ipc as never, {
      isExamActive: () => false,
      onActivate: vi.fn(),
      now: () => t,
      schedule: sched.schedule,
    })
    sched.runFirst() // fires reminder #1 and arms the interval
    t += REMINDER_REPEAT_MS
    sched.runInterval() // fires reminder #2
    expect(shownTitles).toEqual([PRACTICE_REMINDER_TITLE, PRACTICE_REMINDER_TITLE])
  })
})
