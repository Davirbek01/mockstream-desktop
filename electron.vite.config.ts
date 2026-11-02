import { defineConfig } from 'electron-vite'

import { brandDefine } from './brand.config'

// The flavor table lives in brand.config.ts so vitest can use the same
// defines; two copies would drift apart the first time a centre was renamed.
const define = brandDefine()

export default defineConfig({
  main: {
    define,
    build: { rollupOptions: { input: 'src/main/index.ts' } }
  },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: 'src/renderer/fallback.html' } }
  }
})
