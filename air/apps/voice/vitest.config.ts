import { defineConfig } from 'vitest/config'

/** Unit tests for the voice app; `src/core` stays fully covered. Electron and child-process entry files are checked by hand. */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // Live tests need the models, Ollama, or Windows; they run only with AIR_VOICE_LIVE=1.
    exclude: process.env.AIR_VOICE_LIVE === '1' ? [] : ['tests/**/*.live.spec.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: { 100: true },
    },
  },
})
