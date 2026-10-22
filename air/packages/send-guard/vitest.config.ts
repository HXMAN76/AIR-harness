import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { 100: true },
    },
  },
})
