import { defineConfig } from 'electron-vite'

// ============================================================================
// Build-time flavor (white-label desktop). FLAVOR=bek builds the "Bekzods
// Multilevel" desktop app; unset / anything else = Mock Stream, byte-identical
// to before (defaults below MATCH the previous hardcoded values exactly).
//
// The brand identity is baked into the main-process bundle via Vite `define`,
// so the packaged app carries its own name / protocol / appId with no runtime
// env needed. The bundled runner's CENTRE comes separately from VITE_CENTER_ID
// when the runner is built (see the dist:bek script).
// ============================================================================
const FLAVOR = process.env.FLAVOR || 'mock_stream'
const BRANDS: Record<string, { name: string; protocol: string; appId: string }> = {
  mock_stream: { name: 'Mock Stream', protocol: 'mockstream', appId: 'app.mockstream.desktop' },
  bek: { name: 'Bekzods Multilevel', protocol: 'mockstreambek', appId: 'app.mockstream.bek.desktop' },
  record: { name: 'Cambridge Innovation School', protocol: 'mockstreamrecord', appId: 'app.mockstream.record.desktop' },
}
const brand = BRANDS[FLAVOR] || BRANDS.mock_stream
const brandDefine = {
  __BRAND_NAME__: JSON.stringify(brand.name),
  __BRAND_PROTOCOL__: JSON.stringify(brand.protocol),
  __BRAND_APP_ID__: JSON.stringify(brand.appId),
}

export default defineConfig({
  main: {
    define: brandDefine,
    build: { rollupOptions: { input: 'src/main/index.ts' } }
  },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: 'src/renderer/fallback.html' } }
  }
})
