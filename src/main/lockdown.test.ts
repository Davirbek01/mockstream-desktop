import { expect, test } from 'vitest'
import { isExamPath } from './lockdown'

test('skill segment + non-empty id is an exam path', () => {
  expect(isExamPath('/reading/cefr-12')).toBe(true)
  expect(isExamPath('/listening/53')).toBe(true)
  expect(isExamPath('/writing/abc')).toBe(true)
  expect(isExamPath('/speaking/supabase:xyz')).toBe(true)
})

test('home, picker and results are NOT exam paths', () => {
  expect(isExamPath('/')).toBe(false)
  expect(isExamPath('/reading')).toBe(false)
  expect(isExamPath('/listening')).toBe(false)
  expect(isExamPath('/writing')).toBe(false)
  expect(isExamPath('/speaking')).toBe(false)
  expect(isExamPath('/results')).toBe(false)
})

test('a skill segment with an empty id is not an exam path', () => {
  expect(isExamPath('/reading/')).toBe(false)
  expect(isExamPath('/reading//')).toBe(false)
})

test('unknown skill segments are not exam paths', () => {
  expect(isExamPath('/profile/123')).toBe(false)
  expect(isExamPath('/admin/reading')).toBe(false)
})

test('ignores query string and hash', () => {
  expect(isExamPath('/reading/cefr-12?foo=bar')).toBe(true)
  expect(isExamPath('/reading/cefr-12#section')).toBe(true)
  expect(isExamPath('/reading?exam=cefr')).toBe(false)
})

test('tolerates a full http(s) URL or loopback origin', () => {
  expect(isExamPath('http://127.0.0.1:5123/reading/cefr-12')).toBe(true)
  expect(isExamPath('http://localhost:5173/speaking/9')).toBe(true)
  expect(isExamPath('http://127.0.0.1:5123/reading')).toBe(false)
  expect(isExamPath('http://127.0.0.1:5123/')).toBe(false)
})

test('empty / falsy input is not an exam path', () => {
  expect(isExamPath('')).toBe(false)
})
