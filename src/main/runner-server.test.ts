import { describe, it, expect } from 'vitest'
import { contentTypeFor, isSpaFallback } from './runner-server'

describe('contentTypeFor', () => {
  it('maps common static asset extensions', () => {
    expect(contentTypeFor('/assets/index.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('/assets/index.mjs')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('/assets/index.css')).toBe('text/css; charset=utf-8')
    expect(contentTypeFor('/index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('/favicon.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('/icon.png')).toBe('image/png')
    expect(contentTypeFor('/photo.jpg')).toBe('image/jpeg')
    expect(contentTypeFor('/photo.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('/anim.gif')).toBe('image/gif')
    expect(contentTypeFor('/font.woff2')).toBe('font/woff2')
    expect(contentTypeFor('/font.woff')).toBe('font/woff')
    expect(contentTypeFor('/data.json')).toBe('application/json; charset=utf-8')
    expect(contentTypeFor('/me.webp')).toBe('image/webp')
    expect(contentTypeFor('/sound.mp3')).toBe('audio/mpeg')
  })

  it('uppercase extensions resolve too', () => {
    expect(contentTypeFor('/LOGO.PNG')).toBe('image/png')
  })

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('/weird.xyz')).toBe('application/octet-stream')
  })
})

describe('isSpaFallback', () => {
  it('treats extensionless paths as SPA routes', () => {
    expect(isSpaFallback('/')).toBe(true)
    expect(isSpaFallback('/reading')).toBe(true)
    expect(isSpaFallback('/listening/mock/1')).toBe(true)
  })

  it('does not treat asset paths (with extension) as SPA routes', () => {
    expect(isSpaFallback('/assets/index.js')).toBe(false)
    expect(isSpaFallback('/favicon.svg')).toBe(false)
    expect(isSpaFallback('/index.html')).toBe(false)
  })

  it('ignores query strings when deciding', () => {
    expect(isSpaFallback('/reading?mock=1')).toBe(true)
    expect(isSpaFallback('/assets/x.js?v=2')).toBe(false)
  })
})
