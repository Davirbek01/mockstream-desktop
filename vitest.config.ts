import { defineConfig } from 'vitest/config'

import { brandDefine } from './brand.config'

export default defineConfig({
  // The same brand defines electron-vite gives the main-process bundle.
  // Without them a test that imports any main-process module touching
  // __BRAND_NAME__ dies on collection with a bare ReferenceError, and the
  // whole file is reported as failed with zero tests run -- which is how
  // src/main/notifications.test.ts sat red while its 31 siblings passed.
  define: brandDefine(),
  test: {
    include: ['src/**/*.test.ts']
  }
})
