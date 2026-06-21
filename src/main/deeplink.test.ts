import { expect, test } from 'vitest'
import { extractTgAuthPayload, deepLinkArg } from './deeplink'

test('extracts tgAuthResult from a hash fragment', () => {
  expect(extractTgAuthPayload('mockstream://tg-auth#tgAuthResult=eyJpZCI6MX0')).toBe('eyJpZCI6MX0')
})

test('extracts tgAuthResult from a query string', () => {
  expect(extractTgAuthPayload('mockstream://tg-auth?tgAuthResult=abc123')).toBe('abc123')
})

test('preserves the encoded payload verbatim (no decode)', () => {
  // base64url plus a trailing param — must stop at & and not be decoded.
  expect(extractTgAuthPayload('mockstream://tg-auth#tgAuthResult=a-b_c&x=1')).toBe('a-b_c')
})

test('returns null when there is no payload', () => {
  expect(extractTgAuthPayload('mockstream://tg-auth')).toBeNull()
  expect(extractTgAuthPayload('')).toBeNull()
})

test('deepLinkArg finds the mockstream:// argument', () => {
  const argv = ['C:/app/Mock Stream.exe', '--flag', 'mockstream://tg-auth#tgAuthResult=zzz']
  expect(deepLinkArg(argv)).toBe('mockstream://tg-auth#tgAuthResult=zzz')
})

test('deepLinkArg returns null without a mockstream arg', () => {
  expect(deepLinkArg(['C:/app/Mock Stream.exe', '--flag'])).toBeNull()
})
