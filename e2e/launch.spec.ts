import { test, expect, _electron as electron } from '@playwright/test'

test('app launches and exposes version over IPC', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const window = await app.firstWindow()
  await expect(window).toBeTruthy()

  await window.waitForFunction(() => (window as any).desktop !== undefined)

  const version = await window.evaluate(async () => {
    // @ts-ignore - injected by preload
    return await window.desktop.appVersion()
  })
  expect(typeof version).toBe('string')
  expect(version.length).toBeGreaterThan(0)

  await app.close()
})
