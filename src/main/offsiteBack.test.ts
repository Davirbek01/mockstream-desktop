import { expect, test } from 'vitest'
import { backButtonScript, isOffsite } from './offsiteBack'

const BASE = 'http://127.0.0.1:51234/'

test('Google, Supabase and the Telegram bridge are offsite', () => {
  expect(isOffsite('https://accounts.google.com/o/oauth2/v2/auth?x=1', BASE)).toBe(true)
  expect(isOffsite('https://abc.supabase.co/auth/v1/authorize?provider=google', BASE)).toBe(true)
  expect(isOffsite('https://mock-stream.com/tg-login.html?desktop=1', BASE)).toBe(true)
})

test('the runner itself, including exam routes, is never offsite', () => {
  expect(isOffsite('http://127.0.0.1:51234/', BASE)).toBe(false)
  expect(isOffsite('http://127.0.0.1:51234/reading/cefr-12#x', BASE)).toBe(false)
  expect(isOffsite('http://127.0.0.1:51234/?code=abc', BASE)).toBe(false)
})

test('a different local port is another origin', () => {
  expect(isOffsite('http://127.0.0.1:9999/', BASE)).toBe(true)
})

test('no base (offline fallback), file:// and garbage are not offsite', () => {
  expect(isOffsite('https://accounts.google.com/', null)).toBe(false)
  expect(isOffsite('file:///C:/app/fallback.html', BASE)).toBe(false)
  expect(isOffsite('not a url', BASE)).toBe(false)
  expect(isOffsite('', BASE)).toBe(false)
})

test('the injected script is valid JS and carries the base safely quoted', () => {
  const tricky = "http://127.0.0.1:5/'\"</script>"
  const src = backButtonScript(tricky, '← Orqaga')
  expect(() => new Function(src)).not.toThrow()
  expect(src).toContain(JSON.stringify(tricky))
})
