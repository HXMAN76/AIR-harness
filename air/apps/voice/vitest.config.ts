import { defineConfig } from 'vitest/config'

/** Unit tests for the voice app; `src/core` stays fully covered. Electron and child-process entry files are checked by hand. */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/**/*.live.spec.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: { 100: true },
    },
  },
})
